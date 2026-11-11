/**
 * Durable rate limiting shared by every serverless instance.
 *
 * The in-memory sliding-window log in rate-limit.ts is correct on one machine,
 * but each Vercel instance has its own memory, so a per-IP limit becomes
 * `instances x limit`. This module keeps the hit counters in Postgres when a
 * database URL is configured.
 *
 * The counter is a coarse two-window tally, not a timestamp log: every call
 * atomically increments the counter for its fixed window and reads the counter
 * of the previous window. The estimate
 *
 *   previous * (1 - elapsedInWindow / windowMs) + current
 *
 * weights the previous window by how much of it is still inside the trailing
 * window, so bursting on either side of a boundary cannot double the allowance.
 * IPs are personal data, so the key is hashed with SHA-256 before it is stored.
 */

import { createHash } from 'node:crypto';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import { rateLimiter, type Limiter } from './rate-limit.js';

export interface RateLimitStore {
  /**
   * Atomically add one hit for (bucket, windowStart) and return the new count
   * plus the counter for windowStart - 1 (0 when that window has no rows).
   */
  hit(bucket: string, windowStart: number): Promise<{ current: number; previous: number }>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { windowStart: number; hits: number }>();
  private lastWindowStart = Number.NEGATIVE_INFINITY;

  async hit(bucket: string, windowStart: number): Promise<{ current: number; previous: number }> {
    // Windows only move forward, so prune once per new window rather than on
    // every hit. Keep the two newest windows; anything older can never be read
    // as `previous` again.
    if (windowStart > this.lastWindowStart) {
      this.lastWindowStart = windowStart;
      const cutoff = windowStart - 2;
      for (const [key, entry] of this.counters) {
        if (entry.windowStart < cutoff) this.counters.delete(key);
      }
    }
    const key = counterKey(bucket, windowStart);
    const current = (this.counters.get(key)?.hits ?? 0) + 1;
    this.counters.set(key, { windowStart, hits: current });
    const previous = this.counters.get(counterKey(bucket, windowStart - 1))?.hits ?? 0;
    return { current, previous };
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly connectionString: string) {}

  async hit(bucket: string, windowStart: number): Promise<{ current: number; previous: number }> {
    const pool = await poolFor(this.connectionString);
    await ensureSchema(this.connectionString, pool);
    // Never store a raw IP: the bucket name (`write:1.2.3.4`) is hashed.
    const key = createHash('sha256').update(bucket).digest('hex');
    const { rows } = await pool.query<{ current: string | number | null; previous: string | number | null }>(
      `with upsert as (
         insert into app_rate_limits (bucket, window_start, hits)
         values ($1, $2, 1)
         on conflict (bucket, window_start) do update set hits = app_rate_limits.hits + 1
         returning hits
       )
       select (select hits from upsert) as current,
              coalesce((select hits from app_rate_limits
                        where bucket = $1 and window_start = $3), 0) as previous`,
      [key, windowStart, windowStart - 1],
    );
    const row = rows[0];
    // Roughly one call in a hundred sweeps rows no window can read any more.
    if (Math.random() < 0.01) {
      void pool.query('delete from app_rate_limits where window_start < $1', [windowStart - 2]).catch(() => {});
    }
    return { current: Number(row?.current ?? 0), previous: Number(row?.previous ?? 0) };
  }
}

/** Postgres when a database is configured (so limits hold across instances), else memory. */
export function createRateLimitStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const url = databaseUrlFromEnv(env);
  return url ? new PostgresRateLimitStore(url) : new InMemoryRateLimitStore();
}

export interface DurableLimiter {
  (key: string): Promise<boolean>;
  check(key: string): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/**
 * Build a limiter backed by a shared store. Every call counts a hit, including
 * rejected ones — otherwise a caller could sit on the limit and keep probing.
 * If the store is unreachable the limiter degrades to a per-instance sliding
 * window so the limits still apply, with one warning per limiter.
 */
export function durableLimiter(
  store: RateLimitStore,
  name: string,
  limit: number,
  windowMs: number,
  opts: { now?: () => number } = {},
): DurableLimiter {
  const now = opts.now ?? Date.now;
  let fallback: Limiter | null = null;
  let warned = false;

  async function check(key: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const at = now();
    const windowStart = Math.floor(at / windowMs);
    const elapsed = at - windowStart * windowMs;
    const bucket = `${name}:${key}`;
    let current: number;
    let previous: number;
    try {
      ({ current, previous } = await store.hit(bucket, windowStart));
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn(`[rate-limit] shared store failed for "${name}"; using per-instance limits.`, e);
      }
      fallback ??= rateLimiter(limit, windowMs, { now });
      return fallback.check(key);
    }
    const estimate = previous * (1 - elapsed / windowMs) + current;
    if (estimate <= limit) return { allowed: true, retryAfterMs: 0 };
    // The current window is the part that still has to age out before the
    // weighted estimate can drop back under the limit.
    return { allowed: false, retryAfterMs: Math.max(1, windowMs - elapsed) };
  }

  const limiter = ((key: string) => check(key).then(verdict => verdict.allowed)) as DurableLimiter;
  limiter.check = check;
  return limiter;
}

function counterKey(bucket: string, windowStart: number): string {
  return `${bucket}\u0000${windowStart}`;
}

type PgPool = import('pg').Pool;

/**
 * One pool per connection string, created once per process. `max: 2` keeps a
 * serverless instance from opening a pool per request.
 */
const pools = new Map<string, Promise<PgPool>>();
const schemas = new Map<string, Promise<void>>();

function poolFor(connectionString: string): Promise<PgPool> {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = (async () => {
      const { default: pg } = await import('pg');
      const ssl = /supabase|sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined;
      return new pg.Pool({ connectionString, ssl, max: 2, idleTimeoutMillis: 10_000 });
    })();
    pools.set(connectionString, pool);
  }
  return pool;
}

function ensureSchema(connectionString: string, pool: PgPool): Promise<void> {
  let ready = schemas.get(connectionString);
  if (!ready) {
    ready = pool
      .query(`create table if not exists app_rate_limits (
        bucket text not null,
        window_start bigint not null,
        hits integer not null,
        primary key (bucket, window_start)
      )`)
      .then(() => undefined);
    // A failed create may be transient (database still waking); allow a retry
    // on the next hit instead of caching the rejection forever.
    void ready.catch(() => schemas.delete(connectionString));
    schemas.set(connectionString, ready);
  }
  return ready;
}
