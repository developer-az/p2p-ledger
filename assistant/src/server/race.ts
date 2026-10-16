import { randomUUID } from 'node:crypto';
import type { LedgerWriter } from './ledger.js';
import { formatMoney } from './money.js';

export const RACE_COPIES = 5;
export const RACE_AMOUNT_MINOR = 500;

type Ledger = LedgerWriter & {
  getAccount(id: string): Promise<{ id: string; ownerId: string; currency: string; type: string } | null>;
};

export async function racePayment(ledger: Ledger, accountId: string, fromAccountId: string) {
  if (accountId === fromAccountId) return { error: 'Pick a different sender.' as const };
  const [to, from] = await Promise.all([ledger.getAccount(accountId), ledger.getAccount(fromAccountId)]);
  if (!to || !from || to.type !== 'USER' || from.type !== 'USER') return null;
  if (to.currency !== from.currency) return { error: 'Both accounts must use the same currency.' as const };

  const key = randomUUID();
  const body = {
    sourceAccountId: from.id,
    destinationAccountId: to.id,
    amountMinor: RACE_AMOUNT_MINOR,
    currency: to.currency,
    memo: 'Coffee (retry storm)',
  };
  const started = Date.now();
  const attempts = await Promise.all(
    Array.from({ length: RACE_COPIES }, async () => {
      const t0 = Date.now();
      const transfer = await ledger.transfer(body, key);
      return {
        httpStatus: 201,
        transferId: transfer.id,
        status: transfer.status,
        ms: Date.now() - t0,
      };
    }),
  );
  const ids = [...new Set(attempts.map((a) => a.transferId))];
  return {
    idempotencyKey: key,
    from: from.ownerId,
    amount: formatMoney(RACE_AMOUNT_MINOR, to.currency),
    copies: RACE_COPIES,
    attempts,
    distinctTransfers: ids.length,
    transferId: ids[0] ?? null,
    status: attempts[0]?.status ?? null,
    wallMs: Date.now() - started,
  };
}
