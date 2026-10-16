import { randomUUID } from 'node:crypto';
import type { Account, LedgerAuditor, LedgerReader, Transfer, TransferRequest, TransferTrail, WriteResult } from './ledger.js';
import { formatMoney } from './money.js';
import { DECLINE_REASONS } from './tools.js';

/**
 * The operator console: what the database holds for one payment, and the actions that prove
 * the ledger's guarantees against the real service. Every lookup is scoped to the account being
 * viewed, so a transfer id alone cannot open someone else's payment.
 */

type Ledger = LedgerReader & LedgerAuditor;

export const RACE_COPIES = 5;
export const RACE_AMOUNT_MINOR = 500;

const touches = (t: Transfer, accountId: string) => t.sourceAccountId === accountId || t.destinationAccountId === accountId;

async function scopedTrail(ledger: Ledger, accountId: string, transferId: string): Promise<TransferTrail | null> {
  const trail = await ledger.trail(transferId);
  return trail && touches(trail.transfer, accountId) ? trail : null;
}

/**
 * Rebuilds the legs from the account statements when the ledger build predates the trail
 * endpoint. The idempotency key and events are not exposed there, so they come back empty.
 */
async function trailFromStatements(ledger: Ledger, accountId: string, transferId: string): Promise<TransferTrail | null> {
  const transfer = await ledger.getTransfer(transferId);
  if (!transfer || !touches(transfer, accountId)) return null;
  const statements = await Promise.all(
    [transfer.sourceAccountId, transfer.destinationAccountId].map((id) => ledger.entries(id, 200).catch(() => [])),
  );
  const entries = statements.flat().filter((e) => e.transferId === transferId).sort((a, b) => a.id - b.id);
  return { transfer, idempotencyKey: '', requestHash: '', entries, events: [] };
}

function label(account: Account | null): string {
  if (!account) return 'unknown';
  return account.type === 'SYSTEM' ? 'Bank funding (system account)' : account.ownerId;
}

/** The exact request a client sent, rebuilt from the stored transfer so it can be sent again byte for byte. */
function originalRequest(t: Transfer): { path: string; body: Record<string, unknown> } {
  const memo = t.memo === null ? {} : { memo: t.memo };
  if (t.kind === 'DEPOSIT') {
    return { path: `/v1/accounts/${t.destinationAccountId}/deposits`, body: { amountMinor: t.amountMinor, ...memo } };
  }
  return {
    path: '/v1/transfers',
    body: {
      sourceAccountId: t.sourceAccountId,
      destinationAccountId: t.destinationAccountId,
      amountMinor: t.amountMinor,
      currency: t.currency,
      ...memo,
    },
  };
}

function resend(ledger: Ledger, t: Transfer, key: string): Promise<WriteResult> {
  const { body } = originalRequest(t);
  if (t.kind === 'DEPOSIT') {
    return ledger.postDeposit(t.destinationAccountId, body as { amountMinor: number; memo?: string }, key);
  }
  return ledger.postTransfer(body as TransferRequest, key);
}

const deliveryMs = (createdAt: string, publishedAt: string | null) =>
  publishedAt === null ? null : Math.max(0, Date.parse(publishedAt) - Date.parse(createdAt));

export async function paymentTrail(ledger: Ledger, accountId: string, transferId: string) {
  const full = await scopedTrail(ledger, accountId, transferId);
  const trail = full ?? await trailFromStatements(ledger, accountId, transferId);
  if (!trail) return null;
  const t = trail.transfer;
  const ids = new Set([t.sourceAccountId, t.destinationAccountId, ...trail.entries.map((e) => e.accountId)]);
  const accounts = new Map<string, Account | null>();
  await Promise.all([...ids].map(async (id) => { accounts.set(id, await ledger.getAccount(id)); }));
  const request = originalRequest(t);
  const legsSum = trail.entries.reduce((sum, e) => sum + e.amountMinor, 0);
  return {
    transferId: t.id,
    kind: t.kind,
    status: t.status,
    amount: formatMoney(t.amountMinor, t.currency),
    memo: t.memo,
    createdAt: t.createdAt,
    from: label(accounts.get(t.sourceAccountId) ?? null),
    to: label(accounts.get(t.destinationAccountId) ?? null),
    decline: t.rejectionReason
      ? { code: t.rejectionReason, explanation: DECLINE_REASONS[t.rejectionReason] ?? null }
      : null,
    /** False when the ledger build has no trail endpoint: no key, no events, no replay or tamper checks. */
    audited: full !== null,
    request: {
      method: 'POST',
      path: request.path,
      idempotencyKey: trail.idempotencyKey,
      requestHash: trail.requestHash,
      body: request.body,
    },
    legs: trail.entries.map((e) => ({
      entryId: e.id,
      account: label(accounts.get(e.accountId) ?? null),
      side: e.amountMinor < 0 ? 'debit' as const : 'credit' as const,
      amount: formatMoney(Math.abs(e.amountMinor), t.currency),
      balanceAfter: formatMoney(e.balanceAfterMinor, t.currency),
    })),
    legsSum: formatMoney(legsSum, t.currency),
    events: trail.events.map((e) => ({
      eventId: e.eventId,
      type: e.eventType,
      createdAt: e.createdAt,
      publishedAt: e.publishedAt,
      deliveryMs: deliveryMs(e.createdAt, e.publishedAt),
    })),
  };
}

/** Sends a stored request again with its original key: the ledger must return the stored result and post nothing. */
export async function replayPayment(ledger: Ledger, accountId: string, transferId: string) {
  const before = await scopedTrail(ledger, accountId, transferId);
  if (!before) return null;
  const balanceBefore = (await ledger.getAccount(accountId))?.balanceMinor ?? 0;
  const result = await resend(ledger, before.transfer, before.idempotencyKey);
  const after = await ledger.trail(transferId);
  const balanceAfter = (await ledger.getAccount(accountId))?.balanceMinor ?? 0;
  const currency = before.transfer.currency;
  return {
    idempotencyKey: before.idempotencyKey,
    httpStatus: result.status,
    replayed: result.replayed,
    sameTransfer: result.transfer.id === transferId,
    status: result.transfer.status,
    entriesBefore: before.entries.length,
    entriesAfter: after?.entries.length ?? before.entries.length,
    balanceBefore: formatMoney(balanceBefore, currency),
    balanceAfter: formatMoney(balanceAfter, currency),
  };
}

/**
 * A phone on a bad connection retrying one payment: the same request and key, all in flight at
 * once. The ledger serializes them on the idempotency key, so exactly one is processed.
 */
export async function racePayment(ledger: Ledger, accountId: string, fromAccountId: string) {
  if (accountId === fromAccountId) return { error: 'Pick a different sender.' as const };
  const [to, from] = await Promise.all([ledger.getAccount(accountId), ledger.getAccount(fromAccountId)]);
  if (!to || !from || to.type !== 'USER' || from.type !== 'USER') return null;
  if (to.currency !== from.currency) return { error: 'Both accounts must use the same currency.' as const };
  const key = randomUUID();
  const req: TransferRequest = {
    sourceAccountId: from.id,
    destinationAccountId: to.id,
    amountMinor: RACE_AMOUNT_MINOR,
    currency: to.currency,
    memo: 'Coffee',
  };
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: RACE_COPIES }, async (_, copyIndex) => {
    const r = await ledger.postTransfer(req, key);
    return {
      copyIndex: copyIndex + 1,
      httpStatus: r.status,
      replayed: r.replayed,
      transferId: r.transfer.id,
      status: r.transfer.status,
      ms: Date.now() - started,
    };
  }));
  const sorted = [...results].sort((a, b) => a.copyIndex - b.copyIndex);
  const ids = [...new Set(results.map((r) => r.transferId))];
  const winner = results.find((r) => !r.replayed) ?? results[0];
  const trail = ids.length === 1 ? await ledger.trail(ids[0]!) : null;
  return {
    idempotencyKey: key,
    from: from.ownerId,
    amount: formatMoney(RACE_AMOUNT_MINOR, to.currency),
    copies: RACE_COPIES,
    attempts: sorted,
    distinctTransfers: ids.length,
    transferId: winner?.transferId ?? ids[0] ?? null,
    status: winner?.status ?? null,
    entriesPosted: trail?.entries.length ?? null,
    declineExplanation: trail?.transfer.rejectionReason ? DECLINE_REASONS[trail.transfer.rejectionReason] ?? null : null,
  };
}

export async function tamperWithPayment(ledger: Ledger, accountId: string, transferId: string) {
  const trail = await scopedTrail(ledger, accountId, transferId);
  if (!trail) return null;
  if (trail.entries.length === 0) return { error: 'This payment was declined, so it has no entries to tamper with.' as const };
  return ledger.tamperChecks(transferId);
}

export async function booksCheck(ledger: Ledger) {
  const i = await ledger.integrity();
  return { ...i, entriesSum: formatMoney(i.entriesSumMinor) };
}
