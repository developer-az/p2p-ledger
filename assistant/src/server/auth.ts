import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { pgConfig } from './db-tls.js';
import { databaseUrlFromEnv } from './integrity-postgres.js';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = '__Host-settle_session';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SEC = SESSION_ABSOLUTE_MS / 1000;

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

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  device: string;
  ipPrefix: string | null;
  /** Internal only: the route compares this to the caller's token hash. */
  tokenHash: string;
}

export interface SessionMeta {
  createdAt?: Date;
  device?: string;
  ipPrefix?: string | null;
}

/** Encrypted MFA material. Secrets are AES-GCM blobs, never plaintext. */
export interface MfaState {
  /** Encrypted secret once MFA is enabled. */
  secret: string | null;
  /** Encrypted secret awaiting confirmation with the first valid code. */
  pendingSecret: string | null;
  lastUsedStep: number | null;
  recoveryCodesLeft: number;
}

export interface StoredRecoveryCode {
  id: string;
  codeHash: string;
}

/** Security events worth keeping after the fact. The log is append-only. */
export type AuditType =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'mfa_challenge'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'recovery_code_used'
  | 'step_up'
  | 'session_revoked'
  | 'password_changed'
  | 'password_reset_requested'
  | 'export'
  | 'account_deleted';

export interface AuditInput {
  userId: string;
  type: AuditType;
  at: Date;
  ipPrefix: string | null;
  device: string | null;
  detail?: Record<string, string | number | boolean>;
}

export interface AuditEvent {
  id: string;
  type: AuditType;
  at: Date;
  ipPrefix: string | null;
  device: string | null;
  detail?: Record<string, string | number | boolean>;
}

export interface AuthStore {
  unlinkGoogle(userId: string): Promise<void>;
  findByGoogleSubject(subject: string): Promise<AuthRecord | null>;
  linkGoogleSubject(subject: string, userId: string): Promise<void>;
  /** True when accounts survive a process restart (Postgres). */
  readonly persistent: boolean;
  allowAuthAttempt(bucket: string, now: Date, limit?: number): Promise<boolean>;
  findByEmail(email: string): Promise<AuthRecord | null>;
  findById(userId: string): Promise<AuthRecord | null>;
  findByAccountId(accountId: string): Promise<AuthRecord | null>;
  insert(user: AuthRecord): Promise<void>;
  provision(input: { email: string; password: string; displayName: string },
    createAccount: (user: AuthRecord) => Promise<void>): Promise<AuthRecord>;
  saveSession(tokenHash: string, userId: string, expiresAt: Date, meta?: SessionMeta): Promise<void>;
  userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null>;
  listSessions(userId: string): Promise<SessionSummary[]>;
  /** True only when the public id belongs to this user. */
  revokeSession(userId: string, publicId: string): boolean | Promise<boolean>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Ends every session of a user (after a password reset). */
  deleteSessionsForUser(userId: string): Promise<void>;
  /** Stores a password-reset token hash; earlier unused tokens of the same user stop working. */
  saveResetToken(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** Uses up a reset token: returns its user once, and only before it expires. */
  consumeResetToken(tokenHash: string, now: Date): Promise<string | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  completeReset(tokenHash: string, now: Date, passwordHash: string): Promise<string | null>;
  getMfaState(userId: string): Promise<MfaState>;
  saveMfaPendingSecret(userId: string, encryptedSecret: string): Promise<void>;
  /** Promotes the pending secret, replaces recovery codes, and records the used step. */
  enableMfa(userId: string, encryptedSecret: string, recoveryCodeHashes: string[],
    lastUsedStep: number | null): Promise<void>;
  disableMfa(userId: string): Promise<void>;
  /** Remembers the newest accepted TOTP step so it cannot be replayed. */
  recordMfaStep(userId: string, step: number): Promise<void>;
  listRecoveryCodes(userId: string): Promise<StoredRecoveryCode[]>;
  /** Single use: returns false when the code was already spent. */
  useRecoveryCode(userId: string, id: string, now: Date): Promise<boolean>;
  getSessionStepUp(tokenHash: string): Promise<Date | null>;
  setSessionStepUp(tokenHash: string, until: Date): Promise<void>;
  /** Append-only: there is deliberately no update or delete counterpart. */
  appendAudit(event: AuditInput): Promise<void>;
  /** Newest first. Defaults to the fifty most recent events. */
  listAudit(userId: string, limit?: number): Promise<AuditEvent[]>;
  /**
   * Erases the identity and its security state for account deletion.
   * Callers append the account_deleted audit event first; this removes it too.
   */
  deleteUser(userId: string): Promise<void>;
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

/** Short, non-identifying browser/OS label such as "Chrome on Windows". */
export function deviceLabel(userAgent: string | undefined | null): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Unknown device';
  let browser: string;
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/^curl\//i.test(ua)) browser = 'curl';
  else if (/PostmanRuntime\//i.test(ua)) browser = 'Postman';
  else browser = ua.split(/[\s/]/)[0]?.slice(0, 24) || 'Unknown';
  let os = '';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return (os ? `${browser} on ${os}` : browser).slice(0, 40);
}

/** /24 for an IPv4 first hop, /48 for IPv6, else null. */
export function ipPrefix(forwardedFor: string | undefined | null): string | null {
  let host = forwardedFor?.split(',')[0]?.trim() ?? '';
  if (!host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    host = end > 0 ? host.slice(1, end) : host;
  } else if (!isIP(host) && /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(':'));
  }
  const kind = isIP(host);
  if (kind === 4) {
    const octets = host.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (kind !== 6) return null;
  const [head, tail] = host.toLowerCase().split('::');
  const left = head ? head.split(':').filter(Boolean) : [];
  const right = tail ? tail.split(':').filter(Boolean) : [];
  const groups = tail === undefined
    ? left
    : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 3).join(':')}::/48`;
}

function sessionCreatedAt(expiresAt: Date, meta?: SessionMeta): Date {
  return meta?.createdAt ?? new Date(expiresAt.getTime() - SESSION_ABSOLUTE_MS);
}

function normalizeDevice(device?: string): string {
  return (device?.trim() || 'Unknown device').slice(0, 40);
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
  async unlinkGoogle(userId: string): Promise<void> {
    for (const [subject, id] of this.googleSubjects) if (id === userId) this.googleSubjects.delete(subject);
    await this.deleteSessionsForUser(userId);
  }
  private readonly googleSubjects = new Map<string, string>();
  async findByGoogleSubject(subject: string): Promise<AuthRecord | null> {
    return this.byId.get(this.googleSubjects.get(subject) ?? '') ?? null;
  }
  async linkGoogleSubject(subject: string, userId: string): Promise<void> {
    if (this.googleSubjects.has(subject) || [...this.googleSubjects.values()].includes(userId)) throw new Error('Already linked');
    this.googleSubjects.set(subject, userId);
  }
  readonly persistent = false;
  private readonly byEmail = new Map<string, AuthRecord>();
  private readonly byId = new Map<string, AuthRecord>();
  private readonly sessions = new Map<string, {
    userId: string; createdAt: number; lastSeenAt: number; expiresAt: number;
    publicId: string; device: string; ipPrefix: string | null; stepUpUntil: number | null;
  }>();
  private readonly mfa = new Map<string, {
    secret: string | null; pendingSecret: string | null; lastUsedStep: number | null;
  }>();
  private readonly recoveryCodes = new Map<string, {
    userId: string; codeHash: string; usedAt: number | null;
  }>();
  /** The only audit storage is an append list; reads hand out deep copies. */
  private readonly audit: Array<AuditEvent & { userId: string }> = [];

  private readonly attempts = new Map<string, { window: number; count: number }>();
  async allowAuthAttempt(bucket: string, now: Date, limit = 10): Promise<boolean> {
    const window = Math.floor(now.getTime() / 60_000);
    for (const [key, entry] of this.attempts) if (entry.window < window) this.attempts.delete(key);
    const previous = this.attempts.get(bucket);
    const entry = { window, count: previous?.window === window ? previous.count + 1 : 1 };
    this.attempts.set(bucket, entry);
    return entry.count <= limit;
  }

  private readonly provisioning = new Map<string, AuthRecord>();
  private readonly registering = new Set<string>();
  async provision(input: { email: string; password: string; displayName: string }, createAccount: (user: AuthRecord) => Promise<void>): Promise<AuthRecord> {
    if (this.registering.has(input.email)) throw new EmailTakenError();
    this.registering.add(input.email);
    try {
      if (await this.findByEmail(input.email)) throw new EmailTakenError();
      let user = this.provisioning.get(input.email);
      if (user && !await verifyPassword(input.password, user.passwordHash)) throw new EmailTakenError();
      if (!user) {
        user = { id: crypto.randomUUID(), accountId: crypto.randomUUID(), ownerId: ownerIdFor(input.displayName),
          email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password) };
        this.provisioning.set(input.email, user);
      }
      await createAccount(user);
      await this.insert(user);
      this.provisioning.delete(input.email);
      return user;
    } finally { this.registering.delete(input.email); }
  }

  async findByEmail(email: string): Promise<AuthRecord | null> {
    return this.byEmail.get(email) ?? null;
  }

  async findById(userId: string): Promise<AuthRecord | null> {
    return this.byId.get(userId) ?? null;
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

  async saveSession(tokenHash: string, userId: string, expiresAt: Date, meta?: SessionMeta): Promise<void> {
    const createdAt = sessionCreatedAt(expiresAt, meta);
    this.sessions.set(tokenHash, {
      userId,
      createdAt: createdAt.getTime(),
      lastSeenAt: createdAt.getTime(),
      expiresAt: expiresAt.getTime(),
      publicId: randomUUID(),
      device: normalizeDevice(meta?.device),
      ipPrefix: meta?.ipPrefix ?? null,
      stepUpUntil: null,
    });
  }

  async userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    const time = now.getTime();
    if (session.expiresAt <= time || time - session.lastSeenAt >= SESSION_IDLE_MS) {
      this.sessions.delete(tokenHash);
      return null;
    }
    session.lastSeenAt = time;
    return this.byId.get(session.userId) ?? null;
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const sessions: SessionSummary[] = [];
    for (const [tokenHash, session] of this.sessions) {
      if (session.userId !== userId) continue;
      sessions.push({
        id: session.publicId,
        createdAt: new Date(session.createdAt),
        lastSeenAt: new Date(session.lastSeenAt),
        device: session.device,
        ipPrefix: session.ipPrefix,
        tokenHash,
      });
    }
    return sessions;
  }

  async revokeSession(userId: string, publicId: string): Promise<boolean> {
    for (const [tokenHash, session] of this.sessions) {
      if (session.userId === userId && session.publicId === publicId) {
        this.sessions.delete(tokenHash);
        return true;
      }
    }
    return false;
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

  async completeReset(tokenHash: string, now: Date, passwordHash: string): Promise<string | null> {
    const reset = this.resets.get(tokenHash);
    if (!reset || reset.expiresAt <= now.getTime()) return null;
    const user = this.byId.get(reset.userId);
    if (!user) return null;
    this.resets.delete(tokenHash);
    const next = { ...user, passwordHash };
    this.byId.set(user.id, next);
    this.byEmail.set(user.email, next);
    for (const [hash, session] of this.sessions) if (session.userId === user.id) this.sessions.delete(hash);
    return user.id;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.byId.get(userId);
    if (!user) return;
    const next = { ...user, passwordHash };
    this.byId.set(userId, next);
    this.byEmail.set(next.email, next);
  }

  async getMfaState(userId: string): Promise<MfaState> {
    const entry = this.mfa.get(userId);
    let recoveryCodesLeft = 0;
    for (const code of this.recoveryCodes.values()) {
      if (code.userId === userId && code.usedAt === null) recoveryCodesLeft++;
    }
    return {
      secret: entry?.secret ?? null,
      pendingSecret: entry?.pendingSecret ?? null,
      lastUsedStep: entry?.lastUsedStep ?? null,
      recoveryCodesLeft,
    };
  }

  async saveMfaPendingSecret(userId: string, encryptedSecret: string): Promise<void> {
    const entry = this.mfa.get(userId) ?? { secret: null, pendingSecret: null, lastUsedStep: null };
    this.mfa.set(userId, { ...entry, pendingSecret: encryptedSecret });
  }

  async enableMfa(userId: string, encryptedSecret: string, recoveryCodeHashes: string[],
    lastUsedStep: number | null): Promise<void> {
    this.mfa.set(userId, { secret: encryptedSecret, pendingSecret: null, lastUsedStep });
    for (const [id, code] of this.recoveryCodes) if (code.userId === userId) this.recoveryCodes.delete(id);
    for (const codeHash of recoveryCodeHashes) {
      this.recoveryCodes.set(randomUUID(), { userId, codeHash, usedAt: null });
    }
  }

  async disableMfa(userId: string): Promise<void> {
    this.mfa.delete(userId);
    for (const [id, code] of this.recoveryCodes) if (code.userId === userId) this.recoveryCodes.delete(id);
  }

  async recordMfaStep(userId: string, step: number): Promise<void> {
    const entry = this.mfa.get(userId);
    if (!entry) return;
    entry.lastUsedStep = Math.max(entry.lastUsedStep ?? 0, step);
  }

  async listRecoveryCodes(userId: string): Promise<StoredRecoveryCode[]> {
    const codes: StoredRecoveryCode[] = [];
    for (const [id, code] of this.recoveryCodes) {
      if (code.userId === userId && code.usedAt === null) codes.push({ id, codeHash: code.codeHash });
    }
    return codes;
  }

  async useRecoveryCode(userId: string, id: string, now: Date): Promise<boolean> {
    const code = this.recoveryCodes.get(id);
    if (!code || code.userId !== userId || code.usedAt !== null) return false;
    code.usedAt = now.getTime();
    return true;
  }

  async getSessionStepUp(tokenHash: string): Promise<Date | null> {
    const session = this.sessions.get(tokenHash);
    return session?.stepUpUntil == null ? null : new Date(session.stepUpUntil);
  }

  async setSessionStepUp(tokenHash: string, until: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.stepUpUntil = until.getTime();
  }

  async appendAudit(event: AuditInput): Promise<void> {
    this.audit.push({
      id: randomUUID(),
      userId: event.userId,
      type: event.type,
      at: new Date(event.at.getTime()),
      ipPrefix: event.ipPrefix,
      device: event.device,
      ...(event.detail ? { detail: { ...event.detail } } : {}),
    });
  }

  async listAudit(userId: string, limit = 50): Promise<AuditEvent[]> {
    const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
    return this.audit
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.userId === userId)
      .sort((a, b) => b.event.at.getTime() - a.event.at.getTime() || b.index - a.index)
      .slice(0, max)
      .map(({ event }) => ({
        id: event.id,
        type: event.type,
        at: new Date(event.at.getTime()),
        ipPrefix: event.ipPrefix,
        device: event.device,
        ...(event.detail ? { detail: { ...event.detail } } : {}),
      }));
  }

  async deleteUser(userId: string): Promise<void> {
    this.mfa.delete(userId);
    for (const [id, code] of this.recoveryCodes) if (code.userId === userId) this.recoveryCodes.delete(id);
    for (const [hash, session] of this.sessions) if (session.userId === userId) this.sessions.delete(hash);
    for (const [hash, reset] of this.resets) if (reset.userId === userId) this.resets.delete(hash);
    for (const [subject, id] of this.googleSubjects) if (id === userId) this.googleSubjects.delete(subject);
    for (let index = this.audit.length - 1; index >= 0; index--) {
      if (this.audit[index]!.userId === userId) this.audit.splice(index, 1);
    }
    const user = this.byId.get(userId);
    if (user) this.byEmail.delete(user.email);
    this.byId.delete(userId);
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
create table if not exists app_auth_attempts (
    bucket text primary key, window_start bigint not null, attempts integer not null
);
create table if not exists app_signup_attempts (
    email text primary key, id uuid not null, account_id uuid not null,
    owner_id text not null, display_name text not null, password_hash text not null,
    created_at timestamptz not null default now()
);
create table if not exists app_sessions (
    token_hash   text primary key,
    user_id      uuid        not null references app_users (id) on delete cascade,
    expires_at   timestamptz not null,
    public_id    uuid        not null default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    device       text,
    ip_prefix    text
);
alter table app_sessions add column if not exists public_id uuid default gen_random_uuid();
alter table app_sessions add column if not exists created_at timestamptz default now();
alter table app_sessions add column if not exists last_seen_at timestamptz default now();
alter table app_sessions add column if not exists device text;
alter table app_sessions add column if not exists ip_prefix text;
create unique index if not exists app_sessions_public_id_idx on app_sessions (public_id);
create table if not exists app_password_resets (
    token_hash text primary key,
    user_id    uuid        not null references app_users (id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index if not exists app_password_resets_user_idx on app_password_resets (user_id);
create table if not exists app_google_identities (
  subject text primary key, user_id uuid unique not null references app_users(id) on delete cascade
);
alter table app_users add column if not exists mfa_secret text;
alter table app_users add column if not exists mfa_pending text;
alter table app_users add column if not exists mfa_last_step bigint;
create table if not exists app_recovery_codes (
    id        bigserial primary key,
    user_id   uuid        not null references app_users (id) on delete cascade,
    code_hash text        not null,
    used_at   timestamptz
);
create index if not exists app_recovery_codes_user_idx on app_recovery_codes (user_id) where used_at is null;
alter table app_sessions add column if not exists step_up_until timestamptz;
`;

/**
 * Security audit log. Append-only: the trigger always rejects UPDATE and
 * rejects DELETE unless the transaction has set settle.allow_audit_purge='on'
 * (used only by account deletion). There is intentionally no foreign key to
 * app_users; deletion removes a user's audit rows explicitly as part of its
 * retention policy (a cascade would fight the trigger).
 */
export const AUDIT_DDL = `
create table if not exists app_audit_log (
    id        bigserial primary key,
    user_id   uuid        not null,
    type      text        not null,
    at        timestamptz not null default now(),
    ip_prefix text,
    device    text,
    detail    jsonb
);
create index if not exists app_audit_log_user_at_idx on app_audit_log (user_id, at desc);

create or replace function reject_audit_mutation() returns trigger
    language plpgsql as
$$
begin
    -- UPDATE is always refused. Account deletion may purge one user's rows in
    -- its own transaction, but only after setting this narrowly scoped flag.
    if tg_op = 'DELETE'
       and coalesce(current_setting('settle.allow_audit_purge', true), '') = 'on' then
        return old;
    end if;
    raise exception 'app_audit_log is append-only';
end
$$;

drop trigger if exists app_audit_log_append_only on app_audit_log;
create trigger app_audit_log_append_only
    before update or delete on app_audit_log
    for each row execute function reject_audit_mutation();
`;

export class PostgresAuthStore implements AuthStore {
  async unlinkGoogle(userId: string): Promise<void> {
    await this.run(async c => {
      await c.query('begin');
      try {
        await c.query('delete from app_google_identities where user_id=$1', [userId]);
        await c.query('delete from app_sessions where user_id=$1', [userId]);
        await c.query('commit');
      } catch (error) { await c.query('rollback'); throw error; }
    });
  }
  async findByGoogleSubject(subject: string): Promise<AuthRecord | null> {
    return this.run(async c => {
      await c.query('create table if not exists app_google_identities (subject text primary key, user_id uuid unique not null references app_users(id) on delete cascade)');
      const result = await c.query('select u.* from app_users u join app_google_identities g on g.user_id=u.id where g.subject=$1', [subject]);
      return result.rows[0] ? this.row(result.rows[0]) : null;
    });
  }
  async linkGoogleSubject(subject: string, userId: string): Promise<void> {
    await this.run(async c => {
      await c.query('create table if not exists app_google_identities (subject text primary key, user_id uuid unique not null references app_users(id) on delete cascade)');
      await c.query('insert into app_google_identities(subject,user_id) values($1,$2)', [subject, userId]);
    });
  }
  readonly persistent = true;
  private schemaReady = false;

  constructor(private readonly connectionString: string) {}

  private async client() {
    const { default: pg } = await import('pg');
    const client = new pg.Client(pgConfig(this.connectionString));
    await client.connect();
    return client;
  }

  private async ensureSchema(c: import('pg').Client) {
    if (this.schemaReady) return;
    await c.query('begin');
    try {
      await c.query("select pg_advisory_xact_lock(hashtextextended('settle:identity-schema', 0))");
      await c.query(AUTH_SCHEMA);
      await c.query(AUDIT_DDL);
      await c.query('commit');
      this.schemaReady = true;
    } catch (error) { await c.query('rollback'); throw error; }
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

  async allowAuthAttempt(bucket: string, now: Date, limit = 10): Promise<boolean> {
    return this.run(async c => {
      const window = Math.floor(now.getTime() / 60_000);
      const result = await c.query(`insert into app_auth_attempts(bucket,window_start,attempts) values($1,$2,1)
        on conflict(bucket) do update set window_start=$2,
          attempts=case when app_auth_attempts.window_start=$2 then least(app_auth_attempts.attempts+1,1000) else 1 end returning attempts`,
        [hashSessionToken(bucket), window]);
      await c.query('delete from app_auth_attempts where window_start < $1', [window - 60]);
      return Number(result.rows[0].attempts) <= limit;
    });
  }

  async provision(input: { email: string; password: string; displayName: string }, createAccount: (user: AuthRecord) => Promise<void>): Promise<AuthRecord> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      if ((await c.query('select 1 from app_users where email=$1', [input.email])).rowCount) throw new EmailTakenError();
      // Commit the reservation before calling Java. Transaction-scoped locks also work with transaction poolers.
      await c.query(`insert into app_signup_attempts(email,id,account_id,owner_id,display_name,password_hash)
        values($1,$2,$3,$4,$5,$6) on conflict(email) do nothing`, [input.email, crypto.randomUUID(), crypto.randomUUID(),
        ownerIdFor(input.displayName), input.displayName, await hashPassword(input.password)]);
      await c.query('begin');
      const lock = await c.query('select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired', ['signup:' + input.email]);
      if (!lock.rows[0].acquired) throw new EmailTakenError();
      if ((await c.query('select 1 from app_users where email=$1', [input.email])).rowCount) throw new EmailTakenError();
      const row = (await c.query('select * from app_signup_attempts where email=$1', [input.email])).rows[0];
      if (!row || !await verifyPassword(input.password, String(row.password_hash))) throw new EmailTakenError();
      const user = this.row(row);
      await createAccount(user);
      await c.query(`insert into app_users(id,email,password_hash,display_name,account_id,owner_id) values($1,$2,$3,$4,$5,$6)`,
        [user.id,user.email,user.passwordHash,user.displayName,user.accountId,user.ownerId]);
      await c.query('delete from app_signup_attempts where email=$1', [input.email]);
      await c.query('commit');
      return user;
    } catch (error) {
      await c.query('rollback').catch(() => {});
      throw error;
    } finally {
      await c.end();
    }
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

  async findById(userId: string): Promise<AuthRecord | null> {
    return this.run(async (c) => {
      const res = await c.query(
        `select id, email, password_hash, display_name, account_id, owner_id from app_users where id = $1`,
        [userId],
      );
      return res.rows[0] ? this.row(res.rows[0] as Record<string, unknown>) : null;
    });
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

  async saveSession(tokenHash: string, userId: string, expiresAt: Date, meta?: SessionMeta): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const createdAt = sessionCreatedAt(expiresAt, meta);
      await c.query(
        `insert into app_sessions
           (token_hash, user_id, expires_at, public_id, created_at, last_seen_at, device, ip_prefix)
         values ($1, $2, $3, $4, $5, $5, $6, $7)`,
        [tokenHash, userId, expiresAt.toISOString(), randomUUID(), createdAt.toISOString(),
          normalizeDevice(meta?.device), meta?.ipPrefix ?? null],
      );
    } finally {
      await c.end();
    }
  }

  async userForToken(tokenHash: string, now: Date): Promise<AuthRecord | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const idleSeconds = SESSION_IDLE_MS / 1000;
      const res = await c.query(
        `with valid as (
           update app_sessions
              set last_seen_at = $2
            where token_hash = $1
              and expires_at > $2
              and last_seen_at > $2::timestamptz - make_interval(secs => $3)
           returning user_id
         )
         select u.id, u.email, u.password_hash, u.display_name, u.account_id, u.owner_id
           from valid v join app_users u on u.id = v.user_id`,
        [tokenHash, now.toISOString(), idleSeconds],
      );
      if (!res.rows[0]) {
        await c.query(
          `delete from app_sessions
            where token_hash = $1
              and (expires_at <= $2 or last_seen_at <= $2::timestamptz - make_interval(secs => $3))`,
          [tokenHash, now.toISOString(), idleSeconds],
        );
        return null;
      }
      return this.row(res.rows[0] as Record<string, unknown>);
    } finally {
      await c.end();
    }
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const res = await this.run((c) => c.query(
      `select token_hash, public_id, created_at, last_seen_at, device, ip_prefix
         from app_sessions where user_id = $1 order by last_seen_at desc`,
      [userId],
    ));
    return res.rows.map((row) => ({
      id: String(row.public_id),
      createdAt: new Date(row.created_at as string | Date),
      lastSeenAt: new Date(row.last_seen_at as string | Date),
      device: normalizeDevice(row.device == null ? undefined : String(row.device)),
      ipPrefix: row.ip_prefix == null ? null : String(row.ip_prefix),
      tokenHash: String(row.token_hash),
    }));
  }

  async revokeSession(userId: string, publicId: string): Promise<boolean> {
    const res = await this.run((c) => c.query(
      `delete from app_sessions where user_id = $1 and public_id::text = $2 returning token_hash`,
      [userId, publicId],
    ));
    return (res.rowCount ?? 0) > 0;
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

  async completeReset(tokenHash: string, now: Date, passwordHash: string): Promise<string | null> {
    return this.run(async c => {
      await c.query('begin');
      try {
        const result = await c.query('delete from app_password_resets where token_hash=$1 and expires_at>$2 returning user_id', [tokenHash, now.toISOString()]);
        const id = result.rows[0]?.user_id as string | undefined;
        if (id) {
          await c.query('update app_users set password_hash=$2 where id=$1', [id, passwordHash]);
          await c.query('delete from app_sessions where user_id=$1', [id]);
          await c.query('delete from app_password_resets where user_id=$1', [id]);
        }
        await c.query('commit');
        return id ?? null;
      } catch (error) { await c.query('rollback'); throw error; }
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.run((c) => c.query(`update app_users set password_hash = $2 where id = $1`, [userId, passwordHash]));
  }

  async getMfaState(userId: string): Promise<MfaState> {
    return this.run(async (c) => {
      const res = await c.query(
        `select mfa_secret, mfa_pending, mfa_last_step,
                (select count(*) from app_recovery_codes r
                  where r.user_id = app_users.id and r.used_at is null) as recovery_left
           from app_users where id = $1`,
        [userId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      if (!row) return { secret: null, pendingSecret: null, lastUsedStep: null, recoveryCodesLeft: 0 };
      return {
        secret: row.mfa_secret == null ? null : String(row.mfa_secret),
        pendingSecret: row.mfa_pending == null ? null : String(row.mfa_pending),
        lastUsedStep: row.mfa_last_step == null ? null : Number(row.mfa_last_step),
        recoveryCodesLeft: Number(row.recovery_left ?? 0),
      };
    });
  }

  async saveMfaPendingSecret(userId: string, encryptedSecret: string): Promise<void> {
    await this.run((c) => c.query(
      `update app_users set mfa_pending = $2 where id = $1`,
      [userId, encryptedSecret],
    ));
  }

  async enableMfa(userId: string, encryptedSecret: string, recoveryCodeHashes: string[],
    lastUsedStep: number | null): Promise<void> {
    await this.run(async (c) => {
      await c.query('begin');
      try {
        await c.query(
          `update app_users set mfa_secret = $2, mfa_pending = null, mfa_last_step = $3 where id = $1`,
          [userId, encryptedSecret, lastUsedStep],
        );
        await c.query(`delete from app_recovery_codes where user_id = $1`, [userId]);
        for (const codeHash of recoveryCodeHashes) {
          await c.query(`insert into app_recovery_codes (user_id, code_hash) values ($1, $2)`,
            [userId, codeHash]);
        }
        await c.query('commit');
      } catch (error) {
        await c.query('rollback');
        throw error;
      }
    });
  }

  async disableMfa(userId: string): Promise<void> {
    await this.run(async (c) => {
      await c.query('begin');
      try {
        await c.query(
          `update app_users set mfa_secret = null, mfa_pending = null, mfa_last_step = null where id = $1`,
          [userId],
        );
        await c.query(`delete from app_recovery_codes where user_id = $1`, [userId]);
        await c.query('commit');
      } catch (error) {
        await c.query('rollback');
        throw error;
      }
    });
  }

  async recordMfaStep(userId: string, step: number): Promise<void> {
    await this.run((c) => c.query(
      `update app_users set mfa_last_step = greatest(coalesce(mfa_last_step, 0), $2) where id = $1`,
      [userId, step],
    ));
  }

  async listRecoveryCodes(userId: string): Promise<StoredRecoveryCode[]> {
    const res = await this.run((c) => c.query(
      `select id, code_hash from app_recovery_codes where user_id = $1 and used_at is null`,
      [userId],
    ));
    return res.rows.map((row) => ({ id: String(row.id), codeHash: String(row.code_hash) }));
  }

  async useRecoveryCode(userId: string, id: string, now: Date): Promise<boolean> {
    const res = await this.run((c) => c.query(
      `update app_recovery_codes set used_at = $3
        where id = $1 and user_id = $2 and used_at is null returning id`,
      [id, userId, now.toISOString()],
    ));
    return (res.rowCount ?? 0) > 0;
  }

  async getSessionStepUp(tokenHash: string): Promise<Date | null> {
    const res = await this.run((c) => c.query(
      `select step_up_until from app_sessions where token_hash = $1`,
      [tokenHash],
    ));
    const value = res.rows[0]?.step_up_until;
    return value == null ? null : new Date(value as string | Date);
  }

  async setSessionStepUp(tokenHash: string, until: Date): Promise<void> {
    await this.run((c) => c.query(
      `update app_sessions set step_up_until = $2 where token_hash = $1`,
      [tokenHash, until.toISOString()],
    ));
  }

  async appendAudit(event: AuditInput): Promise<void> {
    await this.run((c) => c.query(
      `insert into app_audit_log (user_id, type, at, ip_prefix, device, detail)
       values ($1, $2, $3, $4, $5, $6)`,
      [event.userId, event.type, event.at.toISOString(), event.ipPrefix, event.device,
        event.detail ? JSON.stringify(event.detail) : null],
    ));
  }

  async listAudit(userId: string, limit = 50): Promise<AuditEvent[]> {
    const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
    const res = await this.run((c) => c.query(
      `select id, type, at, ip_prefix, device, detail
         from app_audit_log where user_id = $1 order by at desc, id desc limit $2`,
      [userId, max],
    ));
    return res.rows.map((row) => ({
      id: String(row.id),
      type: String(row.type) as AuditType,
      at: new Date(row.at as string | Date),
      ipPrefix: row.ip_prefix == null ? null : String(row.ip_prefix),
      device: row.device == null ? null : String(row.device),
      ...(row.detail == null ? {} : {
        detail: (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail) as Record<string, string | number | boolean>,
      }),
    }));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.run(async (c) => {
      await c.query('begin');
      try {
        // The audit trigger refuses DELETE unless this transaction-local flag is on.
        await c.query(`set local settle.allow_audit_purge = 'on'`);
        await c.query('delete from app_recovery_codes where user_id = $1', [userId]);
        await c.query('delete from app_sessions where user_id = $1', [userId]);
        await c.query('delete from app_password_resets where user_id = $1', [userId]);
        await c.query('delete from app_google_identities where user_id = $1', [userId]);
        await c.query('delete from app_audit_log where user_id = $1', [userId]);
        await c.query('delete from app_users where id = $1', [userId]);
        await c.query('commit');
      } catch (error) {
        await c.query('rollback');
        throw error;
      }
    });
  }
}

export function createAuthStore(env: NodeJS.ProcessEnv = process.env): AuthStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresAuthStore(url);
  return new InMemoryAuthStore();
}
