/**
 * M3.5 — pure UI helpers behind the Imports page: upload limits, mapping
 * defaults and the stage-by-stage progress model. Rendered markup is covered
 * by the existing app tests; keeping this logic pure makes the limits and
 * rejection reasons testable without a browser.
 */
import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_BYTES,
  importFileError,
  importStageSteps,
  importSummary,
  mappingFromForm,
  mappingToForm,
} from '../src/web/app/imports-ui.js';
import type { ImportRecord } from '../src/server/imports-store.js';

const record: ImportRecord = {
  id: 'imp-1',
  accountId: 'acct-1',
  presetId: null,
  fileHash: 'f'.repeat(64),
  filename: 'statement.csv',
  source: 'csv',
  status: 'posted',
  pipelineVersion: 'm3.1.0',
  stages: {
    parse: { status: 'passed', label: 'Parse', detail: 'Read 80 rows' },
    validate: { status: 'passed', label: 'Validate', detail: '78 valid, 2 rejected' },
    stage: { status: 'passed', label: 'Stage', detail: 'Staged 78 raw rows' },
    dedupe: { status: 'passed', label: 'Dedupe', detail: '12 duplicates skipped' },
    post: { status: 'passed', label: 'Post', detail: 'Posted 66 transactions' },
  },
  counts: { parsed: 80, rejected: 2, duplicates: 12, posted: 66 },
  statement: {
    currency: 'USD',
    start: '2026-07-01',
    end: '2026-07-31',
    openingBalanceMinor: 100_000,
    closingBalanceMinor: 68_297,
    rowCount: 80,
    balanceIssues: 0,
  },
  quality: [],
  reconciliation: {
    reconciled: true,
    statementOpenedMinor: 100_000,
    statementClosedMinor: 68_297,
    computedClosedMinor: 68_297,
    differenceMinor: 0,
    rowsMatched: 78,
    detail: 'Statement balance matches',
  },
  errors: [
    { lineNumber: 12, reason: 'bad_date', detail: '2026-02-31 is not a date' },
    { lineNumber: 40, reason: 'bad_amount', detail: 'abc is not money' },
  ],
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:00:00.000Z',
};

describe('upload limits', () => {
  it('accepts CSV, OFX and QFX inside the size limit', () => {
    expect(importFileError({ name: 'statement.csv', size: 2048 })).toBeNull();
    expect(importFileError({ name: 'statement.OFX', size: 2048 })).toBeNull();
    expect(importFileError({ name: 'statement.qfx', size: IMPORT_MAX_BYTES })).toBeNull();
  });

  it('rejects PDFs and other unsupported types before reading the file', () => {
    expect(importFileError({ name: 'statement.pdf', size: 2048 })).toBe('unsupported_type');
    expect(importFileError({ name: 'statement.xlsx', size: 2048 })).toBe('unsupported_type');
    expect(importFileError({ name: 'statement', size: 2048 })).toBe('unsupported_type');
  });

  it('rejects empty and oversized files with distinct reasons', () => {
    expect(importFileError({ name: 'statement.csv', size: 0 })).toBe('empty_file');
    expect(importFileError({ name: 'statement.csv', size: IMPORT_MAX_BYTES + 1 })).toBe('file_too_large');
  });
});

describe('column mapping form', () => {
  it('round-trips a saved preset', () => {
    const mapping = {
      date: 'Posted Date',
      description: 'Description',
      amount: 'Amount',
      debit: null,
      credit: null,
      balance: 'Running Balance',
      dateFormat: 'auto' as const,
      amountSign: 'as-is' as const,
      currency: 'USD',
      category: 'Category',
    };
    expect(mappingFromForm(mappingToForm(mapping))).toEqual(mapping);
  });
});

describe('stage progress and summary', () => {
  it('shows five stages in pipeline order with counts and rejection reasons', () => {
    const steps = importStageSteps(record);
    expect(steps.map((s) => s.id)).toEqual(['parse', 'validate', 'stage', 'dedupe', 'post']);
    expect(steps[1]!.detail).toContain('2 rejected');
    expect(steps[3]!.detail).toContain('12 duplicates');
    expect(steps.every((s) => s.status === 'passed')).toBe(true);
    expect(importSummary(record)).toMatchObject({
      parsed: 80,
      rejected: 2,
      duplicates: 12,
      posted: 66,
      reconciled: true,
    });
  });

  it('keeps rejected rows visible with a human reason', () => {
    const steps = importStageSteps(record);
    const rejected = steps.find((s) => s.id === 'validate');
    expect(rejected?.rejections).toEqual([
      expect.objectContaining({ lineNumber: 12, reason: 'bad_date', message: expect.stringContaining('not a date') }),
      expect.objectContaining({ lineNumber: 40, reason: 'bad_amount' }),
    ]);
  });
});
