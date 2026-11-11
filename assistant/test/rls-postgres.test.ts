import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { PostgresPersonalFinanceStore } from '../src/server/personal-finance.js';
import { RLS_DDL, withUser } from '../src/server/rls.js';

/**
 * Per-user tables created by the Postgres personal-finance store (see SCHEMA_SQL
 * in src/server/personal-finance.ts). spend-log.ts has no Postgres table of its
 * own: the live spend log lives in the Java ledger's spend_logs table, and the
 * TS store is in-memory only, so it is not created by this store.
 */
const TABLES = [
  { name: 'money_profiles', ownerColumn: 'account_id' },
  { name: 'income_logs', ownerColumn: 'account_id' },
] as const;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

type QueryCall = { text: string; params?: unknown[] };

function fakeClient(events: string[]): { client: pg.ClientBase; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      events.push(`query:${text.trim().toLowerCase()}`);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as pg.ClientBase;
  return { client, calls };
}

function alterStatement(table: string, action: 'enable' | 'force'): RegExp {
  return new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:"?[\\w$]+"?\\.)?"?${table}"?\\s+${action}\\s+row\\s+level\\s+security`,
    'i',
  );
}

/** Text from the create-policy statement for a table through its terminating semicolon. */
function policyStatement(table: string): string {
  const start = RLS_DDL.search(new RegExp(`create\\s+policy\\s+"?${table}_owner"?`, 'i'));
  if (start === -1) return '';
  const end = RLS_DDL.indexOf(';', start);
  return RLS_DDL.slice(start, end === -1 ? start + 400 : end);
}

describe('RLS_DDL', () => {
  it('mentions every per-user table', () => {
    for (const table of TABLES) {
      expect(RLS_DDL).toMatch(new RegExp(`\\b${table.name}\\b`));
    }
  });

  it('enables and forces row level security on every per-user table', () => {
    for (const table of TABLES) {
      expect(RLS_DDL).toMatch(alterStatement(table.name, 'enable'));
      expect(RLS_DDL).toMatch(alterStatement(table.name, 'force'));
    }
  });

  it('creates one owner policy per table, keyed on app.user_id with a matching check', () => {
    expect(RLS_DDL).toMatch(/current_setting\(\s*'app\.user_id'\s*,\s*true\s*\)/);
    for (const table of TABLES) {
      expect(RLS_DDL).toMatch(
        new RegExp(`create\\s+policy\\s+"?${table.name}_owner"?\\s+on\\s+(?:"?[\\w$]+"?\\.)?"?${table.name}"?`, 'i'),
      );
      const policy = policyStatement(table.name);
      expect(policy).toContain(table.ownerColumn);
      // A policy without WITH CHECK lets a row be written for another owner.
      expect(policy).toMatch(/with\s+check/i);
    }
  });

  it('defines an idempotent NOLOGIN app role with DML grants on those tables', () => {
    expect(RLS_DDL).toContain('settle_app');
    expect(RLS_DDL).toMatch(/create\s+role\s+"?settle_app"?/i);
    expect(RLS_DDL).toMatch(/nologin/i);
    // The DO block is what makes a second run safe.
    expect(RLS_DDL).toMatch(/\bdo\s+\$/i);
    expect(RLS_DDL).toMatch(/pg_roles/i);
    expect(RLS_DDL).toMatch(/grant\b/i);
    for (const table of TABLES) {
      expect(RLS_DDL).toMatch(
        new RegExp(`grant[\\s\\S]{0,200}\\b${table.name}\\b[\\s\\S]{0,200}\\bsettle_app\\b`, 'i'),
      );
    }
    const lowered = RLS_DDL.toLowerCase();
    for (const verb of ['select', 'insert', 'update', 'delete']) {
      expect(lowered).toContain(verb);
    }
  });
});

describe('withUser', () => {
  it('opens a transaction, binds the user id with set_config, then commits', async () => {
    const events: string[] = [];
    const { client, calls } = fakeClient(events);

    const result = await withUser(client, USER_A, async () => {
      events.push('fn');
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls[0]!.text.trim().toLowerCase()).toBe('begin');
    expect(calls[1]!.text).toMatch(/set_config\(\s*'app\.user_id'/);
    expect(calls[1]!.params).toEqual([USER_A]);
    expect(calls[calls.length - 1]!.text.trim().toLowerCase()).toBe('commit');
    expect(events).toEqual([
      'query:begin',
      `query:${calls[1]!.text.trim().toLowerCase()}`,
      'fn',
      'query:commit',
    ]);
  });

  it('never interpolates the user id into SQL text', async () => {
    const { client, calls } = fakeClient([]);
    await withUser(client, USER_A, async () => undefined);
    for (const call of calls) {
      expect(call.text).not.toContain(USER_A);
    }
  });

  it('rolls back and rethrows when the callback fails', async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      withUser(client, USER_A, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(calls[0]!.text.trim().toLowerCase()).toBe('begin');
    expect(calls[calls.length - 1]!.text.trim().toLowerCase()).toBe('rollback');
    for (const call of calls) {
      expect(call.text.trim().toLowerCase()).not.toBe('commit');
    }
  });
});

function urlWithSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get('options')?.trim();
  url.searchParams.set('options', [existing, `-c search_path=${schema}`].filter(Boolean).join(' '));
  return url.toString();
}

describe.skipIf(!process.env.SETTLE_TEST_DATABASE_URL)('Postgres row-level security', () => {
  it('keeps one user from reading or writing another user\'s rows through the app role', async () => {
    const baseUrl = process.env.SETTLE_TEST_DATABASE_URL!;
    const schema = `rls_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userA = randomUUID();
    const userB = randomUUID();

    const client = new pg.Client({ connectionString: baseUrl });
    await client.connect();

    try {
      await client.query(`create schema ${schema}`);
      await client.query(`set search_path to ${schema}`);

      // Use the store's own ensure-schema path. The search_path is pinned on its
      // connection so the tables land in this throwaway schema, not public.
      const finance = new PostgresPersonalFinanceStore(urlWithSearchPath(baseUrl, schema));
      await finance.getProfile(randomUUID(), 'USD');
      await client.query('delete from money_profiles');

      const created = await client.query(
        `select table_name from information_schema.tables where table_schema = $1`,
        [schema],
      );
      const createdTables = created.rows.map((row) => String(row.table_name));
      for (const table of TABLES) expect(createdTables).toContain(table.name);

      await client.query(RLS_DDL);
      await client.query(`grant usage on schema ${schema} to settle_app`);

      // Seed each user's rows as the superuser, inside a transaction that also
      // sets app.user_id (the same path production writes go through).
      await withUser(client, userA, async () => {
        await client.query(
          `insert into money_profiles
             (account_id, currency, period_label, period_start, wallet_cash_minor,
              credit_owed_minor, weekly_budget_minor, spend_logs_affect_wallet, updated_at)
           values ($1, 'USD', 'Test', $2, 1000, 0, null, true, now())`,
          [userA, '2026-01-01T00:00:00Z'],
        );
        await client.query(
          `insert into income_logs
             (id, account_id, amount_minor, currency, source, note, occurred_at, created_at)
           values ($1, $2, 500, 'USD', 'salary', 'A income', $3, now())`,
          [randomUUID(), userA, '2026-01-02T00:00:00Z'],
        );
      });
      await withUser(client, userB, async () => {
        await client.query(
          `insert into money_profiles
             (account_id, currency, period_label, period_start, wallet_cash_minor,
              credit_owed_minor, weekly_budget_minor, spend_logs_affect_wallet, updated_at)
           values ($1, 'USD', 'Test', $2, 2000, 0, null, true, now())`,
          [userB, '2026-01-01T00:00:00Z'],
        );
        await client.query(
          `insert into income_logs
             (id, account_id, amount_minor, currency, source, note, occurred_at, created_at)
           values ($1, $2, 900, 'USD', 'gift', 'B income', $3, now())`,
          [randomUUID(), userB, '2026-01-03T00:00:00Z'],
        );
      });

      // Everything below runs as the non-owner app role inside a transaction.
      const asApp = async <T>(userId: string | null, fn: () => Promise<T>): Promise<T> => {
        await client.query('begin');
        try {
          await client.query('set local role settle_app');
          if (userId !== null) {
            await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
          }
          const result = await fn();
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      };

      for (const table of TABLES) {
        // app.user_id = A: only A's rows come back.
        const visible = await asApp(userA, () =>
          client.query(`select ${table.ownerColumn} from ${table.name}`),
        );
        expect(visible.rows.length).toBeGreaterThan(0);
        for (const row of visible.rows) {
          expect(String(row[table.ownerColumn])).toBe(userA);
        }

        // A hand-written query for B's rows returns nothing.
        const crossTenant = await asApp(userA, () =>
          client.query(`select * from ${table.name} where ${table.ownerColumn} = $1`, [userB]),
        );
        expect(crossTenant.rows).toHaveLength(0);

        // No app.user_id at all: the policy matches no rows.
        const unset = await asApp(null, () => client.query(`select * from ${table.name}`));
        expect(unset.rows).toHaveLength(0);
      }

      // The store's public read methods, called for A, never surface B's data.
      await withUser(client, userA, async () => {
        expect((await finance.getProfile(userA, 'USD')).accountId).toBe(userA);
        const income = await finance.listIncome(userA);
        expect(income.length).toBeGreaterThan(0);
        for (const entry of income) {
          expect(entry.accountId).toBe(userA);
          expect(entry.note).not.toBe('B income');
        }
      });

      // Writing a row owned by B is rejected by the policy's WITH CHECK.
      const forbiddenIncomeId = randomUUID();
      await expect(
        asApp(userA, () =>
          client.query(
            `insert into income_logs
               (id, account_id, amount_minor, currency, source, note, occurred_at, created_at)
             values ($1, $2, 250, 'USD', 'other', 'forbidden', now(), now())`,
            [forbiddenIncomeId, userB],
          ),
        ),
      ).rejects.toThrow(/row-level security|violates.*policy/i);
      const notWritten = await client.query('select count(*)::int as c from income_logs where id = $1', [
        forbiddenIncomeId,
      ]);
      expect(Number(notWritten.rows[0]!.c)).toBe(0);

      // B's profile row is removed first so the failure can only be the policy,
      // not the money_profiles primary key.
      await client.query('delete from money_profiles where account_id = $1', [userB]);
      await expect(
        asApp(userA, () =>
          client.query(
            `insert into money_profiles (account_id, currency, period_label, period_start)
             values ($1, 'USD', 'Test', '2026-01-01T00:00:00Z')`,
            [userB],
          ),
        ),
      ).rejects.toThrow(/row-level security|violates.*policy/i);
      const profileNotWritten = await client.query(
        'select count(*)::int as c from money_profiles where account_id = $1',
        [userB],
      );
      expect(Number(profileNotWritten.rows[0]!.c)).toBe(0);
    } finally {
      await client.query(`drop schema if exists ${schema} cascade`);
      await client.end();
    }
  }, 60_000);
});
