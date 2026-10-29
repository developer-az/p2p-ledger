import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { databaseUrlFromEnv } from './integrity-postgres.js';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'settle_session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export class EmailTakenError extends Error {
  constructor() {
    super('An account with that email already exists. Sign in instead.');
    this.name = 'EmailTakenError';
  }
}

export interface AuthRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  accountId: string;
  ownerId: string;
}

export interface AuthStore {
  /** True when accounts survive a process restart (Postgres). */
  readonly persistent: boolean;
  findByEmail(email: string): Promise<AuthRecord | null>;
  findByAccountId(accountId: string): Promise<AuthRecord | null>;
  insert(user: AuthRecord): Promise<void>;
  saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Ends every session of a user (after a password reset). */
  deleteSessionsForUser(userId: string): Promise<void>;
  /** Stores a password-reset token hash; earlier unused tokens of the same user stop working. */
  saveResetToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** Uses up a reset token: returns its user once, and only before it expires. */
  consumeResetToken(tokenHash: string, now: Date): Promise<string | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export const RESET_TOKEN_TTL_SEC = 30 * 60;

/** "Sam Lee" → "sam-lee-a1b2", safe to store as a ledger owner id. */
export function ownerIdFor(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const tag = randomBytes(2).toString('hex');
  return `${slug || 'me'}-${tag}`;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = (await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** A real hash so a missing email still pays the scrypt cost. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password');
  return dummyHash;
}

export class InMemoryAuthStore implements AuthStore {
  readonly persistent = false;
  private readonly byEmail = new Map<string, AuthRecord>();
  private readonly byId = new Map<string, AuthRecord>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: number }>();

  async findByEmail(email: string): Promise<AuthRecord | null> {
    return this.byEmail.get(email) ?? null;
  }

  async findByAccountId(accountId: string): Promise<AuthRecord | null> {
    for (const user of this.byId.values()) {
      if (user.accountId === accountId) return user;
    }
    return null;
  }

  async insert(user: AuthRecord): Promise<void> {
    if (this.byEmail.has(user.email)) throw new EmailTakenError();
    this.byEmail.set(user.email, user);
    this.byId.set(user.id, user);
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt: expiresAt.getTime() });
  }

  async userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= now.getTime()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return this.byId.get(session.userId) ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  private readonly resets = new Map<string, { userId: string; expiresAt: number }>();

  async deleteSessionsForUser(userId: string): Promise<void> {
    for (const [hash, session] of this.sessions) if (session.userId === userId) this.sessions.delete(hash);
  }

  async saveResetToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    for (const [hash, reset] of this.resets) if (reset.userId === userId) this.resets.delete(hash);
    this.resets.set(tokenHash, { userId, expiresAt: expiresAt.getTime() });
  }

  async consumeResetToken(tokenHash: string, now: Date): Promise<string | null> {
    const reset = this.resets.get(tokenHash);
    if (!reset) return null;
    this.resets.delete(tokenHash);
    return reset.expiresAt > now.getTime() ? reset.userId : null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.byId.get(userId);
    if (!user) return;
    const next = { ...user, passwordHash };
    this.byId.set(userId, next);
    this.byEmail.set(next.email, next);
  }
}

const AUTH_SCHEMA = `
create table if not exists app_users (
    id            uuid primary key,
    email         text        not null,
    password_hash text        not null,
    display_name  text        not null,
    account_id    uuid        not null,
    owner_id      text        not null,
    created_at    timestamptz not null default now()
);
create unique index if not exists app_users_email_idx on app_users (email);
create index if not exists app_users_account_id_idx on app_users (account_id);
create table if not exists app_sessions (
    token_hash text primary key,
    user_id    uuid        not null references app_users (id) on delete cascade,
    expires_at timestamptz not null
);
create table if not exists app_password_resets (
    token_hash text primary key,
    user_id    uuid        not null references app_users (id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index if not exists app_password_resets_user_idx on app_password_resets (user_id);
`;

export class PostgresAuthStore implements AuthStore {
  readonly persistent = true;
  private schemaReady = false;

  constructor(private readonly connectionString: string) {}

  private async client() {
    const { default: pg } = await import('pg');
    const ssl = /supabase|sslmode=require/i.test(this.connectionString) ? { rejectUnauthorized: false } : undefined;
    const client = new pg.Client({ connectionString: this.connectionString, ssl });
    await client.connect();
    return client;
  }

  private async ensureSchema(c: import('pg').Client) {
    if (this.schemaReady) return;
    await c.query(AUTH_SCHEMA);
    this.schemaReady = true;
  }

  private row(row: Record<string, unknown>): AuthRecord {
    return {
      id: String(row.id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      displayName: String(row.display_name),
      accountId: String(row.account_id),
      ownerId: String(row.owner_id),
    };
  }

  async findByEmail(email: string): Promise<AuthRecord | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `select id, email, password_hash, display_name, account_id, owner_id from app_users where email = $1`,
        [email],
      );
      return res.rows[0] ? this.row(res.rows[0] as Record<string, unknown>) : null;
    } finally {
      await c.end();
    }
  }

  async findByAccountId(accountId: string): Promise<AuthRecord | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `select id, email, password_hash, display_name, account_id, owner_id from app_users where account_id = $1`,
        [accountId],
      );
      return res.rows[0] ? this.row(res.rows[0] as Record<string, unknown>) : null;
    } finally {
      await c.end();
    }
  }

  async insert(user: AuthRecord): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(
        `insert into app_users (id, email, password_hash, display_name, account_id, owner_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [user.id, user.email, user.passwordHash, user.displayName, user.accountId, user.ownerId],
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23505') throw new EmailTakenError();
      throw e;
    } finally {
      await c.end();
    }
  }

  async saveSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(
        `insert into app_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)`,
        [tokenHash, userId, expiresAt.toISOString()],
      );
    } finally {
      await c.end();
    }
  }

  async userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `select u.id, u.email, u.password_hash, u.display_name, u.account_id, u.owner_id
         from app_sessions s join app_users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > $2`,
        [tokenHash, now.toISOString()],
      );
      return res.rows[0] ? this.row(res.rows[0] as Record<string, unknown>) : null;
    } finally {
      await c.end();
    }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(`delete from app_sessions where token_hash = $1`, [tokenHash]);
    } finally {
      await c.end();
    }
  }
  private async run<T>(fn: (c: import('pg').Client) => Promise<T>): Promise<T> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.run((c) => c.query(`delete from app_sessions where user_id = $1`, [userId]));
  }

  async saveResetToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.run(async (c) => {
      await c.query(`delete from app_password_resets where user_id = $1`, [userId]);
      await c.query(
        `insert into app_password_resets (token_hash, user_id, expires_at) values ($1, $2, $3)`,
        [tokenHash, userId, expiresAt.toISOString()],
      );
    });
  }

  async consumeResetToken(tokenHash: string, now: Date): Promise<string | null> {
    // Delete-returning makes the token single-use even if two requests race.
    const res = await this.run((c) => c.query(
      `delete from app_password_resets where token_hash = $1 returning user_id, expires_at`,
      [tokenHash],
    ));
    const row = res.rows[0] as { user_id: string; expires_at: Date | string } | undefined;
    if (!row) return null;
    return new Date(row.expires_at).getTime() > now.getTime() ? String(row.user_id) : null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.run((c) => c.query(`update app_users set password_hash = $2 where id = $1`, [userId, passwordHash]));
  }
}

export function createAuthStore(env: NodeJS.ProcessEnv = process.env): AuthStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresAuthStore(url);
  return new InMemoryAuthStore();
}
