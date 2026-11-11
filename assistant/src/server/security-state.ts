/**
 * State that has to survive a request landing on another serverless instance:
 * sign-in lockouts and pending second-factor challenges.
 *
 * The in-memory implementation keeps a single process warm. The Postgres
 * implementation stores the same rows in the shared database. Challenge values
 * are bearer tokens, so Postgres only ever sees their SHA-256 digest.
 */
import { createHash } from 'node:crypto';
import { pgConfig } from './db-tls.js';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import type { AuthStore } from './auth.js';
import { PostgresAuthStore } from './auth.js';

export interface ThrottleRecord {
  failures: number;
  lockedUntil: Date | null;
}

/** A challenge is only valid for the flow that created it. */
export type ChallengePurpose = 'mfa' | 'register' | 'login' | 'step-up';

export interface MfaChallengeRecord {
  /** Identifies the account, except for discoverable passkey login challenges. */
  userId: string | null;
  purpose: ChallengePurpose;
  expiresAt: Date;
  attempts: number;
}

export interface SecurityStateStore {
  getThrottle(key: string): Promise<ThrottleRecord | null>;
  /** Increments failures atomically and stores the lock the caller computes. */
  failThrottle(key: string, now: Date, lockFor: (failures: number) => Date): Promise<ThrottleRecord>;
  clearThrottle(key: string): Promise<void>;
  saveChallenge(
    challenge: string,
    userId: string | null,
    expiresAt: Date,
    now?: Date,
    purpose?: ChallengePurpose,
  ): Promise<void>;
  getChallenge(challenge: string): Promise<MfaChallengeRecord | null>;
  /** Deletes and returns the challenge in one operation, so only one caller wins. */
  takeChallenge(challenge: string): Promise<MfaChallengeRecord | null>;
  /** Atomic attempt increment, capped at five attempts (0 when gone or used up). */
  incrementChallengeAttempts(challenge: string): Promise<number>;
  deleteChallenge(challenge: string): Promise<void>;
  /** Removes challenge rows past their expiry and very old throttle rows. */
  prune(now: Date): Promise<void>;
}

const THROTTLE_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

function challengeHash(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}

interface MemoryThrottle extends ThrottleRecord {
  updatedAt: number;
}

export class InMemorySecurityStateStore implements SecurityStateStore {
  private readonly throttles = new Map<string, MemoryThrottle>();
  private readonly challenges = new Map<string, MfaChallengeRecord>();

  async getThrottle(key: string): Promise<ThrottleRecord | null> {
    const entry = this.throttles.get(key);
    return entry ? { failures: entry.failures, lockedUntil: entry.lockedUntil } : null;
  }

  async failThrottle(key: string, now: Date, lockFor: (failures: number) => Date): Promise<ThrottleRecord> {
    const at = now.getTime();
    const failures = (this.throttles.get(key)?.failures ?? 0) + 1;
    const lockedUntil = lockFor(failures);
    this.throttles.set(key, { failures, lockedUntil, updatedAt: at });
    for (const [staleKey, entry] of this.throttles) {
      if (entry.updatedAt < at - THROTTLE_STALE_MS) this.throttles.delete(staleKey);
    }
    return { failures, lockedUntil };
  }

  async clearThrottle(key: string): Promise<void> {
    this.throttles.delete(key);
  }

  async saveChallenge(
    challenge: string,
    userId: string | null,
    expiresAt: Date,
    now?: Date,
    purpose: ChallengePurpose = 'mfa',
  ): Promise<void> {
    this.challenges.set(challengeHash(challenge), {
      userId,
      purpose,
      expiresAt: new Date(expiresAt.getTime()),
      attempts: 0,
    });
    await this.prune(now ?? new Date(Math.min(Date.now(), expiresAt.getTime())));
  }

  async getChallenge(challenge: string): Promise<MfaChallengeRecord | null> {
    return copyChallenge(this.challenges.get(challengeHash(challenge)));
  }

  async takeChallenge(challenge: string): Promise<MfaChallengeRecord | null> {
    // get and delete run before the first await, so concurrent callers in one
    // process cannot both observe the challenge.
    const key = challengeHash(challenge);
    const entry = this.challenges.get(key);
    if (!entry) return null;
    this.challenges.delete(key);
    return copyChallenge(entry);
  }

  async incrementChallengeAttempts(challenge: string): Promise<number> {
    const entry = this.challenges.get(challengeHash(challenge));
    if (!entry || entry.attempts >= MAX_CHALLENGE_ATTEMPTS) return 0;
    entry.attempts += 1;
    return entry.attempts;
  }

  async deleteChallenge(challenge: string): Promise<void> {
    this.challenges.delete(challengeHash(challenge));
  }

  async prune(now: Date): Promise<void> {
    const at = now.getTime();
    for (const [tokenHash, entry] of this.challenges) {
      if (entry.expiresAt.getTime() <= at) this.challenges.delete(tokenHash);
    }
    for (const [key, entry] of this.throttles) {
      if (entry.updatedAt < at - THROTTLE_STALE_MS) this.throttles.delete(key);
    }
  }
}

const SECURITY_SCHEMA = `
create table if not exists app_login_throttle (
    key          text primary key,
    failures     int not null default 0,
    locked_until timestamptz,
    updated_at   timestamptz not null default now()
);
create table if not exists app_mfa_challenges (
    token_hash text primary key,
    user_id    uuid,
    purpose    text not null default 'mfa',
    expires_at timestamptz not null,
    attempts   int not null default 0
);
alter table app_mfa_challenges add column if not exists purpose text not null default 'mfa';
alter table app_mfa_challenges alter column user_id drop not null;
create index if not exists app_mfa_challenges_expires_idx on app_mfa_challenges (expires_at);
`;

type PgPool = import('pg').Pool;

const pools = new Map<string, Promise<PgPool>>();
const schemas = new Map<string, Promise<void>>();

function poolFor(connectionString: string): Promise<PgPool> {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = (async () => {
      const { default: pg } = await import('pg');
      return new pg.Pool({ ...pgConfig(connectionString), max: 2, idleTimeoutMillis: 10_000 });
    })();
    pools.set(connectionString, pool);
  }
  return pool;
}

function ensureSchema(connectionString: string, pool: PgPool): Promise<void> {
  let ready = schemas.get(connectionString);
  if (!ready) {
    ready = pool.query(SECURITY_SCHEMA).then(() => undefined);
    void ready.catch(() => schemas.delete(connectionString));
    schemas.set(connectionString, ready);
  }
  return ready;
}

function toDate(value: unknown): Date | null {
  return value == null ? null : new Date(value as string | Date);
}

function copyChallenge(entry: MfaChallengeRecord | undefined): MfaChallengeRecord | null {
  return entry
    ? {
      userId: entry.userId,
      purpose: entry.purpose,
      expiresAt: new Date(entry.expiresAt.getTime()),
      attempts: entry.attempts,
    }
    : null;
}

function challengeFromRow(row: Record<string, unknown> | undefined): MfaChallengeRecord | null {
  if (!row) return null;
  return {
    userId: row.user_id == null ? null : String(row.user_id),
    purpose: String(row.purpose ?? 'mfa') as ChallengePurpose,
    expiresAt: new Date(row.expires_at as string | Date),
    attempts: Number(row.attempts),
  };
}

export class PostgresSecurityStateStore implements SecurityStateStore {
  private lastPrunedAt = 0;

  constructor(private readonly connectionString: string) {}

  private async pool(): Promise<PgPool> {
    const pool = await poolFor(this.connectionString);
    await ensureSchema(this.connectionString, pool);
    return pool;
  }

  async getThrottle(key: string): Promise<ThrottleRecord | null> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      `select failures, locked_until from app_login_throttle where key = $1`,
      [key],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row
      ? { failures: Number(row.failures), lockedUntil: toDate(row.locked_until) }
      : null;
  }

  async failThrottle(key: string, now: Date, lockFor: (failures: number) => Date): Promise<ThrottleRecord> {
    const pool = await this.pool();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        `insert into app_login_throttle (key, failures, locked_until, updated_at)
         values ($1, 1, null, $2)
         on conflict (key) do update
           set failures = app_login_throttle.failures + 1,
               updated_at = excluded.updated_at
         returning failures`,
        [key, now.toISOString()],
      );
      const failures = Number(inserted.rows[0]?.failures ?? 0);
      const lockedUntil = lockFor(failures);
      await client.query(
        `update app_login_throttle set locked_until = $2 where key = $1`,
        [key, lockedUntil.toISOString()],
      );
      await client.query('commit');
      void pool.query(
        `delete from app_login_throttle where updated_at < $1::timestamptz - interval '1 day'`,
        [now.toISOString()],
      ).catch(() => {});
      return { failures, lockedUntil };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async clearThrottle(key: string): Promise<void> {
    const pool = await this.pool();
    await pool.query(`delete from app_login_throttle where key = $1`, [key]);
  }

  async saveChallenge(
    challenge: string,
    userId: string | null,
    expiresAt: Date,
    now?: Date,
    purpose: ChallengePurpose = 'mfa',
  ): Promise<void> {
    const pool = await this.pool();
    await pool.query(
      `insert into app_mfa_challenges (token_hash, user_id, purpose, expires_at, attempts)
       values ($1, $2, $3, $4, 0)
       on conflict (token_hash) do update
         set user_id = excluded.user_id,
             purpose = excluded.purpose,
             expires_at = excluded.expires_at,
             attempts = 0`,
      [challengeHash(challenge), userId, purpose, expiresAt.toISOString()],
    );
    void this.prune(now ?? new Date(Math.min(Date.now(), expiresAt.getTime()))).catch(() => {});
  }

  async getChallenge(challenge: string): Promise<MfaChallengeRecord | null> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      `select user_id, purpose, expires_at, attempts from app_mfa_challenges where token_hash = $1`,
      [challengeHash(challenge)],
    );
    return challengeFromRow(rows[0] as Record<string, unknown> | undefined);
  }

  async takeChallenge(challenge: string): Promise<MfaChallengeRecord | null> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      `delete from app_mfa_challenges where token_hash = $1
        returning user_id, purpose, expires_at, attempts`,
      [challengeHash(challenge)],
    );
    return challengeFromRow(rows[0] as Record<string, unknown> | undefined);
  }

  async incrementChallengeAttempts(challenge: string): Promise<number> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      `update app_mfa_challenges set attempts = attempts + 1
        where token_hash = $1 and attempts < $2 returning attempts`,
      [challengeHash(challenge), MAX_CHALLENGE_ATTEMPTS],
    );
    return Number(rows[0]?.attempts ?? 0);
  }

  async deleteChallenge(challenge: string): Promise<void> {
    const pool = await this.pool();
    await pool.query(`delete from app_mfa_challenges where token_hash = $1`, [challengeHash(challenge)]);
  }

  async prune(now: Date): Promise<void> {
    const at = now.getTime();
    if (at - this.lastPrunedAt < 60_000) return;
    this.lastPrunedAt = at;
    const pool = await this.pool();
    await pool.query(`delete from app_mfa_challenges where expires_at <= $1`, [now.toISOString()]);
    await pool.query(
      `delete from app_login_throttle where updated_at < $1::timestamptz - interval '1 day'`,
      [now.toISOString()],
    );
  }
}

/**
 * Postgres when the auth store is Postgres (one database backs identity,
 * lockouts and pending challenges), or when called with an environment that
 * names a database. In memory otherwise.
 */
export function createSecurityStateStore(
  source: AuthStore | NodeJS.ProcessEnv = process.env,
): SecurityStateStore {
  if (source instanceof PostgresAuthStore) return new PostgresSecurityStateStore(source.connectionString);
  const env = source as NodeJS.ProcessEnv;
  const url = databaseUrlFromEnv(env) ?? env.SETTLE_TEST_DATABASE_URL?.trim();
  return url ? new PostgresSecurityStateStore(url) : new InMemorySecurityStateStore();
}
