/**
 * Regression tests for the second M3 review pass:
 * ambiguous dedupe keys carry the file hash, and import uploads enforce the
 * size limit while streaming the body instead of trusting Content-Length.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { assignDedupeKeys, dedupeKeyFor, splitNewRows } from '../src/server/import-dedupe.js';
import { InMemoryImportStore } from '../src/server/imports-store.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerWriter } from '../src/server/ledger.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

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

const coffee = {
  postedDate: '2026-07-15',
  amountMinor: -550,
  descriptorClean: 'blue bottle coffee',
  lineNumber: 10,
};

describe('ambiguous overlap dedupe keys', () => {
  it('keeps the same group and line from two different files', () => {
    // The account already holds three copies of this group, so a two-row
    // statement cannot be matched by occurrence index.
    const existing = new Set([
      dedupeKeyFor('acct-id', coffee, 0),
      dedupeKeyFor('acct-id', coffee, 1),
      dedupeKeyFor('acct-id', coffee, 2),
    ]);
    const statement = () => assignDedupeKeys('acct-id', [
      { ...coffee, lineNumber: 10 },
      { ...coffee, lineNumber: 11 },
    ]);

    const first = splitNewRows(statement(), existing, 'file-a');
    expect(first.fresh).toHaveLength(2);
    expect(first.duplicates).toHaveLength(0);

    const afterFirst = new Set([...existing, ...first.fresh.map((row) => row.dedupeKey)]);
    const second = splitNewRows(statement(), afterFirst, 'file-b');
    expect(second.duplicates).toHaveLength(0);
    expect(second.fresh).toHaveLength(2);
    expect(second.fresh.map((row) => row.dedupeKey))
      .not.toEqual(first.fresh.map((row) => row.dedupeKey));

    // Re-reading the same bytes stays a duplicate, even in the ambiguous case.
    const repeat = splitNewRows(statement(), afterFirst, 'file-a');
    expect(repeat.fresh).toHaveLength(0);
    expect(repeat.duplicates).toHaveLength(2);
  });
});

describe('streamed upload limits', () => {
  it('rejects an oversized chunked upload with no Content-Length', async () => {
    const imports = new InMemoryImportStore();
    const app = appWith(imports);
    const chunk = new TextEncoder().encode('x'.repeat(64_000));
    const total = 4_000_000;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) {
          controller.close();
          return;
        }
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`http://localhost/api/accounts/${ME}/imports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.94',
      },
      body,
      duplex: 'half',
    } as RequestInit);

    expect(request.headers.get('content-length')).toBeNull();
    const res = await app.request(request);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'file_too_large' });
    // Reading stopped just past the 2 MB limit instead of draining all 4 MB.
    expect(pulled).toBeLessThan(total);
    expect(pulled).toBeLessThanOrEqual(2_000_000 + 4 * chunk.byteLength);
    expect(await imports.listImports(ME)).toHaveLength(0);
  });

  it('still reads a normal streamed upload', async () => {
    const imports = new InMemoryImportStore();
    const app = appWith(imports);
    const payload = JSON.stringify({ filename: 'statement.csv', content: 'Date,Description,Amount\n2026-10-01,Coffee,-5.50\n' });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const request = new Request(`http://localhost/api/accounts/${ME}/imports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);

    expect(request.headers.get('content-length')).toBeNull();
    const res = await app.request(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'csv' });
  });
});
