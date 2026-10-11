import { describe, expect, it } from 'vitest';
import { isNetworkError, retryableStatus, retryDelayMs } from '../src/server/providers/retry.js';

describe('model retry', () => {
  it('waits at least as long as Gemini asks, plus a small buffer', () => {
    const error = new Error('Please retry in 17.5s. {"retryDelay":"17s"}');
    expect(retryDelayMs(error, 1)).toBe(19_000);
    expect(retryDelayMs(error, 1, 20_000)).toBe(19_000);
    expect(retryDelayMs(error, 1, 10_000)).toBe(10_000);
  });

  it('falls back to exponential backoff when the error has no delay', () => {
    expect(retryDelayMs(new Error('overloaded'), 2)).toBe(4_000);
  });

  it('retries rate limits and server errors only', () => {
    expect(retryableStatus(Object.assign(new Error('quota'), { status: 429 }))).toBe(429);
    expect(retryableStatus(Object.assign(new Error('down'), { status: 503 }))).toBe(503);
    expect(retryableStatus(Object.assign(new Error('bad'), { status: 400 }))).toBeUndefined();
    const timedOut = new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    expect(isNetworkError(timedOut)).toBe(true);
    expect(retryableStatus(timedOut)).toBe(503);
  });
});
