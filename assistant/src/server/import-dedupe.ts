/**
 * M3.3 — stable dedupe keys for overlapping statements.
 *
 * A bank transaction id is the strongest identity: the same FITID in two
 * exports is the same row no matter where it appears in the file. Without one,
 * rows are grouped by date+amount+descriptor and numbered in file order. When
 * a later export contains fewer copies of a group than the account already has,
 * the overlap is ambiguous (it could be any of the existing copies), so those
 * rows are kept under a file-local key instead of being silently discarded.
 */
import { createHash } from 'node:crypto';

export interface DedupeCandidate {
  postedDate: string;
  amountMinor: number;
  descriptorClean: string;
  lineNumber: number;
  /** Bank transaction id (OFX FITID). Preferred over occurrence matching. */
  externalId?: string | null;
}

export interface KeyedRow<T extends DedupeCandidate> {
  row: T;
  occurrenceIndex: number;
  dedupeKey: string;
  /** Stable group identity used to detect ambiguous overlaps. */
  groupKey: string;
  /** True when the bank supplied an id, so occurrence indexes do not apply. */
  external: boolean;
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

function externalBaseKey(accountId: string, externalId: string): string {
  return [accountId.trim().toLowerCase(), 'bank-id', externalId].join('\u0000');
}

function keyForGroup(groupKey: string, occurrenceIndex: number): string {
  return createHash('sha256')
    .update(`${groupKey}\u0000${occurrenceIndex}`, 'utf8')
    .digest('hex');
}

function ambiguousKey(groupKey: string, lineNumber: number): string {
  return createHash('sha256')
    .update(`${groupKey}\u0000ambiguous\u0000${lineNumber}`, 'utf8')
    .digest('hex');
}

export function dedupeKeyFor(accountId: string, row: DedupeCandidate, occurrenceIndex: number): string {
  const externalId = (row.externalId ?? '').trim();
  return keyForGroup(
    externalId ? externalBaseKey(accountId, externalId) : baseKey(accountId, row),
    externalId ? 0 : occurrenceIndex,
  );
}

/**
 * Assign occurrence indexes per (date, amount, descriptor) group in file order,
 * or use the bank transaction id when the importer supplied one. The order is
 * deterministic, so re-importing the same file reproduces keys.
 */
export function assignDedupeKeys<T extends DedupeCandidate>(
  accountId: string,
  rows: readonly T[],
): KeyedRow<T>[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const externalId = (row.externalId ?? '').trim();
    const external = externalId !== '';
    const groupKey = external ? externalBaseKey(accountId, externalId) : baseKey(accountId, row);
    const occurrenceIndex = external ? 0 : (seen.get(groupKey) ?? 0);
    if (!external) seen.set(groupKey, occurrenceIndex + 1);
    return {
      row,
      occurrenceIndex,
      groupKey,
      external,
      dedupeKey: keyForGroup(groupKey, occurrenceIndex),
    };
  });
}

function rowLineNumber(row: { lineNumber?: number; row?: { lineNumber?: number } }): number {
  return Number(row.row?.lineNumber ?? row.lineNumber ?? 0);
}

export function splitNewRows<T extends { dedupeKey: string; groupKey?: string; external?: boolean; row?: { lineNumber: number }; lineNumber?: number }>(
  rows: readonly T[],
  existing: ReadonlySet<string>,
): { fresh: T[]; duplicates: T[] } {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.groupKey) continue;
    const group = groups.get(row.groupKey) ?? [];
    group.push(row);
    groups.set(row.groupKey, group);
  }

  // A group with fewer copies than the account already holds cannot be matched
  // by occurrence index: any incoming row could be any existing copy.
  const ambiguous = new Set<string>();
  for (const [groupKey, group] of groups) {
    if (group[0]!.external === true) continue;
    let existingCount = 0;
    while (existing.has(keyForGroup(groupKey, existingCount))) existingCount++;
    if (group.length < existingCount) ambiguous.add(groupKey);
  }

  const fresh: T[] = [];
  const duplicates: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const dedupeKey = row.groupKey && ambiguous.has(row.groupKey)
      ? ambiguousKey(row.groupKey, rowLineNumber(row))
      : row.dedupeKey;
    const resolved = dedupeKey === row.dedupeKey ? row : ({ ...row, dedupeKey } as T);
    if (existing.has(dedupeKey) || seen.has(dedupeKey)) {
      duplicates.push(resolved);
    } else {
      seen.add(dedupeKey);
      fresh.push(resolved);
    }
  }
  return { fresh, duplicates };
}
