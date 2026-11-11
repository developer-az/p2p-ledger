import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, onWakeRetry, wakeTiming } from '../src/web/api.js';
import { createBootProgress } from '../src/web/app/boot-progress.js';

const WAKING = 'The ledger is waking up. Try again in a moment.';
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('onWakeRetry', () => {
  it('tells listeners about each waking-ledger retry, with the path and a 1-based attempt', async () => {
    vi.spyOn(wakeTiming, 'sleep').mockResolvedValue();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: WAKING }, 503))
      .mockResolvedValueOnce(json({ error: WAKING }, 503))
      .mockResolvedValueOnce(json({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const seen: { path: string; attempt: number }[] = [];
    const off = onWakeRetry((e) => seen.push({ path: e.path, attempt: e.attempt }));
    await call('/api/accounts?id=x');
    off();
    expect(seen).toEqual([{ path: '/api/accounts?id=x', attempt: 1 }, { path: '/api/accounts?id=x', attempt: 2 }]);
  });

  it('stops notifying after unsubscribe and never fires for non-waking errors', async () => {
    vi.spyOn(wakeTiming, 'sleep').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'nope' }, 500)));
    const listener = vi.fn();
    const off = onWakeRetry(listener);
    off();
    await expect(call('/api/x')).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener does not break the request', async () => {
    vi.spyOn(wakeTiming, 'sleep').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: WAKING }, 503))
      .mockResolvedValueOnce(json({ ok: 1 }, 200)));
    const off = onWakeRetry(() => { throw new Error('listener bug'); });
    await expect(call('/api/y')).resolves.toEqual({ ok: 1 });
    off();
  });
});

describe('createBootProgress', () => {
  it('holds state, notifies subscribers on dispatch, and resets', () => {
    const p = createBootProgress(1_000);
    const listener = vi.fn();
    const off = p.subscribe(listener);
    p.dispatch({ type: 'done', id: 'server', at: 1_200 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(p.getState().steps.find((s) => s.id === 'ledger')?.status).toBe('running');
    off();
    p.dispatch({ type: 'done', id: 'ledger', at: 1_300 });
    expect(listener).toHaveBeenCalledTimes(1);
    p.reset(5_000);
    expect(p.getState().startedAt).toBe(5_000);
    expect(p.getState().steps[0]?.status).toBe('running');
  });

  it('returns the same state object until something changes (safe for useSyncExternalStore)', () => {
    const p = createBootProgress(0);
    const a = p.getState();
    expect(p.getState()).toBe(a);
    p.dispatch({ type: 'done', id: 'server', at: 1 });
    expect(p.getState()).not.toBe(a);
  });
});
