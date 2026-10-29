import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';

let clock = new Date('2026-10-29T12:00:00Z');
function app(mailer = new MemoryMailer()) {
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  return {
    mailer,
    api: createApp({
      ledger: new CompositeLedger(live, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(),
      auth: new InMemoryAuthStore(),
      mailer,
      appUrl: 'https://settle.example',
      now: () => clock,
    }),
  };
}

let ip = 10;
const headers = () => ({ 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ip++}` });
const post = (api: ReturnType<typeof app>['api'], path: string, body: unknown, extra: Record<string, string> = {}) =>
  api.request(path, { method: 'POST', headers: { ...headers(), ...extra }, body: JSON.stringify(body) });
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

async function registered() {
  const ctx = app();
  const res = await post(ctx.api, '/api/auth/register', { email: 'anthony@example.com', password: 'old-password', displayName: 'Anthony Zhou' });
  expect(res.status).toBe(201);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  return { ...ctx, cookie };
}

describe('password reset', () => {
  it('answers the same for known and unknown emails, and only mails the real account', async () => {
    const { api, mailer } = await registered();
    const known = await post(api, '/api/auth/password-reset/request', { email: 'Anthony@Example.com' });
    const unknown = await post(api, '/api/auth/password-reset/request', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('anthony@example.com');
    expect(mailer.sent[0]!.text).toContain('https://settle.example/reset-password#token=');
  });

  it('resets the password once, signs out old sessions, and rejects reuse', async () => {
    clock = new Date('2026-10-29T12:00:00Z');
    const { api, mailer, cookie } = await registered();
    await post(api, '/api/auth/password-reset/request', { email: 'anthony@example.com' });
    const token = tokenFrom(mailer.sent[0]!.text);
    expect(token.length).toBeGreaterThan(20);

    const short = await post(api, '/api/auth/password-reset/confirm', { token, password: 'short' });
    expect(short.status).toBe(400);

    const ok = await post(api, '/api/auth/password-reset/confirm', { token, password: 'brand-new-password' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('settle_session=');

    const again = await post(api, '/api/auth/password-reset/confirm', { token, password: 'another-password' });
    expect(again.status).toBe(400);

    const oldSession = await api.request('/api/auth/session', { headers: { cookie } });
    expect((await oldSession.json() as { user: unknown }).user).toBeNull();

    expect((await post(api, '/api/auth/login', { email: 'anthony@example.com', password: 'old-password' })).status).toBe(401);
    expect((await post(api, '/api/auth/login', { email: 'anthony@example.com', password: 'brand-new-password' })).status).toBe(200);
  });

  it('expires tokens after 30 minutes and only the newest link works', async () => {
    clock = new Date('2026-10-29T12:00:00Z');
    const { api, mailer } = await registered();
    await post(api, '/api/auth/password-reset/request', { email: 'anthony@example.com' });
    await post(api, '/api/auth/password-reset/request', { email: 'anthony@example.com' });
    const first = tokenFrom(mailer.sent[0]!.text);
    const second = tokenFrom(mailer.sent[1]!.text);
    expect((await post(api, '/api/auth/password-reset/confirm', { token: first, password: 'brand-new-password' })).status).toBe(400);
    clock = new Date(clock.getTime() + 31 * 60_000);
    expect((await post(api, '/api/auth/password-reset/confirm', { token: second, password: 'brand-new-password' })).status).toBe(400);
  });

  it('rejects a made-up token', async () => {
    const { api } = await registered();
    const res = await post(api, '/api/auth/password-reset/confirm', { token: 'x'.repeat(43), password: 'brand-new-password' });
    expect(res.status).toBe(400);
  });
});
