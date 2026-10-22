import { describe, expect, it } from 'vitest';
import type { AccountView } from '../src/web/api.js';
import { LedgerStore, type ViewLoader } from '../src/web/app/ledger-store.js';

/** Minimal stand-in: the store only reads/mutates top-level fields. */
const account = (balance: string, id = 'acct-1'): AccountView => ({ id, balance } as AccountView);

describe('LedgerStore', () => {
  it('loads a view and clears loading', async () => {
    const store = new LedgerStore(async () => account('$10.00'));
    expect(store.getState().loading).toBe(true);

    await store.load('acct-1');
    const state = store.getState();
    expect(state.view?.balance).toBe('$10.00');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('surfaces a load failure as error state instead of throwing', async () => {
    const store = new LedgerStore(async () => {
      throw new Error('ledger offline');
    });
    await store.load('acct-1');
    expect(store.getState().view).toBeNull();
    expect(store.getState().error).toBe('ledger offline');
  });

  it('applies the optimistic patch before the commit resolves', async () => {
    const store = new LedgerStore(async () => account('$10.00'));
    await store.load('acct-1');

    let release: (v: AccountView) => void = () => {};
    const pending = store.run({
      label: 'Logging $5.00',
      apply: (view) => ({ ...view, balance: '$5.00' }),
      commit: () => new Promise<AccountView>((resolve) => { release = resolve; }),
    });

    // The screen already shows the change, and the write is visible as pending.
    expect(store.getState().view?.balance).toBe('$5.00');
    expect(store.getState().pending).toHaveLength(1);
    expect(store.getState().pending[0]?.label).toBe('Logging $5.00');

    release(account('$5.00'));
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(store.getState().pending).toHaveLength(0);
    expect(store.getState().view?.balance).toBe('$5.00');
  });

  it('rolls back and records the error when the commit fails', async () => {
    const store = new LedgerStore(async () => account('$10.00'));
    await store.load('acct-1');

    const result = await store.run({
      label: 'Settle up',
      apply: (view) => ({ ...view, balance: '$0.00' }),
      commit: () => Promise.reject(new Error('rail refused')),
    });

    expect(result).toEqual({ ok: false, error: 'rail refused' });
    expect(store.getState().view?.balance).toBe('$10.00');
    expect(store.getState().error).toBe('rail refused');
    expect(store.getState().pending).toHaveLength(0);
  });

  it('reloads after a commit that returns no view', async () => {
    let loads = 0;
    const store = new LedgerStore(async () => {
      loads += 1;
      return account(loads === 1 ? '$10.00' : '$9.00');
    });
    await store.load('acct-1');

    const result = await store.run({
      label: 'Logging $1.00',
      apply: (view) => ({ ...view, balance: '$9.00' }),
      commit: async () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(loads).toBe(2);
    expect(store.getState().view?.balance).toBe('$9.00');
  });

  it('ignores a stale load so a slow wallet cannot overwrite a newer one', async () => {
    const pending = new Map<string, (view: AccountView) => void>();
    const loader: ViewLoader = (id) => new Promise((resolve) => { pending.set(id, resolve); });
    const store = new LedgerStore(loader);

    const slow = store.load('slow');
    const fast = store.load('fast');
    pending.get('fast')?.(account('$2.00', 'fast'));
    await fast;

    pending.get('slow')?.(account('$1.00', 'slow'));
    await slow;

    expect(store.getState().view?.id).toBe('fast');
    expect(store.getState().view?.balance).toBe('$2.00');
  });

  it('run keeps store context when passed as a detached callback', async () => {
    const store = new LedgerStore(async () => account('$10.00'));
    await store.load('acct-1');
    const detached = store.run;
    const result = await detached({
      label: 'Logging $1.00',
      apply: (view) => ({ ...view, balance: '$9.00' }),
      commit: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(store.getState().pending).toHaveLength(0);
  });

  it('notifies subscribers on every state change', async () => {
    const store = new LedgerStore(async () => account('$10.00'));
    let calls = 0;
    const unsubscribe = store.subscribe(() => { calls += 1; });

    await store.load('acct-1');
    expect(calls).toBeGreaterThan(0);

    unsubscribe();
    const before = calls;
    await store.reload();
    expect(calls).toBe(before);
  });
});
