import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore, durableLimiter, type RateLimitStore } from '../src/server/rate-limit-store.js';

const MIN = 60_000;

describe('durableLimiter (shared store, weighted sliding window)', () => {
  it('two app instances sharing one store enforce one combined limit', async () => {
    let t = 1_000;
    const store = new InMemoryRateLimitStore();
    const instanceA = durableLimiter(store, 'write', 3, MIN, { now: () => t });
    const instanceB = durableLimiter(store, 'write', 3, MIN, { now: () => t });
    expect((await instanceA.check('1.1.1.1')).allowed).toBe(true);
    expect((await instanceB.check('1.1.1.1')).allowed).toBe(true);
    expect((await instanceA.check('1.1.1.1')).allowed).toBe(true);
    const fourth = await instanceB.check('1.1.1.1');
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
    t += 1;
  });

  it('keys and limiter names are isolated', async () => {
    const store = new InMemoryRateLimitStore();
    const now = () => 5_000;
    const write = durableLimiter(store, 'write', 1, MIN, { now });
    const chat = durableLimiter(store, 'chat', 1, MIN, { now });
    expect((await write.check('a')).allowed).toBe(true);
    expect((await write.check('b')).allowed).toBe(true);
    expect((await chat.check('a')).allowed).toBe(true);
    expect((await write.check('a')).allowed).toBe(false);
  });

  it('weights the previous window, so a burst cannot double up across a window boundary', async () => {
    let t = 0;
    const store = new InMemoryRateLimitStore();
    const limit = durableLimiter(store, 'w', 3, MIN, { now: () => t });
    for (let i = 0; i < 3; i += 1) expect((await limit.check('k')).allowed).toBe(true);
    t = MIN + 1_000; // just past the boundary: previous window still weighs ~0.98
    expect((await limit.check('k')).allowed).toBe(false);
  });

  it('lets traffic through again once the previous window has mostly aged out', async () => {
    let t = 0;
    const store = new InMemoryRateLimitStore();
    const limit = durableLimiter(store, 'w', 3, MIN, { now: () => t });
    for (let i = 0; i < 3; i += 1) await limit.check('k');
    t = MIN + MIN / 2; // halfway into the next window: 3 * 0.5 + 1 = 2.5 <= 3
    expect((await limit.check('k')).allowed).toBe(true);
  });

  it('the boolean call form matches check().allowed', async () => {
    const store = new InMemoryRateLimitStore();
    const limit = durableLimiter(store, 'w', 1, MIN, { now: () => 10 });
    expect(await limit('ip')).toBe(true);
    expect(await limit('ip')).toBe(false);
  });

  it('falls back to a local limiter when the store fails, so limits never disappear', async () => {
    const broken: RateLimitStore = { hit: () => Promise.reject(new Error('db down')) };
    const limit = durableLimiter(broken, 'w', 2, MIN, { now: () => 10 });
    expect(await limit('ip')).toBe(true);
    expect(await limit('ip')).toBe(true);
    expect(await limit('ip')).toBe(false);
  });
});
