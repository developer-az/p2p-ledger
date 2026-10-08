import { randomUUID } from 'node:crypto';
import type { LedgerWriter } from './ledger.js';

/**
 * Creates a small, realistic world for the demo: three people, some payments, and one
 * transfer that the fraud rules decline (a brand-new account sending more than $1,000).
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
  await send(alex.id, jordan.id, 120_000, 'Rent share - October');
  await send(sam.id, alex.id, 1_800, 'Uber split');
  await send(alex.id, sam.id, 150_000, 'Concert tickets');
  await send(alex.id, jordan.id, 2_599, 'Groceries');
  return { accounts: [alex, sam, jordan].map((a) => ({ id: a.id, owner: a.ownerId })) };
}
