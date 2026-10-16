import { randomUUID } from 'node:crypto';
import type { LedgerWriter } from './ledger.js';
import { formatMoney } from './money.js';

/** Synthetic ACH / corridor counterparties — each flow opens a fresh wallet, pays, then goes dormant in the peer list. */
const INBOUND_SCENARIOS = [
  { prefix: 'payroll', memo: 'Payroll · simulated ACH', amountMinor: 125_000 },
  { prefix: 'client', memo: 'Client reimbursement', amountMinor: 42_500 },
  { prefix: 'marketplace', memo: 'Marketplace payout', amountMinor: 18_750 },
  { prefix: 'refund', memo: 'Card refund corridor', amountMinor: 9_900 },
  { prefix: 'stripe', memo: 'Stripe payout', amountMinor: 31_200 },
  { prefix: 'gig', memo: 'Gig platform settlement', amountMinor: 12_400 },
  { prefix: 'insurance', memo: 'Insurance reimbursement', amountMinor: 6_500 },
  { prefix: 'taxrefund', memo: 'Tax refund corridor', amountMinor: 22_000 },
] as const;

const OUTBOUND_SCENARIOS = [
  { prefix: 'vendor', memo: 'Vendor invoice · simulated wire', amountMinor: 15_000 },
  { prefix: 'saas', memo: 'SaaS subscription', amountMinor: 4_999 },
  { prefix: 'landlord', memo: 'Rent corridor', amountMinor: 85_000 },
  { prefix: 'utilities', memo: 'Utilities ACH', amountMinor: 18_500 },
  { prefix: 'contractor', memo: 'Contractor payment', amountMinor: 32_000 },
  { prefix: 'insurance', memo: 'Insurance premium', amountMinor: 11_200 },
  { prefix: 'property', memo: 'Property management', amountMinor: 92_000 },
  { prefix: 'freight', memo: 'Freight & logistics', amountMinor: 7_800 },
  { prefix: 'caterer', memo: 'Catering invoice', amountMinor: 5_600 },
  { prefix: 'gear', memo: 'Equipment supplier', amountMinor: 21_000 },
] as const;

export interface CorridorResult {
  corridor: 'inbound' | 'outbound';
  peer: { id: string; owner: string };
  transferId: string;
  amount: string;
  status: 'COMPLETED' | 'REJECTED';
  memo: string;
  narrative: string;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export async function simulateInboundCorridor(ledger: LedgerWriter, userAccountId: string): Promise<CorridorResult> {
  const scenario = pick(INBOUND_SCENARIOS);
  const tag = randomUUID().slice(0, 6);
  const peer = await ledger.openAccount(`${scenario.prefix}-${tag}`, 'USD');
  const key = () => randomUUID();
  await ledger.deposit(peer.id, scenario.amountMinor, key());
  const transfer = await ledger.transfer({
    sourceAccountId: peer.id,
    destinationAccountId: userAccountId,
    amountMinor: scenario.amountMinor,
    currency: 'USD',
    memo: scenario.memo,
  }, key());
  return {
    corridor: 'inbound',
    peer: { id: peer.id, owner: peer.ownerId },
    transferId: transfer.id,
    amount: formatMoney(scenario.amountMinor),
    status: transfer.status,
    memo: scenario.memo,
    narrative: `${peer.ownerId} funded on the ledger, then paid you (simulated bank corridor). They stay in PEERS until history ages out.`,
  };
}

export async function simulateOutboundCorridor(
  ledger: LedgerWriter,
  userAccountId: string,
): Promise<CorridorResult> {
  const scenario = pick(OUTBOUND_SCENARIOS);
  const tag = randomUUID().slice(0, 6);
  const peer = await ledger.openAccount(`${scenario.prefix}-${tag}`, 'USD');
  const key = () => randomUUID();
  const transfer = await ledger.transfer({
    sourceAccountId: userAccountId,
    destinationAccountId: peer.id,
    amountMinor: scenario.amountMinor,
    currency: 'USD',
    memo: scenario.memo,
  }, key());
  return {
    corridor: 'outbound',
    peer: { id: peer.id, owner: peer.ownerId },
    transferId: transfer.id,
    amount: formatMoney(scenario.amountMinor),
    status: transfer.status,
    memo: scenario.memo,
    narrative: `You paid ${peer.ownerId} on-ledger (simulated vendor corridor). New counterparties appear and go quiet like real P2P rails.`,
  };
}

/** Opening deposit + one inbound corridor so new wallets are never empty and alone. */
export async function welcomeBankPackage(
  ledger: LedgerWriter,
  userAccountId: string,
  openingDepositMinor: number,
): Promise<{ depositTransferId: string; corridor: CorridorResult }> {
  const key = randomUUID();
  const deposit = await ledger.deposit(userAccountId, openingDepositMinor, key);
  const corridor = await simulateInboundCorridor(ledger, userAccountId);
  return { depositTransferId: deposit.id, corridor };
}

export function bankSimulatorStatus() {
  return {
    name: 'Simulated ACH / corridor network',
    description:
      'Each inbound or outbound flow creates a short-lived counterparty wallet on the same PostgreSQL ledger, ' +
      'funds it when needed, and posts a real transfer. PEERS lists everyone you have touched; dormant corridors remain visible as history.',
    inboundScenarios: INBOUND_SCENARIOS.map((s) => s.prefix),
    outboundScenarios: OUTBOUND_SCENARIOS.map((s) => s.prefix),
  };
}
