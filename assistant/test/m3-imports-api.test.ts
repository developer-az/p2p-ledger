/**
 * M3 route integration: upload → import report → Transactions account view.
 * Uses the in-memory import store and the existing fixture ledger; no AWS.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryImportStore, type FieldCipher } from '../src/server/imports-store.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerWriter } from '../src/server/ledger.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

const cipher: FieldCipher = {
  encryptField: async (_userId, value) => `enc:${value}`,
  decryptField: async (_userId, value) => value.replace(/^enc:/, ''),
};

const readOnly = () => Promise.reject(new Error('read-only fixture'));
const writer: LedgerWriter & LedgerAuditor = {
  openAccount: readOnly,
  deposit: readOnly,
  transfer: readOnly,
  trail: readOnly,
  integrity: readOnly,
  tamperChecks: readOnly,
  postTransfer: readOnly,
  postDeposit: readOnly,
};

const appWith = (imports: InMemoryImportStore) => {
  const practice = new PracticeLedger();
  return createApp({
    ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
    practice,
    spendLogs: fixtureSpendLogStore(),
    imports,
    now: () => NOW,
  });
};

const upload = (app: ReturnType<typeof appWith>, body: unknown) =>
  app.request(`/api/accounts/${ME}/imports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('imports API', () => {
  it('previews CSV columns without storing the file', async () => {
    const imports = new InMemoryImportStore(cipher);
    const app = appWith(imports);
    const csv = 'Date,Description,Amount\n2026-10-01,Coffee,-5.50\n';
    const res = await app.request(`/api/accounts/${ME}/imports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'statement.csv', content: csv }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { columns: string[]; suggestedMapping: { date: string } };
    expect(body.columns).toEqual(['Date', 'Description', 'Amount']);
    expect(body.suggestedMapping.date).toBe('Date');
    expect(await imports.listImports(ME)).toHaveLength(0);
  });

  it('imports a file, exposes stage progress and decrypts rows in the detail view', async () => {
    const imports = new InMemoryImportStore(cipher);
    const app = appWith(imports);
    const csv = [
      'Date,Description,Amount,Running Balance',
      '2026-10-01,"BLUE BOTTLE COFFEE",-5.50,994.50',
      '2026-10-02,"NETFLIX.COM",-15.49,979.01',
      '2026-10-03,"PAYMENT THANK YOU",100.00,1079.01',
      '',
    ].join('\n');
    const res = await upload(app, { filename: 'statement.csv', content: csv });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      import: { id: string; status: string; counts: { posted: number }; reconciliation: { reconciled: boolean } };
    };
    expect(body.import.status).toBe('posted');
    expect(body.import.counts.posted).toBe(3);
    expect(body.import.reconciliation.reconciled).toBe(true);

    const detail = await app.request(`/api/accounts/${ME}/imports/${body.import.id}`);
    expect(detail.status).toBe(200);
    const report = await detail.json() as {
      import: { stages: { parse: { status: string } } };
      transactions: { descriptor: string; descriptorClean: string; amountMinor: number }[];
      reconciled: boolean;
    };
    expect(report.import.stages.parse.status).toBe('passed');
    expect(report.transactions).toHaveLength(3);
    // M4 enrichment cleans imported descriptors to uppercase.
    expect(report.transactions.find((row) => row.descriptorClean === 'BLUE BOTTLE COFFEE')!.descriptor).toBe('BLUE BOTTLE COFFEE');
    expect(report.transactions.find((row) => row.descriptorClean === 'BLUE BOTTLE COFFEE')!.amountMinor).toBe(-550);
    expect(report.reconciled).toBe(true);

    const account = await app.request(`/api/accounts?id=${ME}`);
    const view = await account.json() as {
      importedTransactions: { descriptor: string; filename: string }[];
      reconciliations: { reconciled: boolean }[];
      patterns: { month: { spentMinor: number } };
    };
    expect(view.importedTransactions).toHaveLength(3);
    expect(view.importedTransactions[0]!.filename).toBe('statement.csv');
    expect(view.reconciliations[0]!.reconciled).toBe(true);
    expect(view.patterns.month.spentMinor).toBeGreaterThan(0);

    const history = await app.request(`/api/accounts/${ME}/imports`);
    expect(history.status).toBe(200);
    expect((await history.json() as { imports: unknown[] }).imports).toHaveLength(1);
  });

  it('rejects files over the size limit and unsupported types without storing them', async () => {
    const imports = new InMemoryImportStore(cipher);
    const app = appWith(imports);
    const tooBig = await upload(app, { filename: 'statement.csv', content: 'x'.repeat(2_000_001) });
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: 'file_too_large' });

    const pdf = await upload(app, { filename: 'statement.pdf', content: '%PDF-1.7' });
    expect(pdf.status).toBe(400);
    expect(await pdf.json()).toMatchObject({ error: 'unsupported_type' });
    expect(await imports.listImports(ME)).toHaveLength(0);
  });

  it('saves and lists column-mapping presets per account', async () => {
    const imports = new InMemoryImportStore(cipher);
    const app = appWith(imports);
    const saved = await app.request(`/api/accounts/${ME}/imports/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My bank',
        source: 'csv',
        mapping: { date: 'Posted Date', description: 'Description', amount: 'Amount' },
      }),
    });
    expect(saved.status).toBe(201);
    const list = await app.request(`/api/accounts/${ME}/imports/presets`);
    const body = await list.json() as { presets: { id: string; name: string; builtIn: boolean }[] };
    expect(body.presets.some((p) => p.name === 'My bank')).toBe(true);
    expect(body.presets.some((p) => p.builtIn)).toBe(true);
  });
});
