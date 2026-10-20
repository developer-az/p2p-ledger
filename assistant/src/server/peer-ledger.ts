import type { LedgerReader, Transfer } from './ledger.js';
import { formatMoney } from './money.js';
import { DECLINE_REASONS } from './tools.js';

export interface PeerRef {
  id: string;
  owner: string;
}

export interface PeerLedgerView {
  peer: PeerRef;
  windowDays: number;
  sentToPeer: string;
  receivedFromPeer: string;
  netFromPeer: string;
  completedCount: number;
  declinedCount: number;
  transfers: {
    transferId: string;
    direction: 'sent' | 'received';
    amount: string;
    status: 'COMPLETED' | 'REJECTED';
    memo: string | null;
    declineReason: string | null;
    createdAt: string;
  }[];
}

export async function listPeerRefs(ledger: LedgerReader, accountId: string): Promise<PeerRef[]> {
  const recent = await ledger.transfersForAccount(accountId, 200);
  const ids = new Set<string>();
  for (const t of recent) {
    const other = t.sourceAccountId === accountId ? t.destinationAccountId : t.sourceAccountId;
    ids.add(other);
  }
  const idList = [...ids].filter((id) => id !== accountId);
  const accounts = await Promise.all(idList.map((id) => ledger.getAccount(id)));
  const peers: PeerRef[] = [];
  for (let i = 0; i < idList.length; i++) {
    const a = accounts[i];
    const id = idList[i];
    if (id && a && a.type === 'USER') peers.push({ id, owner: a.ownerId });
  }
  return peers.sort((a, b) => a.owner.localeCompare(b.owner));
}

export async function peerLedgerView(
  ledger: LedgerReader,
  accountId: string,
  peerId: string,
  windowDays = 30,
  limit = 25,
): Promise<PeerLedgerView | null> {
  const peer = await ledger.getAccount(peerId);
  if (!peer || peer.type !== 'USER') return null;
  const since = Date.now() - windowDays * 86_400_000;
  const recent = await ledger.transfersForAccount(accountId, 300);
  const between = recent.filter((t) => touchesPeer(t, accountId, peerId) && Date.parse(t.createdAt) >= since);
  let sentMinor = 0;
  let receivedMinor = 0;
  let declinedCount = 0;
  for (const t of between) {
    if (t.status === 'REJECTED') {
      if (t.sourceAccountId === accountId) declinedCount++;
      continue;
    }
    if (t.sourceAccountId === accountId) sentMinor += t.amountMinor;
    else receivedMinor += t.amountMinor;
  }
  const currency = peer.currency;
  return {
    peer: { id: peer.id, owner: peer.ownerId },
    windowDays,
    sentToPeer: formatMoney(sentMinor, currency),
    receivedFromPeer: formatMoney(receivedMinor, currency),
    netFromPeer: formatMoney(receivedMinor - sentMinor, currency),
    completedCount: between.filter((t) => t.status === 'COMPLETED').length,
    declinedCount,
    transfers: between.slice(0, limit).map((t) => row(accountId, t, currency)),
  };
}

function touchesPeer(t: Transfer, accountId: string, peerId: string): boolean {
  return (
    (t.sourceAccountId === accountId && t.destinationAccountId === peerId)
    || (t.sourceAccountId === peerId && t.destinationAccountId === accountId)
  );
}

function row(accountId: string, t: Transfer, currency: string) {
  const outgoing = t.sourceAccountId === accountId;
  return {
    transferId: t.id,
    direction: outgoing ? 'sent' as const : 'received' as const,
    amount: formatMoney(t.amountMinor, currency),
    status: t.status,
    memo: t.memo,
    declineReason: t.rejectionReason,
    createdAt: t.createdAt,
  };
}

export function explainDecline(code: string | null): string | null {
  if (!code) return null;
  return DECLINE_REASONS[code] ?? null;
}
