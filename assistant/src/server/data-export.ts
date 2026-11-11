/**
 * CSV rendering for the data-rights export.
 *
 * Cells follow RFC 4180: wrap in double quotes when they contain a comma,
 * quote, CR or LF, and double any embedded quote. A leading =, +, -, @, tab or
 * CR is prefixed with an apostrophe so a spreadsheet treats it as text rather
 * than a formula.
 */
import type { IncomeLogEntry } from './personal-finance.js';
import type { SpendLogEntry } from './spend-log.js';

const CSV_HEADER = ['kind', 'date', 'amount_minor', 'currency', 'note'] as const;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const CSV_HEADER_ROW = CSV_HEADER.map(csvCell).join(',') + '\r\n';

export interface CsvExportInput {
  income: IncomeLogEntry[];
  spendLogs: SpendLogEntry[];
}

/** One CRLF-terminated CSV line for a streamed export page. */
export function csvExportRow(kind: 'income' | 'spend',
  entry: IncomeLogEntry | SpendLogEntry): string {
  return [
    kind,
    entry.occurredAt,
    String(entry.amountMinor),
    entry.currency,
    entry.note ?? '',
  ].map(csvCell).join(',') + '\r\n';
}

/** Renders income and spend rows with a single header row, CRLF terminated. */
export function buildCsvExport({ income, spendLogs }: CsvExportInput): string {
  const lines: string[] = [CSV_HEADER_ROW];
  const dated = [
    ...income.map((entry) => ({ kind: 'income' as const, entry })),
    ...spendLogs.map((entry) => ({ kind: 'spend' as const, entry })),
  ].sort((a, b) => a.entry.occurredAt.localeCompare(b.entry.occurredAt));

  for (const { kind, entry } of dated) lines.push(csvExportRow(kind, entry));
  return lines.join('');
}
