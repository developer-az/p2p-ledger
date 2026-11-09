import { describe, expect, it } from 'vitest';
import { geminiMinIntervalMs, isLongQuotaWait, isModelOutage, isNetworkError, isPolicyBlocked, isProviderUnavailable, paceDelayMs, retryableStatus, retryDelayMs } from '../src/server/providers/retry.js';

describe('model retry', () => {
  it('spaces calls when a minimum interval is set', () => {
    expect(paceDelayMs(1_000, 5_000, 13_000)).toBe(9_000);
    expect(paceDelayMs(1_000, 20_000, 13_000)).toBe(0);
    expect(paceDelayMs(1_000, 2_000, 0)).toBe(0);
    expect(geminiMinIntervalMs({ GEMINI_MIN_INTERVAL_MS: '13000' })).toBe(13_000);
    expect(geminiMinIntervalMs({})).toBe(0);
  });

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
    const daily = new Error('Please retry in 21h57m43.8s. {"retryDelay":"79063s","code":429} Quota exceeded for metric GenerateRequestsPerDay');
    expect(isLongQuotaWait(daily)).toBe(true);
    expect(isLongQuotaWait(new Error('Please retry in 17.5s.'))).toBe(false);
    const overloaded = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
    expect(retryableStatus(overloaded)).toBe(503);
    expect(isModelOutage(overloaded)).toBe(true);
    expect(isModelOutage(Object.assign(new Error('server error'), { status: 500 }))).toBe(true);
    expect(isModelOutage(Object.assign(new Error('gateway error'), { status: 502 }))).toBe(true);
    expect(isModelOutage(new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}'))).toBe(true);
    expect(isNetworkError(timedOut)).toBe(true);
    expect(retryableStatus(timedOut)).toBe(503);
    expect(isModelOutage(timedOut)).toBe(true);
  });

  it('treats a missing or blocked model as provider-unavailable', () => {
    const guardrail = Object.assign(
      new Error('OpenRouter 404: {"error":{"message":"0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy."}}'),
      { status: 404 },
    );
    expect(isProviderUnavailable(guardrail)).toBe(true);
    expect(isProviderUnavailable(new Error('{"error":{"code":404,"status":"NOT_FOUND","message":"models/gemini-2.0-flash-lite is not found"}}'))).toBe(true);
    expect(isProviderUnavailable(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isProviderUnavailable(new Error('model not found: gemini-2.0-flash-lite'))).toBe(true);
  });

  it('separates an account-wide policy block from a plain model-not-found', () => {
    expect(isPolicyBlocked(new Error('0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy.'))).toBe(true);
    expect(isPolicyBlocked(new Error('No endpoints found matching your data policy.'))).toBe(true);
    expect(isPolicyBlocked(Object.assign(new Error('OpenRouter 404: This model does not exist.'), { status: 404 }))).toBe(false);
    expect(isPolicyBlocked(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
  });
});
