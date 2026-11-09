/**
 * Retry schedule for the sign-up readiness probe.
 *
 * A sleeping Render ledger can take longer than a minute to wake, so a few
 * one-shot refreshes leave the form disabled until a manual reload. Poll with a
 * short backoff for roughly five minutes instead, then stop: past that point the
 * deployment is not "still booting", it is broken.
 *
 * These are the gaps between requests, not absolute offsets: each delay starts
 * after the previous probe resolved or timed out, so only one request is ever in
 * flight. They are also only half the budget: the run as a whole stops at
 * READINESS_POLL_CAP_MS of wall clock, so slow probes cannot stretch it.
 */
const DELAYS_MS: readonly number[] = [5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000];

/** Wall-clock budget of a full poll run: the sum of every gap (~4m50s). */
export const READINESS_POLL_CAP_MS = DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

/** One probe may not eat the budget: a hung request is treated like a failed one. */
export const READINESS_PROBE_TIMEOUT_MS = 15_000;

/** Fresh copy so callers cannot mutate the schedule out from under each other. */
export function readinessPollDelays(): number[] {
  return [...DELAYS_MS];
}

/** A probe reports whether sign-up opened; anything else it carries rides along to onResult. */
export interface ReadinessResult {
  ready: boolean;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ReadinessPollOptions<T extends ReadinessResult> {
  /** The signal fires on the per-probe timeout and on cancel(): the probe must stop its request. */
  probe: (signal: AbortSignal) => Promise<T>;
  onResult: (result: T) => void;
  /** Gaps between probes, in order. Running out of gaps ends the poll. */
  delays: readonly number[];
  /** Hard wall-clock limit for the whole run, measured from the first schedule. */
  capMs: number;
  /** Bound on a single probe; a timeout counts as a failed probe. */
  probeTimeoutMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** A hidden tab waits out another gap instead of probing. */
  isHidden?: () => boolean;
}

/**
 * Retry `probe` on `delays` until it reports ready, a gap or the wall-clock cap
 * runs out, or the returned cancel() is called. Times come from `now`, so a test
 * with fake timers sees the same clock the browser would.
 */
export function runReadinessPoll<T extends ReadinessResult>(opts: ReadinessPollOptions<T>): () => void {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number): TimerHandle => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle: TimerHandle): void => clearTimeout(handle));
  const isHidden = opts.isHidden ?? (() => false);
  const probeTimeoutMs = opts.probeTimeoutMs ?? READINESS_PROBE_TIMEOUT_MS;
  /* Recorded at start, not accumulated per step: a probe that takes a minute
     must not buy itself another five. */
  const deadline = now() + opts.capMs;

  let cancelled = false;
  let timer: TimerHandle | undefined;
  /** The one probe in flight, so cancel() can drop its timeout and abort its request too. */
  let inFlight: { handle: TimerHandle | undefined; settled: boolean; controller: AbortController } | undefined;

  const expired = (): boolean => now() >= deadline;

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  };

  const cancel = (): void => {
    cancelled = true;
    stopTimer();
    if (inFlight !== undefined) {
      if (inFlight.handle !== undefined) clearTimer(inFlight.handle);
      // Unmounting must not leave a request running behind the user's back.
      inFlight.controller.abort();
      inFlight = undefined;
    }
  };

  /**
   * One probe, bounded so a hung fetch cannot hold the schedule open. Each probe
   * owns its own timeout and its own abort controller, so a late answer from an
   * abandoned probe cannot clear the bound of the probe that replaced it, and a
   * timeout or a cancel actually stops the request instead of orphaning it.
   */
  const probeOnce = (): Promise<T> => {
    const controller = new AbortController();
    const state: { handle: TimerHandle | undefined; settled: boolean; controller: AbortController } =
      { handle: undefined, settled: false, controller };
    inFlight = state;
    return new Promise<T>((resolve, reject) => {
      const settle = (): boolean => {
        if (state.settled) return false;
        state.settled = true;
        if (state.handle !== undefined) clearTimer(state.handle);
        if (inFlight === state) inFlight = undefined;
        return true;
      };
      state.handle = setTimer(() => {
        if (!settle()) return;
        // Abort first: the next probe waits for this one to be torn down.
        controller.abort();
        reject(new Error('The readiness probe timed out.'));
      }, probeTimeoutMs);
      // A probe that throws synchronously is a failed probe, not a broken poll.
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(opts.probe(controller.signal));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (result) => { if (settle()) resolve(result); },
        (error: unknown) => { if (settle()) reject(error); },
      );
    });
  };

  const schedule = (step: number): void => {
    if (cancelled || expired() || step >= opts.delays.length) return;
    timer = setTimer(() => {
      timer = undefined;
      fire(step);
    }, opts.delays[step] ?? 0);
  };

  const fire = (step: number): void => {
    if (cancelled || expired()) return;
    if (isHidden()) {
      // A background tab should not hammer the API; wait out another gap, but
      // the wall-clock cap still applies.
      schedule(step);
      return;
    }
    void probeOnce().then((result) => {
      // A result that lands after the deadline is stale: ignore it.
      if (cancelled || expired()) return;
      opts.onResult(result);
      if (result.ready) return;
      schedule(step + 1);
    }, () => {
      // A waking (or hung) ledger can fail the probe; keep the schedule running.
      if (!cancelled) schedule(step + 1);
    });
  };

  schedule(0);
  return cancel;
}
