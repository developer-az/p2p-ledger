import { it, expect } from 'vitest';
import { PostgresAuthStore, hashPassword, hashSessionToken, verifyPassword } from '../src/server/auth.js';
import pg from 'pg';

it.skipIf(!process.env.SETTLE_TEST_DATABASE_URL)('recovers durable signup across instances and atomically resets password and sessions', async () => {
  const url = process.env.SETTLE_TEST_DATABASE_URL!;
  const first = new PostgresAuthStore(url);
  const second = new PostgresAuthStore(url);
  const input = { email: `verify-${crypto.randomUUID()}@example.test`, password: 'long-test-password', displayName: 'Test User' };
  let accountId: string | undefined;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await expect(first.provision(input, async user => { accountId = user.accountId; throw new Error('remote committed, response lost'); })).rejects.toThrow();
    const user = await second.provision(input, async user => { expect(user.accountId).toBe(accountId); });
    expect((await first.findByEmail(input.email))?.id).toBe(user.id);
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).allowAuthAttempt(input.email, new Date(), 10)));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    const expires = new Date(Date.now() + 60_000);
    await first.saveSession('old-session-hash', user.id, expires);
    const token = hashSessionToken('reset-token');
    await first.saveResetToken(token, user.id, expires);
    const passwordHash = await hashPassword('new-long-password');
    const results = await Promise.all([first.completeReset(token, new Date(), passwordHash), second.completeReset(token, new Date(), passwordHash)]);
    expect(results.filter(Boolean)).toEqual([user.id]);
    expect(await first.userForToken('old-session-hash', new Date())).toBeNull();
    expect(await verifyPassword('new-long-password', (await first.findByEmail(input.email))!.passwordHash)).toBe(true);
  } finally {
    await c.query('delete from app_users where email=$1', [input.email]);
    await c.query('delete from app_signup_attempts where email=$1', [input.email]);
    await c.end();
  }
}, 30_000);
