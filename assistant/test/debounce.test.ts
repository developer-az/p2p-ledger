import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../src/web/app/debounce.js';

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst into one trailing call', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 200);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('c');
  });

  it('cancel drops a scheduled call', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 200);

    debounced('a');
    debounced.cancel();
    vi.advanceTimersByTime(1_000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('can be called again after it has fired', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced('first');
    vi.advanceTimersByTime(100);
    debounced('second');
    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('second');
  });
});
