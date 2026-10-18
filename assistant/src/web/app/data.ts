import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type AccountRef,
  type AccountView,
  type PaymentRequestView,
  type PeerLedgerView,
} from '../api.js';

export interface WalletData {
  view: AccountView;
  peers: AccountRef[];
  requests: { incoming: PaymentRequestView[]; outgoing: PaymentRequestView[] };
  /** Last 30 days with each friend, keyed by friend account id. */
  friends: Record<string, PeerLedgerView>;
}

export function useWallet(accountId: string) {
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    setError(null);
    try {
      const [view, peers, requests] = await Promise.all([
        api.account(accountId, 80),
        api.peers(accountId),
        api.requests(accountId).catch(() => ({ incoming: [], outgoing: [] })),
      ]);
      const pairs = await Promise.all(
        peers.map((p) => api.peerLedger(accountId, p.id, 30).then((v) => [p.id, v] as const).catch(() => null)),
      );
      if (ticket !== latest.current) return;
      const friends: Record<string, PeerLedgerView> = {};
      for (const pair of pairs) if (pair) friends[pair[0]] = pair[1];
      setData({ view, peers, requests, friends });
    } catch (e) {
      if (ticket === latest.current) setError((e as Error).message);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
