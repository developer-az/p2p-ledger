/**
 * Shared Pool Postgres regressions.
 *
 * Four review findings:
 *  1. a store must never check out a second pooled client while `withUser`
 *     holds one (nested checkout deadlocks a small pool);
 *  2. the schema-gate memo has to include the connection string and the
 *     effective schema, so a second database/schema still gets its DDL;
 *  3. the advisory lock must be taken before `app_schema_versions` is created;
 *  4. Supabase session-pooler URLs (port 5432) must move to Supavisor
 *     transaction mode (6543) unless PG_SUPABASE_SESSION_MODE=1.
 *
 * The pooler rewrite is pure string work; everything else needs a scratch
 * database via SETTLE_TEST_DATABASE_URL and runs in a private schema, the same
 * way test/envelope.test.ts isolates its tables.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { ClientBase } from 'pg';
import { pgConfig, poolerConnectionString, supabasePoolerMode } from '../src/server/db-tls.js';
import { LocalKeyWrapper, PostgresDataKeyStore } from '../src/server/envelope.js';
import { PostgresPersonalFinanceStore } from '../src/server/personal-finance.js';
import { closeAllPools, sharedPool } from '../src/server/pg-pool.js';
import { ensureSchemaOnce } from '../src/server/schema-gate.js';

const TEST_DATABASE_URL = process.env.SETTLE_TEST_DATABASE_URL;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

/* ------------------------------------------------------------------ */
/* 4. Supabase pooler URL rewrite (pure)                               */
/* ------------------------------------------------------------------ */

describe('Supabase pooler connection string', () => {
  const POOLER_HOST = 'aws-0-us-east-1.pooler.supabase.com';
  // Credentials are assembled so no secret-shaped literal sits in the test.
  const PASSWORD = ['pooler', 'test', 'secret'].join('-');
  const pooler5432 = `postgres://settle:${PASSWORD}@${POOLER_HOST}:5432/postgres`;
  const poolerNoPort = `postgres://settle:${PASSWORD}@${POOLER_HOST}/postgres`;

  it('logs the chosen mode once per mode and never logs credentials', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(poolerConnectionString(pooler5432, {})).toContain(':6543');
      expect(poolerConnectionString(poolerNoPort, {})).toContain(':6543');
      expect(poolerConnectionString(pooler5432, { PG_SUPABASE_SESSION_MODE: '1' })).toBe(pooler5432);
      const messages = info.mock.calls.map((call) => String(call[0]));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('transaction mode');
      expect(messages[0]).toContain('6543');
      expect(messages[0]).toContain(POOLER_HOST);
      expect(messages[1]).toContain('session mode');
      for (const message of messages) {
        expect(message).not.toContain(PASSWORD);
        expect(message).not.toContain('settle:');
      }
    } finally {
      info.mockRestore();
    }
  });

  it('moves an explicit 5432 session-pooler URL to transaction mode', () => {
    const rewritten = poolerConnectionString(pooler5432, {});
    expect(rewritten).toBe(`postgres://settle:${PASSWORD}@${POOLER_HOST}:6543/postgres`);
    expect(supabasePoolerMode(pooler5432, {})).toBe('transaction');
  });

  it('moves a pooler URL with no port to transaction mode', () => {
    expect(poolerConnectionString(poolerNoPort, {})).toBe(
      `postgres://settle:${PASSWORD}@${POOLER_HOST}:6543/postgres`,
    );
  });

  it('keeps the query string and TLS parameters intact when rewriting', () => {
    const rewritten = poolerConnectionString(
      `${pooler5432}?sslmode=require&application_name=settle`,
      {},
    );
    expect(rewritten).toContain(':6543/postgres?sslmode=require&application_name=settle');
    // pgConfig still strips the sslmode parameter it handles itself.
    const config = pgConfig(`${pooler5432}?sslmode=require`, {});
    expect(config.connectionString).toBe(`postgres://settle:${PASSWORD}@${POOLER_HOST}:6543/postgres`);
  });

  it('keeps an already-transaction-mode URL untouched', () => {
    const url = `postgres://settle:${PASSWORD}@${POOLER_HOST}:6543/postgres`;
    expect(poolerConnectionString(url, {})).toBe(url);
    expect(supabasePoolerMode(url, {})).toBeNull();
  });

  it('honours PG_SUPABASE_SESSION_MODE=1', () => {
    expect(poolerConnectionString(pooler5432, { PG_SUPABASE_SESSION_MODE: '1' })).toBe(pooler5432);
    expect(poolerConnectionString(poolerNoPort, { PG_SUPABASE_SESSION_MODE: '1' })).toBe(poolerNoPort);
    expect(supabasePoolerMode(pooler5432, { PG_SUPABASE_SESSION_MODE: '1' })).toBe('session');
    // Only the exact opt-out value counts as session mode.
    expect(supabasePoolerMode(pooler5432, { PG_SUPABASE_SESSION_MODE: 'true' })).toBe('transaction');
  });

  it.each([
    'postgres://user:pass@db.abcdefghijklmnop.supabase.co:5432/postgres',
    'postgresql://user:pass@127.0.0.1:5432/app',
    'postgres://user:pass@db.internal/app',
    'postgres://user:pass@pooler.supabase.com.evil.example:5432/app',
    'postgres://user:pass@my-pooler.supabase.com.example:5432/app',
  ])('leaves other hosts untouched: %s', (url) => {
    expect(supabasePoolerMode(url, {})).toBeNull();
    expect(poolerConnectionString(url, {})).toBe(url);
  });

  it('ignores strings that are not postgres URLs', () => {
    expect(poolerConnectionString('not a url', {})).toBe('not a url');
    expect(poolerConnectionString('https://aws-0-x.pooler.supabase.com:5432/app', {})).toBe(
      'https://aws-0-x.pooler.supabase.com:5432/app',
    );
  });
});

/* ------------------------------------------------------------------ */
/* 2./3. Schema gate statement order (fake client, no database)        */
/* ------------------------------------------------------------------ */

/** Minimal ClientBase stub that records statements and models the two tables. */
function fakeClient(options: { missingTable?: boolean; version?: number } = {}) {
  const calls: Array<{ sql: string }> = [];
  let versionsTable = !options.missingTable;
  const version = options.version ?? 0;
  const query = async (sql: string): Promise<{ rows: Array<Record<string, unknown>> }> => {
    calls.push({ sql });
    if (sql.includes('current_schema()')) return { rows: [{ schema: 'public' }] };
    if (sql.startsWith('select version from app_schema_versions')) {
      if (!versionsTable) {
        const error = new Error('relation "app_schema_versions" does not exist') as Error & { code?: string };
        error.code = '42P01';
        throw error;
      }
      return { rows: version > 0 ? [{ version }] : [] };
    }
    if (sql.includes('create table if not exists app_schema_versions')) {
      versionsTable = true;
    }
    return { rows: [] };
  };
  return { client: { query } as unknown as ClientBase, calls };
}

describe('schema gate statement order', () => {
  it('skips the transaction when the bookkeeping table is already current', async () => {
    const { client, calls } = fakeClient({ version: 3 });
    const ddl = vi.fn(async () => {});
    await ensureSchemaOnce(client, 'fake://current', 'store', 3, ddl);

    expect(ddl).not.toHaveBeenCalled();
    expect(calls.map((call) => call.sql)).toEqual([
      'select current_schema() as schema',
      'select version from app_schema_versions where name = $1',
    ]);
  });

  it('takes the advisory lock before creating app_schema_versions', async () => {
    const { client, calls } = fakeClient({ missingTable: true });
    const ddl = vi.fn(async () => {});
    await ensureSchemaOnce(client, 'fake://missing', 'store', 1, ddl);

    const statements = calls.map((call) => call.sql);
    const begin = statements.indexOf('begin');
    const lock = statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
    const create = statements.findIndex((sql) => sql.includes('create table if not exists app_schema_versions'));
    const upsert = statements.findIndex((sql) => sql.includes('insert into app_schema_versions'));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(begin);
    expect(create).toBeGreaterThan(lock);
    expect(upsert).toBeGreaterThan(create);
    expect(statements.at(-1)).toBe('commit');
    expect(ddl).toHaveBeenCalledTimes(1);
  });

  it('runs the DDL again for a different connection string', async () => {
    const first = fakeClient({ missingTable: true });
    const firstDdl = vi.fn(async () => {});
    await ensureSchemaOnce(first.client, 'fake://db-one', 'store', 1, firstDdl);

    const second = fakeClient({ missingTable: true });
    const secondDdl = vi.fn(async () => {});
    await ensureSchemaOnce(second.client, 'fake://db-two', 'store', 1, secondDdl);

    expect(firstDdl).toHaveBeenCalledTimes(1);
    expect(secondDdl).toHaveBeenCalledTimes(1);
  });

  it('memoizes repeated calls for the same connection string and schema', async () => {
    const { client, calls } = fakeClient({ version: 1 });
    const ddl = vi.fn(async () => {});
    await ensureSchemaOnce(client, 'fake://memo', 'store', 1, ddl);
    await ensureSchemaOnce(client, 'fake://memo', 'store', 1, ddl);

    // current_schema() and the version select each run once; the second call is
    // answered from the per-process memo.
    expect(calls).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Postgres regressions                                                */
/* ------------------------------------------------------------------ */

function schemaUrl(baseUrl: string, schema: string): string {
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

/** Creates a private schema, runs fn with its URL, then drops the schema. */
async function scratchSchema<T>(
  prefix: string,
  fn: (url: string, schema: string) => Promise<T>,
): Promise<T> {
  const baseUrl = TEST_DATABASE_URL!;
  const schema = `${prefix}_${randomUUID().replace(/-/g, '')}`;
  const admin = new pg.Client(pgConfig(baseUrl));
  await admin.connect();
  try {
    await admin.query(`create schema ${schema}`);
    return await fn(schemaUrl(baseUrl, schema), schema);
  } finally {
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(pgConfig(url));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)('shared pool under PG_POOL_MAX=3', () => {
  // The pools below are per private schema; close them before the startup test
  // opens its 8 direct connections.
  afterAll(async () => {
    await closeAllPools();
  });

  it('completes 6 concurrent listIncome calls with encrypted notes within 5 s', async () => {
    await scratchSchema('pgpool_budget', async (url) => {
      const keks = { kek: Buffer.alloc(32, 0x61) };
      const previousMax = process.env.PG_POOL_MAX;
      process.env.PG_POOL_MAX = '3';
      try {
        // Write through a first cipher instance; the read side below uses a
        // fresh data-key cache so every decrypt must check out a pooled client.
        const writer = new PostgresPersonalFinanceStore(
          url,
          new PostgresDataKeyStore(url, new LocalKeyWrapper(keks, 'kek')),
        );
        const accounts = Array.from({ length: 6 }, () => randomUUID());
        for (const [index, account] of accounts.entries()) {
          for (const n of [1, 2]) {
            await writer.recordIncome(account, {
              amountMinor: 1_000 * (index + 1),
              source: 'salary',
              note: `note-${index}-${n}`,
              occurredAt: new Date(T0).toISOString(),
            }, new Date(T0));
          }
        }

        const pool = sharedPool(url);
        expect((pool.options as { max?: number }).max).toBe(3);

        const reader = new PostgresPersonalFinanceStore(
          url,
          new PostgresDataKeyStore(url, new LocalKeyWrapper(keks, 'kek')),
        );
        const started = Date.now();
        const listings = await Promise.all(accounts.map((account) => reader.listIncome(account)));
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(5_000);
        expect(listings.map((rows) => rows.length)).toEqual([2, 2, 2, 2, 2, 2]);
        listings.forEach((rows, index) => {
          expect(rows.map((row) => row.note).sort()).toEqual([`note-${index}-1`, `note-${index}-2`]);
        });
      } finally {
        if (previousMax === undefined) delete process.env.PG_POOL_MAX;
        else process.env.PG_POOL_MAX = previousMax;
      }
    });
  }, 30_000);

  it('keeps listIncomePage decrypting after the client is released', async () => {
    await scratchSchema('pgpool_page', async (url) => {
      const keks = { kek: Buffer.alloc(32, 0x62) };
      const writer = new PostgresPersonalFinanceStore(
        url,
        new PostgresDataKeyStore(url, new LocalKeyWrapper(keks, 'kek')),
      );
      const account = randomUUID();
      await writer.recordIncome(account, {
        amountMinor: 2_500,
        source: 'gift',
        note: 'page note',
        occurredAt: new Date(T0).toISOString(),
      }, new Date(T0));

      const reader = new PostgresPersonalFinanceStore(
        url,
        new PostgresDataKeyStore(url, new LocalKeyWrapper(keks, 'kek')),
      );
      const page = await reader.listIncomePage(account, null, 10);
      expect(page.map((row) => row.note)).toEqual(['page note']);
    });
  }, 30_000);
});

describe.skipIf(!TEST_DATABASE_URL)('schema gate', () => {
  /** Applies a probe table for one URL and returns what landed in the schema. */
  async function applyProbe(url: string): Promise<{ version: number | undefined; table: string | null }> {
    return withClient(url, async (client) => {
      await ensureSchemaOnce(client, url, 'pg-pool-probe', 1, async () => {
        await client.query('create table if not exists pg_pool_probe (id int primary key)');
      });
      const version = await client.query(
        `select version from app_schema_versions where name = 'pg-pool-probe'`,
      );
      const table = await client.query(`select to_regclass('pg_pool_probe') as t`);
      return {
        version: version.rows[0]?.version === undefined ? undefined : Number(version.rows[0].version),
        table: (table.rows[0]?.t as string | null) ?? null,
      };
    });
  }

  it('applies the DDL to a second private schema in the same process', async () => {
    const first = await scratchSchema('pgpool_first', async (url) => applyProbe(url));
    const second = await scratchSchema('pgpool_second', async (url) => applyProbe(url));

    expect(first).toEqual({ version: 1, table: 'pg_pool_probe' });
    expect(second).toEqual({ version: 1, table: 'pg_pool_probe' });
  }, 30_000);

  it('runs the DDL only once for repeated calls on the same schema', async () => {
    await scratchSchema('pgpool_memo', async (url) => {
      await applyProbe(url);
      const again = await applyProbe(url);
      expect(again).toEqual({ version: 1, table: 'pg_pool_probe' });
    });
  }, 30_000);

  it('serializes 8 concurrent first startups against an empty schema', async () => {
    await scratchSchema('pgpool_startup', async (url, schema) => {
      // Distinct connection strings simulate distinct serverless processes:
      // each gets its own schema-gate memo entry while touching one schema.
      await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const connection = `${url}${url.includes('?') ? '&' : '?'}application_name=pg_pool_startup_${index}`;
        await withClient(connection, async (client) => {
          await ensureSchemaOnce(client, connection, 'pg-pool-startup', 1, async () => {
            await client.query('create table if not exists startup_probe (id int primary key)');
            await client.query('create index if not exists startup_probe_id_idx on startup_probe (id)');
          });
        });
      }));

      const verified = await withClient(url, async (client) => {
        const table = await client.query(`select to_regclass('startup_probe') as t`);
        const versions = await client.query(
          `select version from app_schema_versions where name = 'pg-pool-startup'`,
        );
        return {
          table: (table.rows[0]?.t as string | null) ?? null,
          versions: versions.rows.map((row) => Number(row.version)),
        };
      });
      expect(verified.table).toBe('startup_probe');
      expect(verified.versions).toEqual([1]);
      expect(schema).toMatch(/^pgpool_startup_/);
    });
  }, 30_000);
});
