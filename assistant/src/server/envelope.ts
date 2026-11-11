/**
 * Envelope encryption and crypto-shredding (PLAN 2.5 / ADR 0004).
 *
 * Layout:
 *   plaintext --AES-256-GCM, per-user data key, AAD=userId--> v1:base64(iv|tag|ct)
 *   data key  --wrapped by a KEK--> app_data_keys.wrapped (+ kek_id)
 *
 * The KEK is local in development/practice (DATA_KEK) and AWS KMS when
 * KMS_KEY_ARN plus credentials are configured. The database never holds an
 * unwrapped data key. Deleting the wrapped key is the deletion: ciphertext in
 * live tables and backups stays, but nothing can open it.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import { sharedPool } from './pg-pool.js';
import { ensureSchemaOnce } from './schema-gate.js';

const CIPHER_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const KEK_BYTES = 32;

export class ShreddedKeyError extends Error {
  constructor(readonly userId: string) {
    super('The data key for this account was destroyed, so its encrypted fields cannot be read.');
    this.name = 'ShreddedKeyError';
  }
}

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionConfigError';
  }
}

/** A key-encryption key. `withKek` is optional and only used by rotation. */
export interface KeyWrapper {
  wrap(dataKey: Buffer): Promise<{ wrapped: string; kekId: string }>;
  unwrap(wrapped: string, kekId: string): Promise<Buffer>;
  withKek?(kekId: string): KeyWrapper;
}

function assertKek(key: Buffer, label: string): Buffer {
  if (key.length !== KEK_BYTES) throw new EncryptionConfigError(`${label} must be 32 bytes`);
  return key;
}

function encodeBlob(iv: Buffer, tag: Buffer, ciphertext: Buffer): string {
  return CIPHER_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function readBlob(blob: string): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const bytes = Buffer.from(blob.slice(CIPHER_PREFIX.length), 'base64');
  if (bytes.length <= IV_BYTES + TAG_BYTES) throw new Error('encrypted blob is malformed');
  return {
    iv: bytes.subarray(0, IV_BYTES),
    tag: bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
    ciphertext: bytes.subarray(IV_BYTES + TAG_BYTES),
  };
}

/**
 * Local KEK for development, practice mode and self-hosting without KMS.
 * `keks` keeps previous versions so unrotated rows still unwrap.
 */
export class LocalKeyWrapper implements KeyWrapper {
  constructor(
    private readonly keks: Record<string, Buffer>,
    readonly current: string,
  ) {}

  private kek(kekId: string): Buffer {
    const key = this.keks[kekId];
    if (!key) throw new EncryptionConfigError(`No local KEK is configured for id "${kekId}".`);
    return assertKek(key, `KEK "${kekId}"`);
  }

  async wrap(dataKey: Buffer): Promise<{ wrapped: string; kekId: string }> {
    const kek = this.kek(this.current);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    cipher.setAAD(Buffer.from(`kek:${this.current}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { wrapped: encodeBlob(iv, cipher.getAuthTag(), ciphertext), kekId: this.current };
  }

  async unwrap(wrapped: string, kekId: string): Promise<Buffer> {
    if (!wrapped.startsWith(CIPHER_PREFIX)) throw new Error('wrapped key is malformed');
    const kek = this.kek(kekId);
    const { iv, tag, ciphertext } = readBlob(wrapped);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAAD(Buffer.from(`kek:${kekId}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  withKek(kekId: string): KeyWrapper {
    return new LocalKeyWrapper(this.keks, kekId);
  }
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface KmsKeyWrapperOptions {
  keyArn: string;
  region: string;
  credentials: AwsCredentials;
  /** Override for LocalStack or a VPC endpoint. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const KMS_SERVICE = 'kms';
const KMS_JSON = 'application/x-amz-json-1.1';

/**
 * AWS KMS Encrypt/Decrypt over plain fetch. No SDK: SigV4 is implemented with
 * node:crypto and covered by AWS's published example vector in the tests.
 */
export class KmsKeyWrapper implements KeyWrapper {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: KmsKeyWrapperOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async call<T>(target: string, payload: Record<string, unknown>): Promise<T> {
    const url = this.options.endpoint ?? `https://kms.${this.options.region}.amazonaws.com/`;
    const body = JSON.stringify(payload);
    const headers = signAwsRequest({
      method: 'POST',
      url,
      headers: { 'Content-Type': KMS_JSON, 'X-Amz-Target': target },
      body,
      region: this.options.region,
      service: KMS_SERVICE,
      accessKeyId: this.options.credentials.accessKeyId,
      secretAccessKey: this.options.credentials.secretAccessKey,
      ...(this.options.credentials.sessionToken
        ? { sessionToken: this.options.credentials.sessionToken }
        : {}),
      date: this.now(),
    });
    const res = await this.fetchImpl(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`AWS KMS ${target} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return await res.json() as T;
  }

  async wrap(dataKey: Buffer): Promise<{ wrapped: string; kekId: string }> {
    const out = await this.call<{ CiphertextBlob: string }>('TrentService.Encrypt', {
      KeyId: this.options.keyArn,
      Plaintext: dataKey.toString('base64'),
    });
    return { wrapped: out.CiphertextBlob, kekId: this.options.keyArn };
  }

  async unwrap(wrapped: string, kekId: string): Promise<Buffer> {
    const out = await this.call<{ Plaintext: string }>('TrentService.Decrypt', {
      CiphertextBlob: wrapped,
      ...(kekId ? { KeyId: kekId } : {}),
    });
    return Buffer.from(out.Plaintext, 'base64');
  }

  withKek(kekId: string): KeyWrapper {
    return new KmsKeyWrapper({ ...this.options, keyArn: kekId });
  }
}

/* ------------------------------------------------------------------ */
/* AWS Signature Version 4                                             */
/* ------------------------------------------------------------------ */

export interface SigV4Input {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  date?: Date;
}

export interface SigV4Result {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

function amzTimestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function canonicalQuery(search: string): string {
  const params = [...new URLSearchParams(search).entries()]
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return params.map(([key, value]) => `${key}=${value}`).join('&');
}

function canonicalPath(pathname: string): string {
  if (!pathname) return '/';
  return pathname.split('/').map(rfc3986).join('/') || '/';
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** Signs one AWS request and returns the headers to send, including Authorization. */
export function sigV4Sign(input: SigV4Input): SigV4Result {
  const url = new URL(input.url);
  const date = input.date ?? new Date();
  const amzDate = amzTimestamp(date);
  const dateStamp = amzDate.slice(0, 8);

  const supplied = input.headers ?? {};
  const lowered = new Map<string, string>();
  for (const [name, value] of Object.entries(supplied)) lowered.set(name.toLowerCase(), value);
  lowered.set('host', url.host);
  lowered.set('x-amz-date', amzDate);
  if (input.sessionToken) lowered.set('x-amz-security-token', input.sessionToken);

  const names = [...lowered.keys()].sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${lowered.get(name)!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const payloadHash = sha256Hex(input.body ?? '');
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = { ...supplied };
  headers.Host = url.host;
  headers['X-Amz-Date'] = amzDate;
  if (input.sessionToken) headers['X-Amz-Security-Token'] = input.sessionToken;
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, canonicalRequest, stringToSign, signature };
}

export function signAwsRequest(input: SigV4Input): Record<string, string> {
  return sigV4Sign(input).headers;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

let warnedDevKek = false;

/** Development-only KEK, derived the same way as the MFA dev key. */
export function devDataKek(): Buffer {
  return scryptSync('settle-dev-data-kek', 'settle-dev-data-kek-salt', DATA_KEY_BYTES);
}

export function kmsConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.KMS_KEY_ARN?.trim()
    && env.AWS_ACCESS_KEY_ID?.trim()
    && env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}

/**
 * KMS wins when fully configured; otherwise DATA_KEK (or a dev key outside
 * production). Production without either refuses to encrypt.
 */
export function keyWrapperFromEnv(env: NodeJS.ProcessEnv, kekIdOverride?: string): KeyWrapper {
  if (kmsConfigured(env)) {
    const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
    return new KmsKeyWrapper({
      keyArn: kekIdOverride ?? env.KMS_KEY_ARN!.trim(),
      region,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!.trim(),
        ...(env.AWS_SESSION_TOKEN?.trim() ? { sessionToken: env.AWS_SESSION_TOKEN.trim() } : {}),
      },
    });
  }

  const configured = env.DATA_KEK?.trim();
  let key: Buffer;
  if (configured) {
    key = Buffer.from(configured, 'base64');
    if (key.length !== KEK_BYTES) {
      throw new EncryptionConfigError('DATA_KEK must decode to 32 bytes');
    }
  } else if (env.NODE_ENV === 'production') {
    throw new EncryptionConfigError(
      'Encryption is not configured: set DATA_KEK (base64, 32 bytes) and DATA_KEK_ID, '
      + 'or KMS_KEY_ARN with AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION.',
    );
  } else {
    if (!warnedDevKek) {
      warnedDevKek = true;
      console.warn('[envelope] DATA_KEK is not set; using a development-only key.');
    }
    key = devDataKek();
  }

  const kekId = kekIdOverride
    ?? (env.DATA_KEK_ID?.trim() || (configured ? 'local' : 'dev'));
  return new LocalKeyWrapper({ [kekId]: key }, kekId);
}

/** Resolves the wrapper on first use, so importing this module stays side-effect free. */
class DeferredKeyWrapper implements KeyWrapper {
  private resolved?: KeyWrapper;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly kekIdOverride?: string,
  ) {}

  private wrapper(): KeyWrapper {
    this.resolved ??= keyWrapperFromEnv(this.env, this.kekIdOverride);
    return this.resolved;
  }

  wrap(dataKey: Buffer): Promise<{ wrapped: string; kekId: string }> {
    return this.wrapper().wrap(dataKey);
  }

  unwrap(wrapped: string, kekId: string): Promise<Buffer> {
    return this.wrapper().unwrap(wrapped, kekId);
  }

  withKek(kekId: string): KeyWrapper {
    return new DeferredKeyWrapper(this.env, kekId);
  }
}

/* ------------------------------------------------------------------ */
/* Per-user data keys                                                  */
/* ------------------------------------------------------------------ */

export interface FieldCipher {
  encryptField(userId: string, plaintext: string): Promise<string>;
  decryptField(userId: string, blob: string): Promise<string>;
}

export interface DataKeyStore extends FieldCipher {
  blindIndex(userId: string | undefined, value: string): Promise<string>;
  shred(userId: string): Promise<void>;
  /** Re-wraps every live data key under `newKekId`; ciphertext is untouched. */
  rotateKek(newKekId: string): Promise<number>;
  storedKekId(userId: string): Promise<string | null>;
  /** Distinct KEK ids currently in use, for rotation tooling. */
  kekIds(): Promise<string[]>;
}

interface StoredKeyRow {
  userId: string;
  wrapped: string | null;
  kekId: string | null;
  createdAt: string;
  shreddedAt: string | null;
}

const GLOBAL_INDEX_KEY = createHash('sha256').update('settle-global-blind-index-v1').digest();

/** Cached data keys are re-validated against the row soon after loading. */
const CACHE_TTL_MS = 30_000;
const CACHE_RECHECK_MS = 5_000;

interface CachedDataKey {
  key: Buffer;
  createdAt: number;
  verifiedAt: number;
}

function normalizeIndexValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export abstract class BaseDataKeyStore implements DataKeyStore {
  private readonly cache = new Map<string, CachedDataKey>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  /** Fail closed in this process even if a load raced with shred. */
  private readonly shredded = new Set<string>();

  constructor(protected readonly wrapper: KeyWrapper) {}

  protected abstract loadRow(userId: string): Promise<StoredKeyRow | null>;
  /** Returns false when a row already exists (another instance won the race). */
  protected abstract insertRow(row: {
    userId: string;
    wrapped: string;
    kekId: string;
    createdAt: string;
  }): Promise<boolean>;
  protected abstract updateRow(userId: string, wrapped: string, kekId: string): Promise<void>;
  /** Removes the wrapped key and leaves a tombstone so it is never recreated. */
  protected abstract deleteWrapped(userId: string, at: string): Promise<void>;
  protected abstract listRows(): Promise<Array<{ userId: string; wrapped: string; kekId: string }>>;

  private remember(userId: string, key: Buffer): void {
    const at = Date.now();
    this.cache.set(userId, { key, createdAt: at, verifiedAt: at });
  }

  private async loadOrCreate(userId: string): Promise<Buffer> {
    if (this.shredded.has(userId)) throw new ShreddedKeyError(userId);
    const row = await this.loadRow(userId);
    if (row?.shreddedAt) throw new ShreddedKeyError(userId);
    if (row?.wrapped && row.kekId) {
      const key = await this.wrapper.unwrap(row.wrapped, row.kekId);
      this.remember(userId, key);
      return key;
    }

    const key = randomBytes(DATA_KEY_BYTES);
    const { wrapped, kekId } = await this.wrapper.wrap(key);
    const inserted = await this.insertRow({ userId, wrapped, kekId, createdAt: new Date().toISOString() });
    if (inserted) {
      if (this.shredded.has(userId)) throw new ShreddedKeyError(userId);
      this.remember(userId, key);
      return key;
    }

    const existing = await this.loadRow(userId);
    if (existing?.shreddedAt) throw new ShreddedKeyError(userId);
    if (!existing?.wrapped || !existing.kekId) {
      throw new Error('data key row could not be created');
    }
    const winner = await this.wrapper.unwrap(existing.wrapped, existing.kekId);
    if (this.shredded.has(userId)) throw new ShreddedKeyError(userId);
    this.remember(userId, winner);
    return winner;
  }

  protected async dataKey(userId: string): Promise<Buffer> {
    if (this.shredded.has(userId)) throw new ShreddedKeyError(userId);
    const cached = this.cache.get(userId);
    if (cached) {
      const at = Date.now();
      if (at - cached.createdAt < CACHE_TTL_MS) {
        // After a short grace period, confirm the shared row still exists. A
        // shred on another instance must not leave this process decrypting.
        if (at - cached.verifiedAt < CACHE_RECHECK_MS) return cached.key;
        const row = await this.loadRow(userId);
        if (!row || row.shreddedAt || !row.wrapped || !row.kekId) {
          this.cache.delete(userId);
          throw new ShreddedKeyError(userId);
        }
        cached.verifiedAt = at;
        return cached.key;
      }
      this.cache.delete(userId);
    }
    const inFlight = this.pending.get(userId);
    if (inFlight) return inFlight;
    const task = this.loadOrCreate(userId).finally(() => this.pending.delete(userId));
    this.pending.set(userId, task);
    return task;
  }

  async encryptField(userId: string, plaintext: string): Promise<string> {
    const key = await this.dataKey(userId);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(userId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return encodeBlob(iv, cipher.getAuthTag(), ciphertext);
  }

  async decryptField(userId: string, blob: string): Promise<string> {
    // Legacy rows written before 2.5 have no prefix; migration reads them as-is.
    if (!blob.startsWith(CIPHER_PREFIX)) return blob;
    const { iv, tag, ciphertext } = readBlob(blob);
    const key = await this.dataKey(userId);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async blindIndex(userId: string | undefined, value: string): Promise<string> {
    const indexKey = userId === undefined
      ? GLOBAL_INDEX_KEY
      : Buffer.from(hkdfSync(
        'sha256',
        await this.dataKey(userId),
        Buffer.from('settle-blind-index-salt', 'utf8'),
        Buffer.from(`settle-blind-index:${userId}`, 'utf8'),
        DATA_KEY_BYTES,
      ));
    return createHmac('sha256', indexKey)
      .update(normalizeIndexValue(value), 'utf8')
      .digest('hex');
  }

  async shred(userId: string): Promise<void> {
    this.shredded.add(userId);
    this.cache.delete(userId);
    this.pending.delete(userId);
    await this.deleteWrapped(userId, new Date().toISOString());
  }

  async rotateKek(newKekId: string): Promise<number> {
    const target = this.wrapper.withKek?.(newKekId) ?? this.wrapper;
    const rows = await this.listRows();
    let rewrapped = 0;
    for (const row of rows) {
      const dataKey = await this.wrapper.unwrap(row.wrapped, row.kekId);
      const next = await target.wrap(dataKey);
      await this.updateRow(row.userId, next.wrapped, next.kekId);
      rewrapped++;
    }
    this.cache.clear();
    return rewrapped;
  }

  async storedKekId(userId: string): Promise<string | null> {
    const row = await this.loadRow(userId);
    return row?.shreddedAt ? null : row?.kekId ?? null;
  }

  async kekIds(): Promise<string[]> {
    const rows = await this.listRows();
    return [...new Set(rows.map((row) => row.kekId))];
  }
}

export class InMemoryDataKeyStore extends BaseDataKeyStore {
  private readonly rows = new Map<string, StoredKeyRow>();

  protected async loadRow(userId: string): Promise<StoredKeyRow | null> {
    return this.rows.get(userId) ?? null;
  }

  protected async insertRow(row: {
    userId: string;
    wrapped: string;
    kekId: string;
    createdAt: string;
  }): Promise<boolean> {
    if (this.rows.has(row.userId)) return false;
    this.rows.set(row.userId, { ...row, shreddedAt: null });
    return true;
  }

  protected async updateRow(userId: string, wrapped: string, kekId: string): Promise<void> {
    const row = this.rows.get(userId);
    if (!row || row.shreddedAt) throw new ShreddedKeyError(userId);
    this.rows.set(userId, { ...row, wrapped, kekId });
  }

  protected async deleteWrapped(userId: string, at: string): Promise<void> {
    const row = this.rows.get(userId);
    this.rows.set(userId, {
      userId,
      wrapped: null,
      kekId: null,
      createdAt: row?.createdAt ?? at,
      shreddedAt: row?.shreddedAt ?? at,
    });
  }

  protected async listRows(): Promise<Array<{ userId: string; wrapped: string; kekId: string }>> {
    return [...this.rows.values()]
      .filter((row) => !row.shreddedAt && row.wrapped !== null && row.kekId !== null)
      .map((row) => ({ userId: row.userId, wrapped: row.wrapped!, kekId: row.kekId! }));
  }

  async kekIds(): Promise<string[]> {
    const rows = await this.listRows();
    return [...new Set(rows.map((row) => row.kekId))];
  }
}

export const DATA_KEY_SCHEMA = `
create table if not exists app_data_keys (
    user_id     uuid primary key,
    wrapped     text,
    kek_id      text,
    created_at  timestamptz not null default now(),
    shredded_at timestamptz
);
`;

export class PostgresDataKeyStore extends BaseDataKeyStore {
  constructor(
    private readonly connectionString: string,
    wrapper: KeyWrapper,
  ) {
    super(wrapper);
  }

  private async client() {
    return sharedPool(this.connectionString).connect();
  }

  private async ensureSchema(c: import('pg').PoolClient): Promise<void> {
    await ensureSchemaOnce(c, this.connectionString, 'data-keys', 1, async () => {
      await c.query(DATA_KEY_SCHEMA);
    });
  }

  protected async loadRow(userId: string): Promise<StoredKeyRow | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        'select user_id, wrapped, kek_id, created_at, shredded_at from app_data_keys where user_id = $1',
        [userId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        userId: String(row.user_id),
        wrapped: row.wrapped === null || row.wrapped === undefined ? null : String(row.wrapped),
        kekId: row.kek_id === null || row.kek_id === undefined ? null : String(row.kek_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
        shreddedAt: row.shredded_at === null || row.shredded_at === undefined
          ? null
          : new Date(String(row.shredded_at)).toISOString(),
      };
    } finally {
      c.release();
    }
  }

  protected async insertRow(row: {
    userId: string;
    wrapped: string;
    kekId: string;
    createdAt: string;
  }): Promise<boolean> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `insert into app_data_keys (user_id, wrapped, kek_id, created_at)
         values ($1, $2, $3, $4)
         on conflict (user_id) do nothing`,
        [row.userId, row.wrapped, row.kekId, row.createdAt],
      );
      return res.rowCount === 1;
    } finally {
      c.release();
    }
  }

  protected async updateRow(userId: string, wrapped: string, kekId: string): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `update app_data_keys set wrapped = $2, kek_id = $3
          where user_id = $1 and shredded_at is null`,
        [userId, wrapped, kekId],
      );
      if (res.rowCount !== 1) throw new ShreddedKeyError(userId);
    } finally {
      c.release();
    }
  }

  protected async deleteWrapped(userId: string, at: string): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(
        `insert into app_data_keys (user_id, wrapped, kek_id, created_at, shredded_at)
         values ($1, null, null, $2, $2)
         on conflict (user_id) do update
           set wrapped = null, kek_id = null,
               shredded_at = coalesce(app_data_keys.shredded_at, excluded.shredded_at)`,
        [userId, at],
      );
    } finally {
      c.release();
    }
  }

  protected async listRows(): Promise<Array<{ userId: string; wrapped: string; kekId: string }>> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `select user_id, wrapped, kek_id from app_data_keys
          where shredded_at is null and wrapped is not null and kek_id is not null`,
      );
      return res.rows.map((row: Record<string, unknown>) => ({
        userId: String(row.user_id),
        wrapped: String(row.wrapped),
        kekId: String(row.kek_id),
      }));
    } finally {
      c.release();
    }
  }

  async kekIds(): Promise<string[]> {
    const rows = await this.listRows();
    return [...new Set(rows.map((row) => row.kekId))];
  }
}

/**
 * Postgres when a database URL is configured, memory otherwise. The wrapper is
 * resolved lazily so production refuses at first encrypted write, not at import.
 */
export function createDataKeyStore(env: NodeJS.ProcessEnv = process.env): DataKeyStore {
  const wrapper = new DeferredKeyWrapper(env);
  const url = databaseUrlFromEnv(env);
  return url ? new PostgresDataKeyStore(url, wrapper) : new InMemoryDataKeyStore(wrapper);
}
