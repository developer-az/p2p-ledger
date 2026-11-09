/**
 * Demo-only display overlay for Settle Up.
 *
 * Practice requests are seeded per serverless instance under fixed ids. When the
 * pay/decline call lands on instance A and the next list lands on instance B, B
 * has just seeded the same row as PENDING again, so a resolved request reappears
 * as open. This module remembers what this tab already resolved (sessionStorage,
 * keyed per account) and paints that status over a stale PENDING row.
 *
 * Live accounts are untouched: the overlay only reads and writes for the three
 * practice account ids.
 */
import type { PaymentRequestView, SettleRail } from '../api.js';
import { PRACTICE_ANTHONY_ID, PRACTICE_JORDAN_ID, PRACTICE_SAM_ID } from '../practice-fixture.js';

export type ResolvedStatus = 'PAID' | 'DECLINED' | 'CANCELLED';

export interface ResolvedMark {
  status: ResolvedStatus;
  settledVia: SettleRail | null;
}

const PRACTICE_ACCOUNT_IDS = new Set([PRACTICE_ANTHONY_ID, PRACTICE_SAM_ID, PRACTICE_JORDAN_ID]);

export function isPracticeAccountId(accountId: string): boolean {
  return PRACTICE_ACCOUNT_IDS.has(accountId);
}

export interface RequestRows {
  incoming: PaymentRequestView[];
  outgoing: PaymentRequestView[];
}

const keyFor = (accountId: string) => `settle:resolved:${accountId}`;

/** Storage can throw (private mode, blocked cookies); the overlay is best-effort. */
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readResolvedMarks(accountId: string): Record<string, ResolvedMark> {
  if (!isPracticeAccountId(accountId)) return {};
  const box = storage();
  if (!box) return {};
  try {
    const raw = box.getItem(keyFor(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, ResolvedMark>
      : {};
  } catch {
    return {};
  }
}

export function rememberResolved(accountId: string, id: string, mark: ResolvedMark): void {
  if (!isPracticeAccountId(accountId)) return;
  const box = storage();
  if (!box) return;
  try {
    const marks = readResolvedMarks(accountId);
    marks[id] = mark;
    box.setItem(keyFor(accountId), JSON.stringify(marks));
  } catch {
    /* A full or blocked store must not break an action that already succeeded. */
  }
}

/** Paint remembered resolutions over rows another instance still serves as PENDING. */
export function applyResolvedOverlay(accountId: string, rows: RequestRows): RequestRows {
  const marks = readResolvedMarks(accountId);
  const overlay = (row: PaymentRequestView): PaymentRequestView => {
    if (row.status !== 'PENDING') return row;
    const mark = marks[row.id];
    if (!mark) return row;
    return { ...row, status: mark.status, settledVia: mark.settledVia };
  };
  return { incoming: rows.incoming.map(overlay), outgoing: rows.outgoing.map(overlay) };
}
