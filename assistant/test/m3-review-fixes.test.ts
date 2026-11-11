/**
 * Regression tests for the verified M3 review findings:
 * encrypted raw-row staging, account deletion, SGML OFX boundaries, retrying
 * non-posted imports, ambiguous overlap dedupe, import-scoped transaction
 * reads, upload limits before body parsing, and M4 enrichment on imports.
 */
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import {
  InMemoryAuthStore,
  SESSION_COOKIE,
  hashPassword,
  hashSessionToken,
  newSessionToken,
} from '../src/server/auth.js';
import { assignDedupeKeys } from '../src/server/import-dedupe.js';
import { parseImportFile } from '../src/server/importers.js';
import { runImport } from '../src/server/imports-pipeline.js';
import {
  InMemoryImportStore,
  type FieldCipher,
  type ImportRecord,
  type ImportStageState,
} from '../src/server/imports-store.js';
import { InMemoryEnrichmentStore } from '../src/server/enrichment/store.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerWriter } from '../src/server/ledger.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

const cipher: FieldCipher = {
  encryptField: async (_userId, value) => `enc:v1:${Buffer.from(value).toString('base64')}`,
  decryptField: async (_userId, value) => Buffer.from(value.replace('enc:v1:', ''), 'base64').toString('utf8'),
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

function appWith(imports: InMemoryImportStore, auth?: InMemoryAuthStore) {
  const practice = new PracticeLedger();
  return createApp({
    ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
    practice,
    spendLogs: fixtureSpendLogStore(),
    imports,
    auth,
    now: () => NOW,
    mfaKey: Buffer.alloc(32, 0x2a),
  });
}

const stage = (status: ImportStageState['status'] = 'passed'): ImportStageState => ({
  status,
  label: 'Stage',
  detail: 'test',
});

const stages = () => ({
  parse: stage(),
  validate: stage(),
  stage: stage(),
  dedupe: stage(),
  post: stage(),
});

async function createImportRecord(
  store: InMemoryImportStore,
  accountId: string,
  id = randomUUID(),
): Promise<ImportRecord> {
  return store.createImport({
    id,
    accountId,
    fileHash: createHash('sha256').update(id).digest('hex'),
    filename: `${id}.csv`,
    source: 'csv',
    status: 'posted',
    stages: stages(),
    counts: { parsed: 0, rejected: 0, duplicates: 0, posted: 0 },
    statement: {
      currency: 'USD',
      start: null,
      end: null,
      openingBalanceMinor: null,
      closingBalanceMinor: null,
      rowCount: 0,
      balanceIssues: 0,
    },
  });
}

function transactionInput(accountId: string, importId: string, index: number, postedDate: string) {
  const hash = createHash('sha256').update(`${importId}:${index}`).digest('hex');
  return {
    id: randomUUID(),
    accountId,
    importId,
    rawRowId: null,
    lineNumber: index + 2,
    postedDate,
    amountMinor: -100 - index,
    currency: 'USD',
    descriptorRaw: 'BLUE BOTTLE COFFEE',
    descriptorClean: 'blue bottle coffee',
    merchantId: null,
    categoryId: 'dining' as const,
    source: 'csv' as const,
    externalId: null,
    dedupeKey: hash,
    idempotencyKey: `import-${hash}-${index + 2}`,
    pipelineVersion: 'm3.1.0',
    createdAt: NOW.toISOString(),
  };
}

describe('raw row staging encryption', () => {
  it('does not leave descriptor text in the staged payload at rest', async () => {
    const imports = new InMemoryImportStore(cipher);
    await runImport(imports, {
      accountId: 'acct-encrypted-raw',
      filename: 'statement.csv',
      content: 'Date,Description,Amount\n2026-07-15,BLUE BOTTLE COFFEE,-5.50\n',
    }, () => NOW);

    const rows = (imports as unknown as { rawRows: Array<{ payload: unknown }> }).rawRows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('BLUE BOTTLE COFFEE');
    expect(JSON.stringify(rows[0]!.payload)).toContain('enc:v1:');
  });
});

describe('account deletion removes imports', () => {
  it('deletes imports, transactions and presets with the account', async () => {
    const auth = new InMemoryAuthStore();
    const userId = randomUUID();
    const accountId = randomUUID();
    const password = 'review-fix-password';
    await auth.insert({
      id: userId,
      email: 'review-fix@example.com',
      passwordHash: await hashPassword(password),
      displayName: 'Sam Lee',
      accountId,
      ownerId: 'sam',
    });
    const token = newSessionToken();
    await auth.saveSession(hashSessionToken(token), userId, new Date(NOW.getTime() + 3_600_000), { createdAt: NOW });
    const cookie = `${SESSION_COOKIE}=${token}`;

    const imports = new InMemoryImportStore(cipher);
    const app = appWith(imports, auth);
    const upload = await app.request(`/api/accounts/${accountId}/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.90' },
      body: JSON.stringify({
        filename: 'statement.csv',
        content: 'Date,Description,Amount\n2026-07-15,BLUE BOTTLE COFFEE,-5.50\n',
      }),
    });
    expect(upload.status).toBe(201);
    await imports.savePreset(accountId, {
      name: 'My bank',
      source: 'csv',
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    });
    expect(await imports.listImports(accountId)).toHaveLength(1);

    const stepUp = await app.request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.91' },
      body: JSON.stringify({ password }),
    });
    expect(stepUp.status).toBe(200);
    const deleted = await app.request('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.92' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(deleted.status).toBe(200);
    expect(await imports.listImports(accountId)).toEqual([]);
    expect(await imports.listTransactions(accountId)).toEqual([]);
    expect(await imports.listPresets(accountId)).toHaveLength(2); // built-ins only
  });
});

describe('SGML OFX transaction boundaries', () => {
  it('parses blocks that end where the next STMTTRN or BANKTRANLIST begins', () => {
    const ofx = [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      '<OFX>',
      '<BANKTRANLIST>',
      '<STMTTRN>',
      '<DTPOSTED>20260701120000[-5:EST]',
      '<TRNAMT>-12.34',
      '<FITID>sgml-1',
      '<NAME>BLUE BOTTLE COFFEE',
      '<STMTTRN>',
      '<DTPOSTED>20260702120000[-5:EST]',
      '<TRNAMT>-5.00',
      '<FITID>sgml-2',
      '<NAME>CORNER STORE',
      '</BANKTRANLIST>',
      '</OFX>',
    ].join('\n');
    const parsed = parseImportFile('sgml.ofx', ofx);
    expect(parsed.rows.map((row) => row.externalId)).toEqual(['sgml-1', 'sgml-2']);
    expect(parsed.rows.map((row) => row.amountMinor)).toEqual([-1234, -500]);
  });
});

describe('retrying non-posted imports', () => {
  it('runs the same file again after a corrected sign setting', async () => {
    const imports = new InMemoryImportStore(cipher);
    const content = 'Date,Description,Amount\n2026-07-01,Coffee,5.50\n2026-07-02,Groceries,40.00\n';
    const first = await runImport(imports, {
      accountId: 'acct-retry',
      filename: 'credit.csv',
      content,
      accountKind: 'credit',
    }, () => NOW);
    expect(first.import.status).toBe('failed');

    const second = await runImport(imports, {
      accountId: 'acct-retry',
      filename: 'credit.csv',
      content,
      accountKind: 'credit',
      mapping: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        dateFormat: 'auto',
        amountSign: 'invert',
        currency: 'USD',
      },
    }, () => NOW);
    expect(second.created).toBe(true);
    expect(second.import.status).toBe('posted');
    expect(second.import.counts.posted).toBe(2);
    expect(await imports.listTransactions('acct-retry')).toHaveLength(2);
  });
});

describe('overlapping identical rows without a bank id', () => {
  it('keeps a later partial overlap instead of silently discarding it', async () => {
    const imports = new InMemoryImportStore(cipher);
    const first = await runImport(imports, {
      accountId: 'acct-overlap',
      filename: 'full.csv',
      content: 'Date,Description,Amount\n2026-07-15,Coffee,-5.50\n2026-07-15,Coffee,-5.50\n',
    }, () => NOW);
    expect(first.import.counts.posted).toBe(2);

    const second = await runImport(imports, {
      accountId: 'acct-overlap',
      filename: 'partial.csv',
      content: 'Date,Description,Amount\n2026-07-15,Coffee,-5.50\n',
    }, () => NOW);
    expect(second.import.status).toBe('posted');
    expect(second.import.counts.posted).toBe(1);
    expect(second.import.counts.duplicates).toBe(0);
    expect(await imports.listTransactions('acct-overlap')).toHaveLength(3);
  });

  it('uses a bank transaction id when one is available', () => {
    const row = {
      postedDate: '2026-07-15',
      amountMinor: -550,
      descriptorClean: 'blue bottle coffee',
      lineNumber: 2,
      externalId: 'fitid-1',
    };
    const first = assignDedupeKeys('acct-id', [row]);
    const second = assignDedupeKeys('acct-id', [{ ...row, lineNumber: 40 }]);
    const different = assignDedupeKeys('acct-id', [{ ...row, externalId: 'fitid-2' }]);
    expect(first[0]!.dedupeKey).toBe(second[0]!.dedupeKey);
    expect(first[0]!.dedupeKey).not.toBe(different[0]!.dedupeKey);
  });
});

describe('import detail reads', () => {
  it('returns an older import even when newer imports exceed the old page cap', async () => {
    const imports = new InMemoryImportStore();
    const accountId = ME;
    const older = await createImportRecord(imports, accountId);
    await imports.insertTransaction(transactionInput(accountId, older.id, 0, '2020-01-01'));
    const newer = await createImportRecord(imports, accountId);
    for (let index = 0; index < 10_001; index++) {
      await imports.insertTransaction(transactionInput(accountId, newer.id, index, '2026-09-01'));
    }

    const app = appWith(imports);
    const res = await app.request(`/api/accounts/${accountId}/imports/${older.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { transactions: Array<{ importId: string }> };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]!.importId).toBe(older.id);
  });

  it('supports import-scoped pagination in the store', async () => {
    const imports = new InMemoryImportStore();
    const accountId = ME;
    const target = await createImportRecord(imports, accountId);
    const other = await createImportRecord(imports, accountId);
    for (let index = 0; index < 5; index++) {
      await imports.insertTransaction(transactionInput(accountId, target.id, index, '2026-08-01'));
      await imports.insertTransaction(transactionInput(accountId, other.id, index, '2026-09-01'));
    }
    const firstPage = await imports.listTransactions(accountId, { importId: target.id, limit: 2, offset: 0 });
    const secondPage = await imports.listTransactions(accountId, { importId: target.id, limit: 2, offset: 2 });
    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(2);
    expect(new Set([...firstPage, ...secondPage].map((row) => row.id)).size).toBe(4);
    expect([...firstPage, ...secondPage].every((row) => row.importId === target.id)).toBe(true);
  });
});

describe('upload limit before reading the body', () => {
  it('rejects an oversized Content-Length with 413', async () => {
    const imports = new InMemoryImportStore();
    const app = appWith(imports);
    const res = await app.request(`/api/accounts/${ME}/imports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '2000001',
        'x-forwarded-for': '203.0.113.93',
      },
      body: JSON.stringify({ filename: 'statement.csv', content: 'Date,Description,Amount\n' }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'file_too_large' });
    expect(await imports.listImports(ME)).toHaveLength(0);
  });
});

describe('M4 enrichment on imported rows', () => {
  it('cleans and categorizes through the account rules', async () => {
    const imports = new InMemoryImportStore(cipher);
    const enrichment = new InMemoryEnrichmentStore(() => NOW);
    await enrichment.createRule('acct-enriched', {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: null,
      category: 'health',
    }, NOW);

    const result = await runImport(imports, {
      accountId: 'acct-enriched',
      filename: 'statement.csv',
      content: 'Date,Description,Amount\n2026-07-20,STARBUCKS STORE 0421,-6.35\n',
      enrichment,
    }, () => NOW);
    expect(result.import.status).toBe('posted');
    expect(result.transactions[0]).toMatchObject({
      descriptorClean: 'STARBUCKS',
      categoryId: 'health',
    });
  });
});
