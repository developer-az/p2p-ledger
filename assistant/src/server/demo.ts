import { randomUUID } from 'node:crypto';
import type { LedgerWriter, Transfer } from './ledger.js';
import { formatMoney } from './money.js';

export const RENT_MEMO = 'Rent share - October';
export const RENT_AMOUNT_MINOR = 120_000;

/**
 * Creates a small, realistic world: three people, some payments, and a brand-new
 * account sending $1,200, which the fraud rules decline. The rent result is returned
 * so the product can show the stored decline instead of throwing it away.
 */
export async function seedDemo(ledger: LedgerWriter) {
  const tag = randomUUID().slice(0, 6);
  const open = (name: string) => ledger.openAccount(`${name}-${tag}`, 'USD');
  const [alex, sam, jordan] = await Promise.all([open('alex'), open('sam'), open('jordan')]);
  const key = () => randomUUID();
  await ledger.deposit(alex.id, 500_000, key());
  await ledger.deposit(sam.id, 120_000, key());
  const send = (from: string, to: string, amountMinor: number, memo: string) =>
    ledger.transfer({ sourceAccountId: from, destinationAccountId: to, amountMinor, currency: 'USD', memo }, key());
  await send(alex.id, sam.id, 4_250, 'Pizza night 🍕');
  const rent = await send(alex.id, jordan.id, RENT_AMOUNT_MINOR, RENT_MEMO);
  await send(sam.id, alex.id, 1_800, 'Uber split');
  await send(alex.id, sam.id, 150_000, 'Concert tickets');
  await send(alex.id, jordan.id, 2_599, 'Groceries');
  await send(alex.id, jordan.id, 8_900, 'Utilities · electric + water');
  await send(sam.id, alex.id, 22_500, 'Reimbursement · team offsite travel');
  return {
    accounts: [alex, sam, jordan].map((a) => ({ id: a.id, owner: a.ownerId })),
    focusAccountId: alex.id,
    stopped: stoppedPayment(rent),
    narrative:
      'Live PostgreSQL ledger: household + work reimbursements, one declined rent (NEW_ACCOUNT_LARGE_TRANSFER).',
  };
}

function stoppedPayment(transfer: Transfer) {
  return {
    transferId: transfer.id,
    status: transfer.status,
    amount: formatMoney(transfer.amountMinor, transfer.currency),
    memo: transfer.memo,
    reason: transfer.rejectionReason,
  };
}
