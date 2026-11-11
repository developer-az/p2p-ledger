import { describe, expect, it } from 'vitest';
import { InMemoryAlertDismissalStore } from '../src/server/alert-store.js';

describe('alert dismissals', () => {
  it('keeps dismissed ids scoped to one account and is idempotent', async () => {
    const store = new InMemoryAlertDismissalStore();
    await store.dismiss('me', 'large-spend:s1', new Date('2026-11-10T12:00:00Z'));
    await store.dismiss('me', 'large-spend:s1', new Date('2026-11-10T12:01:00Z'));
    await store.dismiss('you', 'large-spend:s2', new Date('2026-11-10T12:00:00Z'));

    expect([...(await store.list('me'))]).toEqual(['large-spend:s1']);
    expect([...(await store.list('you'))]).toEqual(['large-spend:s2']);
    expect([...(await store.list('nobody'))]).toEqual([]);
  });

  it('clears every dismissal when an account is deleted', async () => {
    const store = new InMemoryAlertDismissalStore();
    await store.dismiss('me', 'a', new Date());
    await store.dismiss('me', 'b', new Date());
    await store.deleteAll('me');

    expect([...(await store.list('me'))]).toEqual([]);
  });
});
