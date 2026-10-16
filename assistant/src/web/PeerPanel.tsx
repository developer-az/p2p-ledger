import { useEffect, useState } from 'react';
import { api, type AccountActivity, type PeerLedgerView } from './api.js';

function personName(owner: string): string {
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function PeerPanel({
  accountId,
  peer,
  bilateral,
  busy,
  onPay,
  onRaceFromPeer,
  onSelectTransfer,
}: {
  accountId: string;
  peer: { id: string; owner: string };
  bilateral: AccountActivity[];
  busy: boolean;
  onPay: (amount: string, memo: string) => void;
  onRaceFromPeer: () => void;
  onSelectTransfer: (transferId: string) => void;
}) {
  const [ledger, setLedger] = useState<PeerLedgerView | null>(null);

  useEffect(() => {
    setLedger(null);
    void api.peerLedger(accountId, peer.id).then(setLedger).catch(() => setLedger(null));
  }, [accountId, peer.id]);

  const name = personName(peer.owner);

  return (
    <div className="bb-peer-lane">
      <p className="bb-hi">
        P2P · {name} <span className="bb-dim bb-mono">{shortId(peer.id)}</span>
      </p>
      {ledger && (
        <p className="bb-dim">
          {ledger.windowDays}d · you sent {ledger.sentToPeer} · received {ledger.receivedFromPeer} · net {ledger.netFromPeer}
        </p>
      )}
      <p className="bb-peer-actions">
        <button type="button" className="bb-link" disabled={busy} onClick={() => onPay('5', 'tip')}>pay $5</button>
        {' · '}
        <button type="button" className="bb-link" disabled={busy} onClick={() => onPay('25', 'reimburse')}>pay $25</button>
        {' · '}
        <button type="button" className="bb-link" disabled={busy} onClick={() => onPay('100', 'invoice')}>pay $100</button>
        {' · '}
        <button type="button" className="bb-link" disabled={busy} onClick={onRaceFromPeer}>idempotency race (them→you)</button>
      </p>
      <table className="bb-tbl bb-peer-tbl">
        <thead>
          <tr><th>DIR</th><th>MEMO</th><th>STS</th><th className="bb-r">AMT</th></tr>
        </thead>
        <tbody>
          {bilateral.length === 0 && (
            <tr><td colSpan={4} className="bb-dim">No shared transfers yet — pay or receive to open this lane.</td></tr>
          )}
          {bilateral.map((t) => (
            <tr key={t.transferId} onClick={() => onSelectTransfer(t.transferId)}>
              <td>{t.direction === 'sent' ? 'OUT' : 'IN'}</td>
              <td>{t.memo || '—'}</td>
              <td>{t.status === 'REJECTED' ? 'REJ' : 'OK'}</td>
              <td className="bb-r">{t.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bb-dim bb-peer-hint">
        Ask AI: “How much did I send {name}?” · “Why was my payment to {name} declined?”
      </p>
    </div>
  );
}
