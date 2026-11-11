/**
 * M3.4–M3.6 — in-process parse → validate → stage → dedupe → post pipeline,
 * idempotency, quality gates and reconciliation. No AWS services.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryImportStore, type FieldCipher } from '../src/server/imports-store.js';
import { runImport } from '../src/server/imports-pipeline.js';
import { importedTransactionsToSpendEntries, normalizeImportTransactions } from '../src/server/normalized-transactions.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'imports');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const sample = fixture('subscription-radar-sample.csv');
const overlap = fixture('subscription-radar-overlap.csv');
const NOW = new Date('2026-09-15T12:00:00Z');

const cipher: FieldCipher = {
  encryptField: async (_userId, value) => `enc:v1:${Buffer.from(value).toString('base64')}`,
  decryptField: async (_userId, value) => Buffer.from(value.replace('enc:v1:', ''), 'base64').toString('utf8'),
};

const newStore = () => new InMemoryImportStore(cipher);
const at = () => NOW;

describe('in-process import pipeline', () => {
  it('runs every stage and posts the fixture exactly once', async () => {
    const store = newStore();
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
      accountKind: 'checking',
    }, at);

    expect(result.import.status).toBe('posted');
    expect(result.import.counts).toEqual({ parsed: 78, rejected: 0, duplicates: 0, posted: 78 });
    expect(result.import.stages.parse.status).toBe('passed');
    expect(result.import.stages.validate.status).toBe('passed');
    expect(result.import.stages.stage.status).toBe('passed');
    expect(result.import.stages.dedupe.status).toBe('passed');
    expect(result.import.stages.post.status).toBe('passed');
    expect(result.import.reconciliation.reconciled).toBe(true);
    expect(result.transactions).toHaveLength(78);

    const rows = await store.listTransactions('acct-1', { limit: 1000 });
    expect(rows).toHaveLength(78);
    expect(rows.filter((r) => r.amountMinor < 0)).toHaveLength(72);
    expect(rows.filter((r) => r.amountMinor === -550 && r.postedDate === '2026-07-15')).toHaveLength(2);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(78);
    expect(rows[0]!.idempotencyKey).toMatch(/^import-[a-f0-9]{64}-\d+$/);
    expect(rows[0]!.idempotencyKey).toBe(`import-${result.import.fileHash}-${rows[0]!.lineNumber}`);
  });

  it('encrypts descriptor_raw at rest and decrypts it for the owner', async () => {
    const store = newStore();
    await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
    }, at);
    const rows = await store.listTransactions('acct-1', { limit: 100 });
    const coffee = rows.find((row) => row.descriptorClean === 'blue bottle coffee')!;
    expect(coffee.descriptorRaw).toBe('BLUE BOTTLE COFFEE');
    expect(coffee.descriptorRaw).not.toContain('enc:v1:');
    expect(coffee.descriptorClean).toContain('blue bottle');
  });

  it('is idempotent for the same file and skips overlapping rows', async () => {
    const store = newStore();
    const first = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
    }, at);
    const replay = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
    }, at);
    expect(replay.created).toBe(false);
    expect(replay.import.id).toBe(first.import.id);
    expect(await store.listTransactions('acct-1', { limit: 1000 })).toHaveLength(78);

    const second = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-overlap.csv',
      content: overlap,
    }, at);
    expect(second.import.status).toBe('posted');
    expect(second.import.counts.duplicates).toBe(12);
    expect(second.import.counts.posted).toBe(0);
    expect(await store.listTransactions('acct-1', { limit: 1000 })).toHaveLength(78);
  });

  it('posts valid rows from a file that also contains poisoned rows', async () => {
    const store = newStore();
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'bad-rows.csv',
      content: fixture('bad-rows.csv'),
    }, at);
    expect(result.import.status).toBe('posted');
    expect(result.import.counts).toMatchObject({ parsed: 3, rejected: 2, posted: 1 });
    expect(result.import.errors).toEqual([
      expect.objectContaining({ lineNumber: 2, reason: 'bad_date' }),
      expect.objectContaining({ lineNumber: 4, reason: 'bad_amount' }),
    ]);
    expect(await store.listTransactions('acct-1')).toHaveLength(1);
  });

  it('records a rejected import for a malformed file without posting anything', async () => {
    const store = newStore();
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'malformed-quote.csv',
      content: fixture('malformed-quote.csv'),
    }, at);
    expect(result.import.status).toBe('rejected');
    expect(result.import.stages.parse).toMatchObject({ status: 'failed', detail: expect.stringContaining('unterminated_quote') });
    expect(result.import.counts).toEqual({ parsed: 0, rejected: 0, duplicates: 0, posted: 0 });
    expect(await store.listTransactions('acct-1')).toHaveLength(0);
    expect(await store.listImports('acct-1')).toHaveLength(1);
  });
});

describe('quality gates', () => {
  it('blocks posting when the expected row count does not match', async () => {
    const store = newStore();
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'statement.ofx',
      content: fixture('statement.ofx'),
      expectedRowCount: 4,
    }, at);
    expect(result.import.status).toBe('failed');
    expect(result.import.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'row_count', status: 'failed' }),
    ]));
    expect(result.import.counts.posted).toBe(0);
    expect(await store.listTransactions('acct-1')).toHaveLength(0);
  });

  it('blocks a credit-card file whose purchases are all positive without an inversion', async () => {
    const store = newStore();
    const content = 'Date,Description,Amount\n2026-07-01,Coffee,5.50\n2026-07-02,Groceries,40.00\n';
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'credit.csv',
      content,
      accountKind: 'credit',
    }, at);
    expect(result.import.status).toBe('failed');
    expect(result.import.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'sign_convention',
        status: 'failed',
        detail: expect.stringContaining('invert'),
      }),
    ]));
    expect(result.import.counts.posted).toBe(0);
  });

  it('flags dates that are impossible or far in the future', async () => {
    const store = newStore();
    const content = 'Date,Description,Amount\n2099-01-01,Coffee,-5.50\n';
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'future.csv',
      content,
    }, at);
    expect(result.import.status).toBe('failed');
    expect(result.import.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'date_sanity', status: 'failed' }),
    ]));
  });

  it('compares an expected outflow total against the statement', async () => {
    const store = newStore();
    const result = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
      expectedOutflowMinor: 999_999,
    }, at);
    expect(result.import.status).toBe('failed');
    expect(result.import.quality).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'section_totals', status: 'failed' }),
    ]));
  });
});

describe('reconciliation', () => {
  it('matches the statement closing balance and exposes the difference when it does not', async () => {
    const store = newStore();
    const good = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
    }, at);
    expect(good.import.reconciliation).toMatchObject({
      reconciled: true,
      statementClosedMinor: 68_297,
      computedClosedMinor: 68_297,
      differenceMinor: 0,
    });

    const bad = await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample-2.csv',
      content: sample.replace('TRADER JOES', 'TRADER JOE'),
      openingBalanceMinor: 200_000,
    }, at);
    expect(bad.import.reconciliation.reconciled).toBe(false);
    expect(bad.import.reconciliation.differenceMinor).toBe(100_000);
    expect(bad.import.reconciliation.detail).toContain('does not match');
  });
});

describe('normalized detector input', () => {
  it('turns imported rows into positive-amount expense entries and keeps income signed', async () => {
    const store = newStore();
    await runImport(store, {
      accountId: 'acct-1',
      filename: 'subscription-radar-sample.csv',
      content: sample,
    }, at);
    const rows = await store.listTransactions('acct-1', { limit: 1000 });
    const normalized = normalizeImportTransactions(rows);
    expect(normalized.filter((r) => r.kind === 'expense')).toHaveLength(72);
    expect(normalized.filter((r) => r.kind === 'income')).toHaveLength(6);

    const spendEntries = importedTransactionsToSpendEntries(rows);
    expect(spendEntries).toHaveLength(72);
    expect(spendEntries.every((s) => s.amountMinor > 0)).toBe(true);
    expect(spendEntries.some((s) => s.source === 'import')).toBe(true);
    expect(new Set(spendEntries.map((s) => s.category)).size).toBeGreaterThan(1);
  });
});
