import { useMemo } from 'react';
import type { AccountView } from '../api.js';
import { LedgerStore, useLedgerStore } from './ledger-store.js';

export interface WalletData {
  view: AccountView;
}

/**
 * The consumer app's data hook. Now a thin view over `LedgerStore`, which owns
 * the loading, ticket-guarding, optimistic writes and pending queue.
 *
 * The returned shape is unchanged for existing screens, and additionally exposes
 * `run` / `pending` so a screen can apply a local change immediately and reconcile
 * later (the "frictionless" path, and the hook point for future P2P rails).
 */
export function useWallet(accountId: string) {
  const { view, error, loading, refreshing, pending, reload, run, store } = useLedgerStore(accountId);
  const data = useMemo<WalletData | null>(() => (view ? { view } : null), [view]);
  return { data, error, loading, refreshing, pending, reload, run, store };
}

export { LedgerStore };

