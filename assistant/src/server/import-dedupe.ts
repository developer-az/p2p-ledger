/**
 * M3.3 — dedupe keys include an occurrence index.
 *
 * A bank statement can contain two identical coffees on the same day. Hashing
 * only date+amount+descriptor would silently drop one. Within a file, rows are
 * numbered 0,1,2… in file order; an overlapping file produces the same
 * sequence again, so its copies match the originals.
 */
import { createHash } from 'node:crypto';

export interface DedupeCandidate {
  postedDate: string;
  amountMinor: number;
  descriptorClean: string;
  lineNumber: number;
}

export interface KeyedRow<T extends DedupeCandidate> {
  row: T;
  occurrenceIndex: number;
  dedupeKey: string;
}

export function cleanDescriptor(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+#\d+$/, '')
    .replace(/^pos\s+(debit|purchase)\s+/, '')
    .trim();
}

function baseKey(accountId: string, row: DedupeCandidate): string {
  return [
    accountId.trim().toLowerCase(),
    row.postedDate,
    String(row.amountMinor),
    row.descriptorClean,
  ].join('\u0000');
}

export function dedupeKeyFor(accountId: string, row: DedupeCandidate, occurrenceIndex: number): string {
  return createHash('sha256')
    .update(`${baseKey(accountId, row)}\u0000${occurrenceIndex}`, 'utf8')
    .digest('hex');
}

/**
 * Assign occurrence indexes per (date, amount, descriptor) group in file order.
 * The order is deterministic, so re-importing the same file reproduces keys.
 */
export function assignDedupeKeys<T extends DedupeCandidate>(
  accountId: string,
  rows: readonly T[],
): KeyedRow<T>[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = baseKey(accountId, row);
    const occurrenceIndex = seen.get(base) ?? 0;
    seen.set(base, occurrenceIndex + 1);
    return { row, occurrenceIndex, dedupeKey: dedupeKeyFor(accountId, row, occurrenceIndex) };
  });
}

export function splitNewRows<T extends { dedupeKey: string }>(
  rows: readonly T[],
  existing: ReadonlySet<string>,
): { fresh: T[]; duplicates: T[] } {
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const row of rows) {
    if (existing.has(row.dedupeKey)) duplicates.push(row);
    else fresh.push(row);
  }
  return { fresh, duplicates };
}
