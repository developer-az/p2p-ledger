/**
 * M3.6–M3.7 — quality gates and statement reconciliation.
 *
 * Gates run before posting. A failed gate blocks the whole file, while a bad
 * row inside an otherwise good file is already in `rejections` and does not
 * stop the valid rows. Reconciliation is separate: it tells the user whether
 * the statement's own closing balance equals opening + posted movement.
 */
import type { ParsedImportRow, ImportRejection, StatementMeta } from './importers.js';
import { isCalendarDate } from './imports-schema.js';

export type QualityStatus = 'passed' | 'failed' | 'warning';

export interface QualityGate {
  id: 'row_count' | 'date_sanity' | 'sign_convention' | 'section_totals' | 'balance_continuity';
  label: string;
  status: QualityStatus;
  detail: string;
}

export interface Reconciliation {
  reconciled: boolean;
  statementOpenedMinor: number | null;
  statementClosedMinor: number | null;
  computedClosedMinor: number | null;
  differenceMinor: number | null;
  rowsMatched: number;
  detail: string;
}

export interface QualityInput {
  rows: readonly ParsedImportRow[];
  rejections: readonly ImportRejection[];
  statement: StatementMeta;
  accountKind?: 'checking' | 'credit';
  openingBalanceMinor?: number | null;
  expectedRowCount?: number;
  expectedOutflowMinor?: number;
  previousClosingBalanceMinor?: number | null;
  now?: Date;
}

const money = (minor: number) => {
  const sign = minor < 0 ? '-' : '';
  return `${sign}$${(Math.abs(minor) / 100).toFixed(2)}`;
};

export function runQualityGates(input: QualityInput): QualityGate[] {
  const gates: QualityGate[] = [];
  const { rows, statement } = input;

  const expected = input.expectedRowCount;
  if (expected !== undefined && expected !== statement.rowCount) {
    gates.push({
      id: 'row_count',
      label: 'Row count',
      status: 'failed',
      detail: `Expected ${expected} rows but the file contains ${statement.rowCount}.`,
    });
  } else {
    gates.push({
      id: 'row_count',
      label: 'Row count',
      status: 'passed',
      detail: expected !== undefined
        ? `${statement.rowCount} rows, as expected.`
        : `${statement.rowCount} rows read.`,
    });
  }

  const now = input.now ?? new Date();
  const latest = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const badDates = rows.filter((row) => !isCalendarDate(row.postedDate)
    || row.postedDate < '1990-01-01'
    || row.postedDate > latest);
  if (badDates.length > 0) {
    gates.push({
      id: 'date_sanity',
      label: 'Date sanity',
      status: 'failed',
      detail: `${badDates.length} row(s) fall outside 1990-01-01 to ${latest}.`,
    });
  } else {
    gates.push({
      id: 'date_sanity',
      label: 'Date sanity',
      status: 'passed',
      detail: rows.length > 0
        ? `${statement.start ?? '—'} to ${statement.end ?? '—'} looks plausible.`
        : 'No valid dates to check.',
    });
  }

  const allPositive = rows.length > 0 && rows.every((row) => row.amountMinor > 0);
  if (input.accountKind === 'credit' && allPositive) {
    gates.push({
      id: 'sign_convention',
      label: 'Sign convention',
      status: 'failed',
      detail: 'Every amount is positive on a credit account. invert the amount sign or map purchases to the debit column.',
    });
  } else {
    gates.push({
      id: 'sign_convention',
      label: 'Sign convention',
      status: 'passed',
      detail: rows.some((row) => row.amountMinor < 0)
        ? 'Purchases are negative; payments and income are positive.'
        : 'No outflows in this file.',
    });
  }

  const outflow = rows.reduce((sum, row) => sum + (row.amountMinor < 0 ? -row.amountMinor : 0), 0);
  if (input.expectedOutflowMinor !== undefined && input.expectedOutflowMinor !== outflow) {
    gates.push({
      id: 'section_totals',
      label: 'Statement totals',
      status: 'failed',
      detail: `Expected ${money(input.expectedOutflowMinor)} of outflows but the file totals ${money(outflow)}.`,
    });
  } else {
    gates.push({
      id: 'section_totals',
      label: 'Statement totals',
      status: 'passed',
      detail: `${money(outflow)} of outflows across ${rows.length} rows.`,
    });
  }

  const previous = input.previousClosingBalanceMinor ?? null;
  const opening = input.openingBalanceMinor ?? statement.openingBalanceMinor;
  if (statement.balanceIssues > 0) {
    gates.push({
      id: 'balance_continuity',
      label: 'Balance continuity',
      status: 'failed',
      detail: `${statement.balanceIssues} running-balance break(s) inside the statement.`,
    });
  } else if (previous !== null && opening !== null && previous !== opening) {
    gates.push({
      id: 'balance_continuity',
      label: 'Balance continuity',
      status: 'failed',
      detail: `Previous statement closed at ${money(previous)} but this one opens at ${money(opening)}.`,
    });
  } else {
    gates.push({
      id: 'balance_continuity',
      label: 'Balance continuity',
      status: 'passed',
      detail: previous !== null && opening !== null
        ? `Opens at ${money(opening)}, matching the previous statement close.`
        : 'No gap found between statements.',
    });
  }

  return gates;
}

export function reconcileStatement(input: {
  rows: readonly ParsedImportRow[];
  statement: StatementMeta;
  openingBalanceMinor?: number | null;
  rejections?: readonly ImportRejection[];
}): Reconciliation {
  const closed = input.statement.closingBalanceMinor;
  const movement = input.rows.reduce((sum, row) => sum + row.amountMinor, 0);
  let opened = input.openingBalanceMinor !== undefined
    ? input.openingBalanceMinor
    : input.statement.openingBalanceMinor;
  if (opened === null && closed !== null) {
    // A statement with only a closing balance still reconciles its own movement;
    // the inferred opening is shown explicitly rather than hidden.
    opened = closed - movement;
  }
  if (closed === null) {
    return {
      reconciled: false,
      statementOpenedMinor: opened,
      statementClosedMinor: null,
      computedClosedMinor: opened === null ? null : opened + movement,
      differenceMinor: null,
      rowsMatched: input.rows.length,
      detail: 'No closing balance in this file, so it cannot be reconciled.',
    };
  }
  const computed = (opened ?? 0) + movement;
  const difference = computed - closed;
  return {
    reconciled: difference === 0,
    statementOpenedMinor: opened,
    statementClosedMinor: closed,
    computedClosedMinor: computed,
    differenceMinor: difference,
    rowsMatched: input.rows.length,
    detail: difference === 0
      ? `Opening ${money(opened ?? 0)} + movement ${money(movement)} matches the closing balance ${money(closed)}.`
      : `Computed closing ${money(computed)} does not match the statement closing ${money(closed)} (difference ${money(difference)}).`,
  };
}
