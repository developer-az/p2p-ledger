import { useEffect, useState } from 'react';
import { api, type PeerLedgerView } from './api.js';
import { personName } from './person-name.js';

export function PeerPanel({
  accountId,
  peer,
  busy,
  onPay,
  onRaceFromPeer,
  onClearFocus,
}: {
  accountId: string;
  peer: { id: string; owner: string };
  busy: boolean;
  onPay: (amount: string, memo: string) => void;
  onRaceFromPeer: () => void;
  onClearFocus: () => void;
}) {
  const [ledger, setLedger] = useState<PeerLedgerView | null>(null);

  useEffect(() => {
    setLedger(null);
    void api.peerLedger(accountId, peer.id).then(setLedger).catch(() => setLedger(null));
  }, [accountId, peer.id]);

  const name = personName(peer.owner);

  return (
    <div className="bb-peer-strip">
      <div className="bb-peer-strip-hd">
        <span className="bb-hi">Focus · {name}</span>
        <button type="button" className="bb-link" disabled={busy} onClick={onClearFocus}>show all</button>
      </div>
      {ledger && (
        <p className="bb-dim bb-peer-stats">
          {ledger.windowDays}d · sent {ledger.sentToPeer} · in {ledger.receivedFromPeer} · net {ledger.netFromPeer}
        </p>
      )}
      <p className="bb-peer-actions">
        <button type="button" className="bb-btn-chip" disabled={busy} onClick={() => onPay('5', 'tip')}>$5</button>
        <button type="button" className="bb-btn-chip" disabled={busy} onClick={() => onPay('25', 'reimburse')}>$25</button>
        <button type="button" className="bb-btn-chip" disabled={busy} onClick={() => onPay('100', 'invoice')}>$100</button>
        <button type="button" className="bb-link" disabled={busy} onClick={onRaceFromPeer}>race</button>
      </p>
      <p className="bb-dim bb-peer-hint">BLOTTER shows shared tx · CMD: pay {peer.owner.split('-')[0]} 10 lunch</p>
    </div>
  );
}
