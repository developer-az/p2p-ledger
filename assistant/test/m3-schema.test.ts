/**
 * M3.1 — canonical transaction schema and the imports migration.
 *
 * The JSON Schema is the contract shared by CSV/OFX importers, the in-process
 * pipeline and the Postgres rows. The migration test runs only when a scratch
 * database is available and uses a private schema, like envelope.test.ts.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { ClientBase } from 'pg';
import { pgConfig } from '../src/server/db-tls.js';
import {
  IMPORT_SCHEMA_JSON_PATH,
  IMPORTS_DOWN_SQL,
  IMPORTS_UP_SQL,
  validateTransactionRow,
} from '../src/server/imports-schema.js';

const schema = JSON.parse(readFileSync(IMPORT_SCHEMA_JSON_PATH, 'utf8')) as {
  $id: string;
  required: string[];
  properties: Record<string, { enum?: string[]; type?: string; 'x-encrypted'?: boolean; pattern?: string }>;
};

const valid = {
  postedDate: '2026-07-15',
  amountMinor: -550,
  currency: 'USD',
  descriptorRaw: 'BLUE BOTTLE COFFEE #1042',
  descriptorClean: 'blue bottle coffee',
  categoryId: 'dining',
  source: 'csv',
  dedupeKey: 'a'.repeat(64),
  idempotencyKey: `import-${'a'.repeat(64)}-17`,
};

describe('canonical transaction schema', () => {
  it('documents the normalized fields, enum values and encrypted descriptor', () => {
    expect(schema.$id).toContain('transaction.v1');
    expect(schema.required).toEqual(expect.arrayContaining([
      'postedDate', 'amountMinor', 'currency', 'descriptorRaw', 'descriptorClean',
      'categoryId', 'source', 'dedupeKey', 'idempotencyKey',
    ]));
    expect(schema.properties.source!.enum).toEqual(expect.arrayContaining(['csv', 'ofx', 'qfx']));
    expect(schema.properties.descriptorRaw!['x-encrypted']).toBe(true);
    expect(schema.properties.amountMinor!.type).toBe('integer');
    expect(schema.properties.currency!.pattern).toBe('^[A-Z]{3}$');
  });

  it('accepts a normalized row', () => {
    expect(validateTransactionRow(valid)).toEqual({ ok: true, reasons: [] });
  });

  it('rejects malformed rows with a specific reason for each field', () => {
    const bad = {
      ...valid,
      postedDate: '2026-02-31',
      amountMinor: -5.5,
      currency: 'usd',
      descriptorRaw: '   ',
      descriptorClean: '',
      source: 'pdf',
      dedupeKey: '',
      idempotencyKey: 'x',
    };
    const result = validateTransactionRow(bad);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'bad_date',
      'amount_not_integer',
      'bad_currency',
      'empty_descriptor',
      'bad_source',
      'bad_dedupe_key',
      'bad_idempotency_key',
    ]));
  });

  it('ships up and down SQL for every new table', () => {
    for (const table of ['imports', 'import_presets', 'raw_rows', 'transactions']) {
      expect(IMPORTS_UP_SQL).toContain(`create table if not exists ${table}`);
      expect(IMPORTS_DOWN_SQL).toContain(`drop table if exists ${table}`);
    }
    expect(IMPORTS_UP_SQL).toContain('enable row level security');
    expect(IMPORTS_UP_SQL).toContain('create policy');
    expect(IMPORTS_UP_SQL).toContain('unique (account_id, dedupe_key)');
    expect(IMPORTS_UP_SQL).toContain('unique (account_id, idempotency_key)');
  });
});

const TEST_DATABASE_URL = process.env.SETTLE_TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('imports migration', () => {
  let admin: pg.Client;
  let schemaName: string;

  beforeAll(async () => {
    admin = new pg.Client(pgConfig(TEST_DATABASE_URL!));
    await admin.connect();
    schemaName = `m3_imports_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`create schema ${schemaName}`);
  }, 30_000);

  afterAll(async () => {
    await admin.query(`drop schema if exists ${schemaName} cascade`);
    await admin.end();
  });

  it('runs up, seeds rows under RLS, and rolls back down', async () => {
    const client = new pg.Client(pgConfig(TEST_DATABASE_URL!));
    await client.connect();
    try {
      await client.query(`set search_path to ${schemaName}`);
      await client.query(IMPORTS_UP_SQL);
      // Re-running the migration must be safe for deploys that retry.
      await client.query(IMPORTS_UP_SQL);
      // The private test schema needs an explicit usage grant for the app role;
      // the production public schema already has one.
      await client.query(`grant usage on schema ${schemaName} to settle_app`);

      const userId = randomUUID();
      await client.query('begin');
      await client.query(`set local app.user_id = '${userId}'`);
      const importId = randomUUID();
      await client.query(
        `insert into imports (id, account_id, file_hash, filename, source, status, pipeline_version, counts, statement, stages)
         values ($1, $2, $3, 'statement.csv', 'csv', 'posted', 'm3.1.0', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [importId, userId, 'f'.repeat(64)],
      );
      const rawId = randomUUID();
      await client.query(
        `insert into raw_rows (id, account_id, import_id, line_number, payload)
         values ($1, $2, $3, 2, '{"Description":"Coffee"}'::jsonb)`,
        [rawId, userId, importId],
      );
      await client.query(
        `insert into transactions (id, account_id, import_id, raw_row_id, line_number, posted_date, amount_minor,
           currency, descriptor_raw, descriptor_clean, category_id, source, dedupe_key, idempotency_key, pipeline_version)
         values ($1, $2, $3, $4, 2, '2026-07-15', -550, 'USD', 'enc:v1:blob', 'coffee', 'dining',
           'csv', $5, $6, 'm3.1.0')`,
        [randomUUID(), userId, importId, rawId, 'a'.repeat(64), 'import-ffff-2'],
      );
      await client.query('commit');

      await client.query('begin');
      await client.query('set local role settle_app');
      await client.query(`set local app.user_id = '${userId}'`);
      const visible = await client.query('select count(*)::int as n from transactions');
      expect(visible.rows[0].n).toBe(1);
      await client.query('commit');

      await client.query('begin');
      await client.query('set local role settle_app');
      await client.query(`set local app.user_id = '${randomUUID()}'`);
      const hidden = await client.query('select count(*)::int as n from transactions');
      expect(hidden.rows[0].n).toBe(0);
      await client.query('rollback');

      await client.query(IMPORTS_DOWN_SQL);
      for (const table of ['transactions', 'raw_rows', 'import_presets', 'imports']) {
        const found = await client.query('select to_regclass($1) as t', [table]);
        expect(found.rows[0].t).toBeNull();
      }
    } finally {
      await client.end();
    }
  }, 30_000);
});
