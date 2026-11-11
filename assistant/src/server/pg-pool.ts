import pg from 'pg';
import { pgConfig } from './db-tls.js';

/**
 * One Pool per connection string per process.
 *
 * Serverless instances have a small connection budget: opening a Client per
 * operation, or one Pool per store, exhausts the Supabase pooler session limit
 * (`max clients ... limited to pool_size`). Every Postgres store checks out
 * from this shared pool instead, and transactions hold one client for their
 * whole span.
 */
const DEFAULT_POOL_MAX = 3;
const pools = new Map<string, pg.Pool>();

function poolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PG_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX;
}

/** Shared pool for `connectionString`; created on first use and reused afterwards. */
export function sharedPool(connectionString: string): pg.Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({
      ...pgConfig(connectionString),
      max: poolMax(),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    pool.on('error', (error) => {
      console.error('[pg-pool] idle client error:', error);
    });
    pools.set(connectionString, pool);
  }
  return pool;
}

/** End every pool created by this process. For tests and graceful shutdown. */
export async function closeAllPools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(async (pool) => {
    try {
      await pool.end();
    } catch (error) {
      console.error('[pg-pool] failed to close pool:', error);
    }
  }));
}
