/**
 * Regression tests for the three verified M4 review findings.
 *
 * 1. createAssistantApi must pass its durable enrichment store to createApp.
 * 2. A rule preview must not count manual categories / corrections as affected.
 * 3. A live Java spend keeps only its note on the wire, so the raw descriptor
 *    has to live in the enrichment store and come back for categorization.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  applyRuleRetroactively,
  enrichSpendEntries,
  previewRuleForAccount,
} from '../src/server/enrichment/service.js';
import {
  InMemoryEnrichmentStore,
  PostgresEnrichmentStore,
} from '../src/server/enrichment/store.js';
import type { SpendLogEntry, RecordSpendInput } from '../src/server/spend-log.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerWriter } from '../src/server/ledger.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

const captured = vi.hoisted(() => ({ calls: [] as unknown[] }));

// Record every createApp dependency object, then build the real app. That lets
// the entry-point test inspect the store without losing the integration tests.
vi.mock('../src/server/app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/app.js')>();
  return {
    ...actual,
    createApp: (deps: Parameters<typeof actual.createApp>[0]) => {
      captured.calls.push(deps);
      return actual.createApp(deps);
    },
  };
});

import { createApp } from '../src/server/app.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const DATABASE_URL = process.env.SETTLE_TEST_DATABASE_URL?.trim();

function spend(
  id: string,
  note: string,
  amountMinor: number,
  category: SpendLogEntry['category'] = 'other',
): SpendLogEntry {
  return {
    id,
    accountId: ACCOUNT,
    amountMinor,
    currency: 'USD',
    category,
    note,
    occurredAt: NOW.toISOString(),
    source: 'import',
    createdAt: NOW.toISOString(),
  };
}

describe('1. createAssistantApi wires the durable enrichment store', () => {
  it('passes the Postgres store it built to createApp', async () => {
    const databaseUrl = DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      LEDGER_DATABASE_URL: process.env.LEDGER_DATABASE_URL,
    };
    process.env.DATABASE_URL = databaseUrl;
    delete process.env.LEDGER_DATABASE_URL;
    captured.calls.length = 0;
    try {
      const { createAssistantApi } = await import('../src/server/instance.js');
      createAssistantApi();
    } finally {
      if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.DATABASE_URL;
      if (saved.LEDGER_DATABASE_URL === undefined) delete process.env.LEDGER_DATABASE_URL;
      else process.env.LEDGER_DATABASE_URL = saved.LEDGER_DATABASE_URL;
    }

    const deps = captured.calls.at(-1) as Parameters<typeof createApp>[0] | undefined;
    expect(deps?.enrichment).toBeInstanceOf(PostgresEnrichmentStore);
    // The regression was createApp falling back to memory, so this must not be
    // the in-memory store the app builds when the dependency is missing.
    expect(deps?.enrichment).not.toBeInstanceOf(InMemoryEnrichmentStore);
  });
});

describe('2. rule preview excludes protected rows', () => {
  it('reports manual/corrected matches as skipped and leaves them alone on apply', async () => {
    const store = new InMemoryEnrichmentStore(() => NOW);
    const rows = [
      spend('spend-open', 'STARBUCKS', 650),
      spend('spend-manual', 'STARBUCKS', 900, 'groceries'),
      spend('spend-corrected', 'STARBUCKS', 800, 'dining'),
      spend('spend-other', 'WHOLE FOODS MARKET', 3_000),
    ];
    await store.setOverride(ACCOUNT, 'spend-manual', {
      category: 'groceries',
      source: 'manual',
      ruleId: null,
      ruleVersion: null,
      merchantId: null,
    }, NOW);
    await store.setOverride(ACCOUNT, 'spend-corrected', {
      category: 'dining',
      source: 'user_correction',
      ruleId: null,
      ruleVersion: null,
      merchantId: null,
    }, NOW);

    const preview = await previewRuleForAccount(store, ACCOUNT, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: null,
      category: 'entertainment',
      status: 'active',
    }, rows);

    expect(preview.affected).toBe(1);
    expect(preview.skipped).toBe(2);
    expect(preview.transactions.map((row) => row.transactionId)).toEqual(['spend-open']);

    const rule = await store.createRule(ACCOUNT, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: null,
      category: 'entertainment',
    }, NOW);
    const applied = await applyRuleRetroactively(store, ACCOUNT, rule, rows, NOW);
    expect(applied).toMatchObject({ affected: 1, skipped: 2 });
    const overrides = await store.getOverrides(ACCOUNT);
    expect(overrides.get('spend-manual')?.source).toBe('manual');
    expect(overrides.get('spend-corrected')?.source).toBe('user_correction');
    expect(overrides.get('spend-open')).toMatchObject({
      category: 'entertainment',
      source: 'user_rule',
    });
  });
});

describe('3. the raw descriptor survives a note-only ledger row', () => {
  it('reads the stored descriptor back when the ledger row has only a note', async () => {
    const store = new InMemoryEnrichmentStore(() => NOW);
    const raw = 'SQ *STARBUCKS #1234 SEATTLE WA';
    await store.setDescriptor(ACCOUNT, 'spend-1', raw, NOW);

    const [row] = await enrichSpendEntries(store, ACCOUNT, [spend('spend-1', 'morning coffee run', 650)]);
    expect(row).toMatchObject({
      descriptorClean: 'STARBUCKS',
      merchantName: 'Starbucks',
      category: 'dining',
      categorySource: 'merchant_default',
    });
  });

  it('stores the descriptor at log time when the wire drops enrichment fields', async () => {
    // RoutedSpendLogStore strips enrichment columns before calling Java, so the
    // fetched row carries the personal note and no descriptorClean.
    class WireStrippingSpendLogStore extends InMemorySpendLogStore {
      override async record(accountId: string, input: RecordSpendInput, now?: Date): Promise<SpendLogEntry> {
        const {
          descriptorClean: _descriptorClean,
          merchantId: _merchantId,
          merchantName: _merchantName,
          merchantMethod: _merchantMethod,
          merchantConfidence: _merchantConfidence,
          categorySource: _categorySource,
          ruleId: _ruleId,
          ruleVersion: _ruleVersion,
          ...wire
        } = input;
        return super.record(accountId, wire, now);
      }
    }

    const spendLogs = new WireStrippingSpendLogStore();
    const enrichment = new InMemoryEnrichmentStore(() => NOW);
    const practice = new PracticeLedger();
    const reject = () => Promise.reject(new Error('read-only fixture'));
    const writer: LedgerWriter & LedgerAuditor = {
      openAccount: reject,
      deposit: reject,
      transfer: reject,
      trail: reject,
      integrity: reject,
      tamperChecks: reject,
      postTransfer: reject,
      postDeposit: reject,
    };
    const app = createApp({
      ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
      practice,
      spendLogs,
      personalFinance: new InMemoryPersonalFinanceStore(),
      enrichment,
      enforceWalletAuth: false,
      now: () => NOW,
    });

    const raw = 'SQ *STARBUCKS #1234 SEATTLE WA';
    const created = await app.request(`/api/accounts/${ME}/spends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountMinor: 650,
        note: 'morning coffee run',
        descriptor: raw,
      }),
    });
    expect(created.status).toBe(201);
    const event = await created.json() as { id: string };
    expect((await enrichment.getDescriptors(ME)).get(event.id)).toBe(raw);

    const listed = await (await app.request(`/api/accounts/${ME}/rules`)).json() as {
      transactions: { id: string; descriptorClean: string; merchantName: string | null; note: string | null }[];
    };
    expect(listed.transactions.find((row) => row.id === event.id)).toMatchObject({
      descriptorClean: 'STARBUCKS',
      merchantName: 'Starbucks',
      note: 'morning coffee run',
    });
  });
});

function urlWithSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get('options')?.trim();
  url.searchParams.set('options', [existing, `-c search_path=${schema}`].filter(Boolean).join(' '));
  return url.toString();
}

describe.skipIf(!DATABASE_URL)('3b. descriptors are durable and account-scoped in Postgres', () => {
  it('survives a second store instance and stays under withUser/RLS', async () => {
    const schema = `m4_review_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`create schema ${schema}`);
      const connectionString = urlWithSearchPath(DATABASE_URL!, schema);
      const userA = randomUUID();
      const userB = randomUUID();
      const raw = 'SQ *STARBUCKS #1234 SEATTLE WA';

      const first = new PostgresEnrichmentStore(connectionString);
      await first.setDescriptor(userA, 'spend-1', raw, NOW);

      const second = new PostgresEnrichmentStore(connectionString);
      expect((await second.getDescriptors(userA)).get('spend-1')).toBe(raw);
      expect((await second.getDescriptors(userB)).size).toBe(0);

      const [row] = await enrichSpendEntries(second, userA, [{
        ...spend('spend-1', 'morning coffee run', 650),
        accountId: userA,
      }]);
      expect(row).toMatchObject({ descriptorClean: 'STARBUCKS', merchantName: 'Starbucks' });

      await second.clearDescriptor(userA, 'spend-1');
      expect((await first.getDescriptors(userA)).has('spend-1')).toBe(false);
    } finally {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  }, 30_000);
});
