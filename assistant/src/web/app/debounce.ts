import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Client-side anti-flooding primitives.
 *
 * The server already refuses duplicate model work (LlmGuard cache + in-flight
 * coalescing + daily budget, see src/server/rate-limit.ts). These helpers stop
 * the *requests themselves* from being issued, which is the cheapest fix of all:
 * a double-tapped send button, a held-down Enter key, or a type-ahead field
 * collapses into one call before it ever leaves the browser.
 */

export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  /** Drop a scheduled call. Safe to call when nothing is pending. */
  cancel(): void;
}

/**
 * Trailing-edge debounce. The wrapped call fires once, `waitMs` after the last
 * invocation — not once per invocation.
 *
 * Kept framework-free (no React) so the timing contract is unit-testable with
 * fake timers. Prefer the hooks below inside components.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}

/**
 * A stable debounced callback. The returned function keeps its identity across
 * renders, so it can be passed to memoised children or used in dependency arrays
 * without re-scheduling.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  waitMs: number,
): DebouncedFn<A> {
  // Keep the latest callback in a ref so identity doesn't change when it does.
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  const debounced = useMemo(
    () => debounce<A>((...args: A) => latest.current(...args), waitMs),
    [waitMs],
  );

  // Cancel a pending call if the component unmounts before it fires.
  useEffect(() => () => debounced.cancel(), [debounced]);
  return debounced;
}

/**
 * A debounced mirror of a value. Use it for derived UI (counts, hints, previews)
 * that shouldn't recompute on every keystroke.
 */
export function useDebouncedValue<T>(value: T, waitMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), waitMs);
    return () => clearTimeout(timer);
  }, [value, waitMs]);

  return settled;
}

/**
 * A one-shot guard for events that must not fire twice for the same input.
 * Returns `true` the first time it sees a key, then `false` for `windowMs`.
 * Used to swallow the browser's double-submit / double-tap behaviour.
 */
export function useOnceGuard(windowMs = 400) {
  const seen = useRef<{ key: string; at: number } | null>(null);
  return useCallback(
    (key: string) => {
      const now = Date.now();
      const last = seen.current;
      if (last && last.key === key && now - last.at < windowMs) return false;
      seen.current = { key, at: now };
      return true;
    },
    [windowMs],
  );
}
