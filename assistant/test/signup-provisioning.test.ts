import { describe, it, expect, vi } from 'vitest';
import { InMemoryAuthStore, EmailTakenError } from '../src/server/auth.js';

const input = { email: 'person@example.com', password: 'long-password', displayName: 'Sam Lee' };
describe('signup provisioning', () => {
  it('resumes an interrupted signup with the same identity and reserved account', async () => {
    const store = new InMemoryAuthStore();
    let reserved: string | undefined;
    await expect(store.provision(input, async user => { reserved = user.accountId; throw new Error('timeout after remote commit'); })).rejects.toThrow('timeout');
    expect(await store.findByEmail(input.email)).toBeNull();
    const user = await store.provision(input, async user => { expect(user.accountId).toBe(reserved); });
    expect((await store.findByEmail(input.email))?.accountId).toBe(user.accountId);
  });
  it('does not let another password take over a pending reservation', async () => {
    const store = new InMemoryAuthStore();
    await expect(store.provision(input, async () => { throw new Error('offline'); })).rejects.toThrow();
    const remote = vi.fn();
    await expect(store.provision({ ...input, password: 'different-password' }, remote)).rejects.toBeInstanceOf(EmailTakenError);
    expect(remote).not.toHaveBeenCalled();
  });
  it('serializes concurrent signup before creating remote accounts', async () => {
    const store = new InMemoryAuthStore();
    const remote = vi.fn(async () => {});
    const results = await Promise.allSettled([store.provision(input, remote), store.provision(input, remote)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(remote).toHaveBeenCalledTimes(1);
  });
});

it('enforces an account-specific attempt budget and resets it each minute', async () => {
  const store = new InMemoryAuthStore();
  const now = new Date('2026-11-05T12:00:00Z');
  expect(await store.allowAuthAttempt('account', now, 2)).toBe(true);
  expect(await store.allowAuthAttempt('account', now, 2)).toBe(true);
  expect(await store.allowAuthAttempt('account', now, 2)).toBe(false);
  expect(await store.allowAuthAttempt('account', new Date(now.getTime()+60_000), 2)).toBe(true);
});
