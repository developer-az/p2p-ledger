import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AccountView } from '../api.js';

export interface WalletData {
  view: AccountView;
}

/**
 * One request, one source of truth. The account view already contains habits,
 * patterns, finance, activity and spend entries, so the consumer app no longer
 * fans out to peers/requests/peer-ledger on every refresh.
 */
export function useWallet(accountId: string) {
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    setError(null);
    setRefreshing(true);
    try {
      const view = await api.account(accountId, 80, new Date().getTimezoneOffset());
      if (ticket !== latest.current) return;
      setData({ view });
    } catch (e) {
      if (ticket === latest.current) setError((e as Error).message);
    } finally {
      if (ticket === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accountId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    setRefreshing(false);
    void reload();
  }, [reload]);

  return { data, error, loading, refreshing, reload };
}
