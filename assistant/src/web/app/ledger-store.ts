import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api, type AccountView } from '../api.js';

/**
 * One store, one source of truth, optimistic writes.
 *
 * Frictionless tracking means the UI never waits for the network to feel correct:
 * a logged spend or a recorded settlement is applied to the local view *first*,
 * then committed. If the commit fails, the view rolls back and the error surfaces
 * on the same toast — the person never sees a number that silently didn't save.
 *
 * The store is deliberately framework-free (a plain class with subscribe/getState)
 * so its behaviour is unit-testable without React, and so the same object can be
 * driven by future P2P rails (see rails.ts) without a UI rewrite.
 *
 * Loads are ticket-guarded: a slow response for wallet A can never overwrite a
 * newer response for wallet B (view-as in the demo household, fast tab switching).
 */

export interface PendingOp {
  id: string;
  /** Human label for the sync indicator, e.g. "Logging $12.00 · dining". */
  label: string;
}

export interface LedgerState {
  view: AccountView | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Writes in flight, newest last. Empty when the book is settled. */
  pending: PendingOp[];
}

export interface OptimisticMutation {
  /** Human label for the sync indicator. */
  label: string;
  /**
   * Pure: returns a new view with the local change applied. Return `null` to
   * commit without a local patch (e.g. an action with no visible effect).
   *
   * Must not mutate the passed view — return a shallow copy. Optimistic patches
   * are best-effort previews; the authoritative view from `commit`/`reload`
   * always wins.
   */
  apply: (view: AccountView) => AccountView | null;
  /**
   * The real write. Return a fresh view to skip the follow-up reload, or
   * `void`/`undefined` to have the store reload from the API.
   */
  commit: () => Promise<AccountView | void>;
}

export interface OptimisticResult {
  ok: boolean;
  error?: string;
}

/** How the store fetches a whole view. Swap for a cached fetcher later. */
export type ViewLoader = (accountId: string) => Promise<AccountView>;

interface StoreOptions {
  /** Injectable for tests. */
  createId?: () => string;
}

const EMPTY: LedgerState = { view: null, loading: true, refreshing: false, error: null, pending: [] };

export class LedgerStore {
  private state: LedgerState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly loader: ViewLoader;
  private readonly createId: () => string;
  /** Monotonic ticket; only the newest load may write state. */
  private ticket = 0;
  private accountId: string | null = null;

  constructor(loader: ViewLoader, options: StoreOptions = {}) {
    this.loader = loader;
    this.createId = options.createId ?? (() => Math.random().toString(36).slice(2));
  }

  /** @see useSyncExternalStore */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Must return a cached object identity — `useSyncExternalStore` compares by reference. */
  getState = (): LedgerState => this.state;

  /** Point the store at a wallet. Clears the previous view so nothing leaks across. */
  async load(accountId: string): Promise<void> {
    this.accountId = accountId;
    const mine = ++this.ticket;
    this.setState({ view: null, loading: true, refreshing: false, error: null, pending: [] });
    try {
      const view = await this.loader(accountId);
      if (mine !== this.ticket) return; // a newer load already won
      this.setState({ view, loading: false, refreshing: false, error: null });
    } catch (e) {
      if (mine !== this.ticket) return;
      this.setState({ view: null, loading: false, refreshing: false, error: messageOf(e) });
    }
  }

  /** Refetch the current wallet without clearing the screen (keeps the view visible). */
  reload = async (): Promise<void> => {
    const accountId = this.accountId;
    if (!accountId) return;
    const mine = ++this.ticket;
    this.setState({ refreshing: true, error: null });
    try {
      const view = await this.loader(accountId);
      if (mine !== this.ticket) return;
      this.setState({ view, loading: false, refreshing: false, error: null });
    } catch (e) {
      if (mine !== this.ticket) return;
      this.setState({ refreshing: false, error: messageOf(e) });
    }
  };

  /**
   * Apply a local change now, commit it, and reconcile — or roll back.
   *
   * Order matters for future P2P: a rail hand-off runs inside `commit()` *before*
   * the optimistic state is trusted by the server, so a failed Zelle deep link or
   * a rejected on-chain transfer reverts the preview instead of leaving a fake
   * balance on screen.
   */
  run = async (mutation: OptimisticMutation): Promise<OptimisticResult> => {
    const snapshot = this.state.view;
    const op: PendingOp = { id: this.createId(), label: mutation.label };

    // 1. Optimistic patch — instant, and the only reason this feels frictionless.
    const patched = snapshot ? mutation.apply(snapshot) : null;
    this.setState({
      view: patched ?? snapshot,
      error: null,
      pending: [...this.state.pending, op],
    });

    try {
      // 2. Real write. A fresh view here is authoritative and skips a refetch.
      const fresh = await mutation.commit();
      if (fresh) this.setState({ view: fresh });
      else await this.reload();
      return { ok: true };
    } catch (e) {
      // 3. Roll back, so the ledger on screen never lies about what saved.
      const message = messageOf(e);
      this.setState({ view: snapshot, error: message });
      return { ok: false, error: message };
    } finally {
      this.setState({ pending: this.state.pending.filter((p) => p.id !== op.id) });
    }
  };

  private setState(patch: Partial<LedgerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * React binding. The store is recreated when the wallet changes so a stale view
 * can never be mixed with a new wallet's writes.
 */
export function useLedgerStore(
  accountId: string,
  makeStore: (accountId: string) => LedgerStore = defaultStore,
) {
  const store = useMemo(() => makeStore(accountId), [accountId, makeStore]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // Load on mount, and again whenever the wallet changes.
  useEffect(() => {
    void store.load(accountId);
  }, [store, accountId]);

  return { ...state, store, reload: store.reload.bind(store), run: store.run.bind(store) };
}

/** Production loader: one request returns habits, patterns, finance and activity. */
export function defaultStore(): LedgerStore {
  return new LedgerStore((id) => api.account(id, 80, new Date().getTimezoneOffset()));
}
