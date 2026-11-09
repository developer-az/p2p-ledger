import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  READINESS_POLL_CAP_MS,
  readinessPollDelays,
  runReadinessPoll,
} from '../src/web/app/readiness-poll.js';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe('readinessPollDelays', () => {
  it('is ordered shortest to longest', () => {
    const delays = readinessPollDelays();
    expect(delays.length).toBeGreaterThan(0);
    for (let i = 1; i < delays.length; i += 1) {
      const previous = delays[i - 1] ?? 0;
      const current = delays[i] ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it('never fires faster than every five seconds', () => {
    for (const delay of readinessPollDelays()) expect(delay).toBeGreaterThanOrEqual(5_000);
  });

  it('covers between four and six minutes before giving up', () => {
    const total = sum(readinessPollDelays());
    expect(total).toBeGreaterThanOrEqual(240_000);
    expect(total).toBeLessThanOrEqual(360_000);
  });

  it('exports the cap as the exact total of the schedule', () => {
    expect(READINESS_POLL_CAP_MS).toBe(sum(readinessPollDelays()));
  });

  it('hands out an independent copy of the schedule', () => {
    const first = readinessPollDelays();
    first.push(60_000);
    expect(readinessPollDelays()).not.toContain(60_000);
    expect(READINESS_POLL_CAP_MS).toBe(sum(readinessPollDelays()));
  });
});

interface ProbeResult {
  ready: boolean;
}

describe('runReadinessPoll', () => {
  it('bounds a slow poll by wall clock, not by the sum of the gaps', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const calls: number[] = [];
    const probe = () => new Promise<ProbeResult>((resolve) => {
      calls.push(Date.now() - start);
      // Each probe takes a minute: far longer than its 15s bound.
      setTimeout(() => resolve({ ready: false }), 60_000);
    });
    const onResult = vi.fn();

    runReadinessPoll({ probe, onResult, delays: readinessPollDelays(), capMs: READINESS_POLL_CAP_MS });
    await vi.advanceTimersByTimeAsync(READINESS_POLL_CAP_MS * 3);

    expect(calls.length).toBeGreaterThan(0);
    // Eight 15s probes plus their gaps fit; a slow probe must not add time.
    expect(calls.length).toBeLessThanOrEqual(12);
    for (const at of calls) expect(at).toBeLessThanOrEqual(READINESS_POLL_CAP_MS);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('stops as soon as a probe reports ready', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const probe = async (): Promise<ProbeResult> => {
      calls += 1;
      return { ready: calls === 2 };
    };
    const results: ProbeResult[] = [];

    runReadinessPoll({
      probe, onResult: (result) => results.push(result), delays: readinessPollDelays(), capMs: READINESS_POLL_CAP_MS,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
    expect(results).toEqual([{ ready: false }, { ready: true }]);

    await vi.advanceTimersByTimeAsync(READINESS_POLL_CAP_MS);
    expect(calls).toBe(2);
  });

  it('cancel() stops any further probes', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const probe = async (): Promise<ProbeResult> => {
      calls += 1;
      return { ready: false };
    };

    const cancel = runReadinessPoll({
      probe, onResult: () => undefined, delays: readinessPollDelays(), capMs: READINESS_POLL_CAP_MS,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(1);

    cancel();
    await vi.advanceTimersByTimeAsync(READINESS_POLL_CAP_MS * 2);
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a hung probe at its timeout, then starts the next one', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const signals: AbortSignal[] = [];
    const startedAt: number[] = [];
    const probe = (signal: AbortSignal): Promise<ProbeResult> => {
      signals.push(signal);
      startedAt.push(Date.now() - start);
      // Ignores the signal and never settles: the poll must not wait forever.
      return new Promise<ProbeResult>(() => undefined);
    };

    runReadinessPoll({
      probe,
      onResult: () => undefined,
      delays: [1_000, 2_000],
      capMs: 60_000,
      probeTimeoutMs: 15_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(startedAt).toEqual([1_000]);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(signals[0]?.aborted).toBe(false);
    expect(startedAt).toEqual([1_000]);

    // The 15s bound fires: the in-flight probe is told to stop.
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    // ...and only after that does the next gap start: no overlapping probes.
    expect(startedAt).toEqual([1_000]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(startedAt).toEqual([1_000]);

    await vi.advanceTimersByTimeAsync(1);
    expect(startedAt).toEqual([1_000, 18_000]);
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('cancel() aborts the signal of the probe in flight', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const probe = (signal: AbortSignal): Promise<ProbeResult> => {
      signals.push(signal);
      return new Promise<ProbeResult>(() => undefined);
    };

    const cancel = runReadinessPoll({
      probe, onResult: () => undefined, delays: readinessPollDelays(), capMs: READINESS_POLL_CAP_MS,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    cancel();
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(READINESS_POLL_CAP_MS * 2);
    expect(signals).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits out a gap instead of probing while the tab is hidden, still bounded', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const probe = async (): Promise<ProbeResult> => {
      calls += 1;
      return { ready: false };
    };

    runReadinessPoll({
      probe,
      onResult: () => undefined,
      delays: readinessPollDelays(),
      capMs: READINESS_POLL_CAP_MS,
      isHidden: () => true,
    });
    await vi.advanceTimersByTimeAsync(READINESS_POLL_CAP_MS * 2);
    expect(calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
