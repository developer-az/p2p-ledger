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
  return { connectionString: stripTlsParams(connectionString), ssl: pgSsl(connectionString, env) };
}
