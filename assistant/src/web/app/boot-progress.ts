/**
 * A tiny external store around the pure boot reducer.
 *
 * The reducer itself never touches React or the clock, so this module owns the
 * mutable state, the subscriber list and the once-a-second tick that keeps the
 * elapsed seconds moving. `useSyncExternalStore` reads the snapshot, and the
 * store hands back the same object until an event actually changes it.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { bootReducer, initialBoot, type BootEvent, type BootState } from './boot-steps.js';

export interface BootProgress {
  getState(): BootState;
  dispatch(event: BootEvent): void;
  subscribe(listener: () => void): () => void;
  reset(at: number): void;
}

export function createBootProgress(at: number): BootProgress {
  let state = initialBoot(at);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    getState: () => state,
    dispatch: (event) => {
      const next = bootReducer(state, event);
      if (next === state) return;
      state = next;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: (nextAt) => {
      state = initialBoot(nextAt);
      notify();
    },
  };
}

/** One progress record for the whole app: the preloader and the wallet share it. */
export const bootProgress = createBootProgress(Date.now());

const TICK_MS = 1_000;

/**
 * The shared boot state plus a clock reading. The tick is a separate piece of
 * React state because a tick often leaves the reducer state unchanged (no stall)
 * while the elapsed seconds still need to re-render.
 */
export function useBootProgress(): { state: BootState; now: number } {
  const state = useSyncExternalStore(bootProgress.subscribe, bootProgress.getState);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.complete) return;
    const id = window.setInterval(() => {
      const at = Date.now();
      bootProgress.dispatch({ type: 'tick', at });
      setNow(at);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.complete]);

  return { state, now };
}
