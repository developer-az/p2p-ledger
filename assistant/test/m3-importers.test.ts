/**
 * M3.2 — generic CSV plus OFX/QFX as pure functions, with malformed files
 * rejected for a specific reason. Fixtures are synthetic and live in
 * test/fixtures/imports.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ImportParseError,
  parseCsvImport,
  parseImportFile,
  parseOfxImport,
  previewCsvImport,
  suggestMapping,
} from '../src/server/importers.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'imports');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const sample = fixture('subscription-radar-sample.csv');

function rejectionReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportParseError);
    return (error as ImportParseError).reason;
  }
  throw new Error('expected the importer to throw');
}

describe('CSV preview and mapping', () => {
  it('reads headers, suggests a mapping and keeps a sample', () => {
    const preview = previewCsvImport(sample);
    expect(preview.columns).toEqual(['Posted Date', 'Description', 'Amount', 'Running Balance']);
    expect(preview.delimiter).toBe(',');
    expect(preview.suggestedMapping).toMatchObject({
      date: 'Posted Date',
      description: 'Description',
      amount: 'Amount',
      balance: 'Running Balance',
    });
    expect(preview.sampleRows[0]![1]).toBe('BLUE BOTTLE COFFEE');
  });

  it('suggests debit/credit columns when a bank exports separate signs', () => {
    expect(suggestMapping(['Date', 'Memo', 'Debit', 'Credit'])).toMatchObject({
      date: 'Date',
      description: 'Memo',
      debit: 'Debit',
      credit: 'Credit',
      amount: null,
    });
  });
});

describe('generic CSV importer', () => {
  it('parses the subscription-radar fixture into 72 outflows and 6 inflows', () => {
    const parsed = parseImportFile('subscription-radar-sample.csv', sample);
    expect(parsed.source).toBe('csv');
    expect(parsed.rejections).toEqual([]);
    expect(parsed.rows).toHaveLength(78);
    expect(parsed.rows.filter((r) => r.amountMinor < 0)).toHaveLength(72);
    expect(parsed.rows.filter((r) => r.amountMinor > 0)).toHaveLength(6);
    expect(parsed.statement).toMatchObject({
      currency: 'USD',
      openingBalanceMinor: 100_000,
      closingBalanceMinor: 68_297,
      rowCount: 78,
    });
  });

  it('keeps both identical same-day coffees as separate parsed rows', () => {
    const parsed = parseImportFile('subscription-radar-sample.csv', sample);
    const coffees = parsed.rows.filter(
      (r) => r.descriptorClean === 'blue bottle coffee' && r.amountMinor === -550,
    );
    // The fixture has one coffee roughly every ninth row plus the deliberate
    // same-day pair on 2026-07-15. Every row must survive parsing.
    expect(coffees.length).toBeGreaterThanOrEqual(2);
    expect(parsed.rows.filter((r) => r.postedDate === '2026-07-15' && r.amountMinor === -550)).toHaveLength(2);
  });

  it('supports explicit debit/credit columns and day-first dates', () => {
    const parsed = parseCsvImport(
      'Date,Memo,Debit,Credit\n31/07/2026,Coffee,5.50,\n01/08/2026,Refund,,12.00\n',
      { date: 'Date', description: 'Memo', debit: 'Debit', credit: 'Credit', dateFormat: 'DMY', currency: 'USD' },
    );
    expect(parsed.rows.map((r) => r.amountMinor)).toEqual([-550, 1200]);
    expect(parsed.rows.map((r) => r.postedDate)).toEqual(['2026-07-31', '2026-08-01']);
  });

  it('inverts signs for a credit-card export that lists purchases as positive', () => {
    const parsed = parseCsvImport(
      'Date,Description,Amount\n2026-07-01,Coffee,5.50\n2026-07-02,Payment,-50.00\n',
      { date: 'Date', description: 'Description', amount: 'Amount', amountSign: 'invert', currency: 'USD' },
    );
    expect(parsed.rows.map((r) => r.amountMinor)).toEqual([-550, 5000]);
  });

  it('rejects individual bad rows with row numbers and reasons', () => {
    const parsed = parseImportFile('bad-rows.csv', fixture('bad-rows.csv'));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.descriptorClean).toBe('good coffee');
    expect(parsed.rejections).toEqual([
      expect.objectContaining({ lineNumber: 2, reason: 'bad_date' }),
      expect.objectContaining({ lineNumber: 4, reason: 'bad_amount' }),
    ]);
  });

  it('rejects malformed files instead of guessing', () => {
    expect(rejectionReason(() => parseImportFile('malformed-quote.csv', fixture('malformed-quote.csv'))))
      .toBe('unterminated_quote');
    expect(rejectionReason(() => parseImportFile('empty.csv', fixture('empty.csv')))).toBe('empty_file');
    expect(rejectionReason(() => parseImportFile('statement.pdf', '%PDF-1.7'))).toBe('unsupported_type');
    expect(rejectionReason(() => parseImportFile('no-transactions.ofx', fixture('no-transactions.ofx'))))
      .toBe('no_transactions');
  });
});

describe('OFX/QFX importer', () => {
  it.each(['statement.ofx', 'statement.qfx'])('parses %s and its closing balance', (name) => {
    const parsed = parseImportFile(name, fixture(name));
    expect(parsed.source).toBe(name.endsWith('.qfx') ? 'qfx' : 'ofx');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((r) => r.amountMinor)).toEqual([-1234, -500, 25_190]);
    expect(parsed.rows[0]).toMatchObject({
      postedDate: '2026-07-01',
      descriptorRaw: 'BLUE BOTTLE COFFEE',
      descriptorClean: 'blue bottle coffee',
      currency: 'USD',
      externalId: '2026070101',
    });
    expect(parsed.statement).toMatchObject({
      currency: 'USD',
      closingBalanceMinor: 123_456,
      rowCount: 3,
    });
  });

  it('parses SGML OFX without XML namespaces', () => {
    const parsed = parseOfxImport(fixture('statement.ofx'));
    expect(parsed.rows[2]!.amountMinor).toBe(25_190);
  });
});
