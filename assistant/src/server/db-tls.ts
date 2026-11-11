import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { ClientConfig } from 'pg';

/** pg accepts `false` to disable TLS, or a tls.ConnectionOptions object to enable it. */
export type PgSsl = false | ConnectionOptions;

type Env = Record<string, string | undefined>;

/** sslmode values that ask libpq (and us) for an encrypted, verified connection. */
const TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);

let warnedInsecure = false;

/** Decoded query parameter name from one `key=value` pair. */
function queryKey(pair: string): string {
  const raw = pair.split('=')[0] ?? '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Query parameters that pg itself consumes. `pg-connection-string` turns these
 * into an `ssl` value that overrides the object passed to pg,
 * so they are removed from the URL and handled by `pgSsl` instead.
 */
function isTlsParam(pair: string): boolean {
  const key = queryKey(pair).toLowerCase();
  return key.startsWith('ssl') || key === 'uselibpqcompat';
}

/** Removes the ssl* / uselibpqcompat query parameters, keeping every other byte intact. */
export function stripTlsParams(connectionString: string): string {
  const start = connectionString.indexOf('?');
  if (start === -1) return connectionString;
  const hashAt = connectionString.indexOf('#', start);
  const query = connectionString.slice(start + 1, hashAt === -1 ? undefined : hashAt);
  const hash = hashAt === -1 ? '' : connectionString.slice(hashAt);
  const kept = query.split('&').filter((pair) => pair.length > 0 && !isTlsParam(pair));
  const base = connectionString.slice(0, start);
  return kept.length > 0 ? `${base}?${kept.join('&')}${hash}` : `${base}${hash}`;
}

/** Reads `sslmode` from the connection string query, ignoring look-alikes such as `application_name=ssl`. */
function sslMode(connectionString: string): string | undefined {
  const start = connectionString.indexOf('?');
  if (start === -1) return undefined;
  const query = connectionString.slice(start + 1).split('#')[0] ?? '';
  for (const pair of query.split('&')) {
    if (queryKey(pair).toLowerCase() === 'sslmode') {
      const rawValue = pair.slice(pair.indexOf('=') + 1);
      return decodeURIComponent(rawValue).trim().toLowerCase();
    }
  }
  return undefined;
}

/** CA PEM from DATABASE_CA_CERT (inline) or DATABASE_CA_FILE (path); throws if the file cannot be read. */
function caPem(env: Env): string | undefined {
  const inline = env.DATABASE_CA_CERT;
  if (inline && inline.trim()) return inline;

  const file = env.DATABASE_CA_FILE;
  if (!file || !file.trim()) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`DATABASE_CA_FILE could not be read (${file}): ${reason}`);
  }
}

/**
 * TLS options for a Postgres connection string.
 *
 * TLS is enabled when the host looks like Supabase, when `sslmode` asks for it
 * (require / verify-ca / verify-full), or when a CA is configured. Certificates
 * are verified unless DATABASE_TLS_INSECURE=1, which is an explicit opt-out.
 */
export function pgSsl(connectionString: string, env: Env = process.env): PgSsl {
  const ca = caPem(env);
  const wantsTls =
    /supabase/i.test(connectionString) ||
    TLS_MODES.has(sslMode(connectionString) ?? '') ||
    ca !== undefined;

  if (!wantsTls) return false;

  const insecure = env.DATABASE_TLS_INSECURE === '1';
  if (insecure && !warnedInsecure) {
    warnedInsecure = true;
    console.warn('DATABASE_TLS_INSECURE=1: Postgres certificate verification is off; use only for local debugging.');
  }

  const options: ConnectionOptions = { rejectUnauthorized: !insecure };
  if (ca !== undefined) options.ca = ca;
  return options;
}

/**
 * Client/pool options that keep TLS under this module's control.
 *
 * pg parses `sslmode`, `sslrootcert` and `uselibpqcompat` out of the connection
 * string after our `ssl` object is merged, so those parameters silently replace
 * the verification settings (for example `uselibpqcompat=true&sslmode=require`
 * sets `rejectUnauthorized: false`). They are stripped from the URL; the TLS
 * options come from `pgSsl`, which reads the original URL and the environment.
 */
export function pgConfig(connectionString: string, env: Env = process.env): ClientConfig {
  const url = poolerConnectionString(connectionString, env);
  return { connectionString: stripTlsParams(url), ssl: pgSsl(url, env) };
}

/* ------------------------------------------------------------------ */
/* Supabase pooler mode                                                */
/* ------------------------------------------------------------------ */

const SUPABASE_POOLER_SUFFIX = 'pooler.supabase.com';
/** Supavisor transaction mode; no session state survives between statements. */
const SUPABASE_TRANSACTION_PORT = 6543;
const SUPABASE_SESSION_PORT = 5432;

export type SupabasePoolerMode = 'transaction' | 'session';

/** Logged at most once per mode, so a busy process does not repeat it. */
const loggedModes = new Set<SupabasePoolerMode>();

function logPoolerMode(mode: SupabasePoolerMode, host: string): void {
  if (loggedModes.has(mode)) return;
  loggedModes.add(mode);
  if (mode === 'transaction') {
    console.info(
      `[pg] ${host}: using Supabase pooler transaction mode on port ${SUPABASE_TRANSACTION_PORT} `
      + '(set PG_SUPABASE_SESSION_MODE=1 to keep session mode on 5432).',
    );
  } else {
    console.info(`[pg] ${host}: using Supabase pooler session mode on port ${SUPABASE_SESSION_PORT}.`);
  }
}

/** Host/port of a postgres URL, or null when the string is not a URL. */
function postgresUrl(connectionString: string): URL | null {
  try {
    const url = new URL(connectionString);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Which Supabase pooler mode a connection string asks for.
 *
 * Supabase's direct and session-pooler ports (5432) cap the project at
 * `pool_size` backends no matter how many serverless instances connect, so a
 * per-instance `PG_POOL_MAX` alone cannot bound sessions. Transaction mode
 * (6543) multiplexes statements and is the default here unless
 * PG_SUPABASE_SESSION_MODE=1 explicitly asks for session state.
 */
export function supabasePoolerMode(connectionString: string, env: Env = process.env): SupabasePoolerMode | null {
  const url = postgresUrl(connectionString);
  if (!url || !url.hostname.toLowerCase().endsWith(SUPABASE_POOLER_SUFFIX)) return null;
  if (env.PG_SUPABASE_SESSION_MODE === '1') return 'session';
  // An explicit non-5432 port is already the caller's choice (for example 6543).
  return url.port === '' || url.port === String(SUPABASE_SESSION_PORT) ? 'transaction' : null;
}

/**
 * Rewrites a Supabase session-pooler URL (port 5432, or no port) to Supavisor
 * transaction mode (6543). Every other URL is returned byte-for-byte.
 *
 * Nothing in this server keeps session state across statements outside a
 * transaction: RLS identity uses `set_config(..., true)`, the audit purge uses
 * `set local`, and there are no LISTEN/PREPARE/named statements.
 */
export function poolerConnectionString(connectionString: string, env: Env = process.env): string {
  const mode = supabasePoolerMode(connectionString, env);
  if (mode === null) return connectionString;

  const url = postgresUrl(connectionString)!;
  if (mode === 'session') {
    logPoolerMode('session', url.hostname.toLowerCase());
    return connectionString;
  }

  url.port = String(SUPABASE_TRANSACTION_PORT);
  logPoolerMode('transaction', url.hostname.toLowerCase());
  return url.toString();
}
