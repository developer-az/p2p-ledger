import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { ConnectionOptions } from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { pgSsl } from '../src/server/db-tls.js';

// A throwaway self-signed key pair, generated per run so no private key lives in git.
const certDir = mkdtempSync(path.join(os.tmpdir(), 'db-tls-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], { stdio: 'ignore' });
const TEST_KEY = readFileSync(path.join(certDir, 'key.pem'), 'utf8');
const TEST_CERT = readFileSync(path.join(certDir, 'cert.pem'), 'utf8');
afterAll(() => rmSync(certDir, { recursive: true, force: true }));

type SslOption = false | ConnectionOptions;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'db-tls-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Runs fn with DATABASE_* TLS env vars cleared, then restores them. */
function withoutDbEnv<T>(fn: () => T): T {
  const keys = ['DATABASE_CA_CERT', 'DATABASE_CA_FILE', 'DATABASE_TLS_INSECURE'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Narrows the helper result and asserts TLS options were returned. */
function tlsOptions(value: SslOption): ConnectionOptions {
  expect(value).not.toBe(false);
  if (value === false) throw new Error('expected TLS options, got false');
  return value;
}

const SUPABASE_URL = 'postgres://user:pass@db.abcdefghijklmnop.supabase.co:5432/postgres';
const REQUIRE_URL = 'postgresql://user:pass@db.internal:5432/app?sslmode=require';

describe('pgSsl — connections that do not ask for TLS', () => {
  it('returns false for a plain connection string with no CA material', () => {
    expect(pgSsl('postgres://user:pass@127.0.0.1:5432/app', {})).toBe(false);
    expect(pgSsl('postgresql://user@db.internal/app?sslmode=disable', {})).toBe(false);
    expect(pgSsl('postgresql://user@db.internal/app?sslmode=prefer', {})).toBe(false);
    expect(pgSsl('postgresql://user@db.internal/app?application_name=ssl', {})).toBe(false);
  });

  it('lets env be omitted and falls back to the process environment', () => {
    expect(withoutDbEnv(() => pgSsl('postgres://user:pass@127.0.0.1:5432/app'))).toBe(false);
  });

  it('does not switch TLS on just because the insecure flag is set', () => {
    expect(pgSsl('postgres://user:pass@127.0.0.1:5432/app', { DATABASE_TLS_INSECURE: '1' })).toBe(false);
  });
});

describe('pgSsl — connections that require TLS', () => {
  it('verifies certificates for supabase hosts', () => {
    expect(tlsOptions(pgSsl(SUPABASE_URL, {})).rejectUnauthorized).toBe(true);
  });

  it.each([
    'postgresql://user@db.internal/app?sslmode=require',
    'postgresql://user@db.internal/app?sslmode=verify-ca',
    'postgresql://user@db.internal/app?sslmode=verify-full',
    'postgresql://user@db.internal/app?SSLMODE=REQUIRE',
    'postgresql://user@db.internal/app?sslmode=Verify-Full',
  ])('verifies certificates for %s', (url) => {
    const options = tlsOptions(pgSsl(url, {}));
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('matches supabase case-insensitively', () => {
    expect(tlsOptions(pgSsl('postgres://user@Db.Supabase.Co:5432/postgres', {})).rejectUnauthorized).toBe(true);
  });

  it('never returns rejectUnauthorized: false without the insecure flag', () => {
    for (const url of [SUPABASE_URL, REQUIRE_URL]) {
      expect(tlsOptions(pgSsl(url, {})).rejectUnauthorized).not.toBe(false);
      expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: '0' })).rejectUnauthorized).toBe(true);
      expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: 'true' })).rejectUnauthorized).toBe(true);
      expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: '' })).rejectUnauthorized).toBe(true);
    }
  });
});

describe('pgSsl — custom certificate authorities', () => {
  it('uses DATABASE_CA_CERT PEM text as the ca option', () => {
    const options = tlsOptions(pgSsl(REQUIRE_URL, { DATABASE_CA_CERT: TEST_CERT }));
    expect(options.ca).toBe(TEST_CERT);
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('reads DATABASE_CA_FILE contents as the ca option', () => {
    const file = path.join(tempDir(), 'ca.pem');
    writeFileSync(file, TEST_CERT, 'utf8');
    const options = tlsOptions(pgSsl(REQUIRE_URL, { DATABASE_CA_FILE: file }));
    expect(options.ca).toBe(readFileSync(file, 'utf8'));
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('also applies CA material to a non-TLS connection string', () => {
    const options = tlsOptions(pgSsl('postgres://user@db.internal/app', { DATABASE_CA_CERT: TEST_CERT }));
    expect(options.ca).toBe(TEST_CERT);
    expect(options.rejectUnauthorized).toBe(true);
  });
});

describe('pgSsl — insecure escape hatch', () => {
  it("turns verification off only when DATABASE_TLS_INSECURE is exactly '1'", () => {
    const url = REQUIRE_URL;
    expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: '1' })).rejectUnauthorized).toBe(false);
    expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: '01' })).rejectUnauthorized).toBe(true);
    expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: 'yes' })).rejectUnauthorized).toBe(true);
    expect(tlsOptions(pgSsl(url, { DATABASE_TLS_INSECURE: 'false' })).rejectUnauthorized).toBe(true);
  });

  it('keeps verification off even when a CA is supplied', () => {
    const options = tlsOptions(pgSsl(REQUIRE_URL, { DATABASE_TLS_INSECURE: '1', DATABASE_CA_CERT: TEST_CERT }));
    expect(options.rejectUnauthorized).toBe(false);
  });
});

describe('pgSsl — misconfiguration', () => {
  it('throws an error mentioning DATABASE_CA_FILE when the file is missing', () => {
    const missing = path.join(tempDir(), 'does-not-exist.pem');
    let caught: unknown;
    try {
      pgSsl(REQUIRE_URL, { DATABASE_CA_FILE: missing });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('DATABASE_CA_FILE');
  });
});

describe('pgSsl against a live TLS endpoint', () => {
  it.skipIf(process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')('rejects a Postgres server whose certificate the client cannot verify', async () => {
    const connections = new Set<net.Socket>();
    const server = net.createServer(socket => {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
      socket.on('error', () => undefined);

      // Postgres SSLRequest: int32 length (8) + int32 magic 80877103.
      let request = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        request = Buffer.concat([request, chunk]);
        if (request.length < 8) return;
        socket.off('data', onData);
        if (request.readInt32BE(4) !== 80877103) {
          socket.destroy();
          return;
        }
        socket.write('S');
        const secure = new tls.TLSSocket(socket, { isServer: true, key: TEST_KEY, cert: TEST_CERT });
        secure.on('error', () => secure.destroy());
        // If verification were wrongly disabled the client would get this far; end the
        // connection without a valid Postgres handshake so the client still fails.
        secure.on('data', () => secure.destroy());
      };
      socket.on('data', onData);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as net.AddressInfo).port;

    const client = new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'x',
      database: 'x',
      ssl: pgSsl(`postgres://x@127.0.0.1:${port}/x?sslmode=require`, {}),
    });

    try {
      const error = await client.connect().then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      const { code, message } = error as Error & { code?: string };
      expect(`${code ?? ''} ${message ?? ''}`).toMatch(/certificate|self.signed|unable to verify/i);
    } finally {
      try {
        await client.end();
      } catch {
        // The connection never completed; nothing to close.
      }
      for (const socket of connections) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 15_000);
});
