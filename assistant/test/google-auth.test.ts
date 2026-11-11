import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { InMemoryAuthStore, hashSessionToken } from '../src/server/auth.js';
import { googleConfig, installGoogleAuth } from '../src/server/google-auth.js';

afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv('GOOGLE_AUTH_ENABLED', 'true');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-only-secret');
  vi.stubEnv('APP_URL', 'https://settle.example');
  const auth = new InMemoryAuthStore();
  Object.defineProperty(auth, 'persistent', { value: true });
  const issue = vi.fn();
  const provision = vi.fn();
  const app = new Hono();
  installGoogleAuth(app, auth, issue, provision);
  return { app, issue, provision, auth };
}
describe('Google authorization boundary', () => {
  it('requires configured HTTPS credentials', () => {
    setup();
    vi.stubEnv('APP_URL', 'http://settle.example');
    expect(googleConfig()).toBeNull();
  });
  it.each(['https://user:password@settle.example', 'https://settle.example/path', 'https://settle.example?redirect=evil', 'not-a-url'])('rejects unsafe app origin %s', origin => {
    setup(); vi.stubEnv('APP_URL', origin); expect(googleConfig()).toBeNull();
  });
  it('does not convert an unauthenticated link request into a signup', async () => {
    const { app } = setup();
    const response = await app.request('https://settle.example/auth/google/start?link=1');
    expect(response.headers.get('Location')).toContain('/signin?authError=link-required');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });
  it('sends a failed Google link back to the account page, which a signed-in user can see', async () => {
    const { app, auth, issue } = setup();
    await auth.insert({ id: 'u1', email: 'a@example.com', passwordHash: 'x', displayName: 'A', accountId: 'acc1', ownerId: 'o1' });
    await auth.saveSession(hashSessionToken('tok'), 'u1', new Date(Date.now() + 3_600_000));
    const start = await app.request('https://settle.example/auth/google/start?link=1', { headers: { Cookie: 'settle_session=tok' } });
    const flow = start.headers.get('Set-Cookie')!.split(';')[0]!;
    const response = await app.request('https://settle.example/auth/google/callback?state=wrong&code=forged', {
      headers: { Cookie: flow + '; settle_session=tok' },
    });
    expect(response.headers.get('Location')).toContain('/account-access?authError=google-link');
    expect(issue).not.toHaveBeenCalled();
  });
  it('rejects a mismatched callback state before contacting Google', async () => {
    const { app, issue, provision } = setup();
    const start = await app.request('https://settle.example/auth/google/start?accepted=1');
    const response = await app.request('https://settle.example/auth/google/callback?state=wrong&code=forged', {
      headers: { Cookie: start.headers.get('Set-Cookie')!.split(';')[0]! },
    });
    expect(response.headers.get('Location')).toContain('/signin?authError=google');
    expect(issue).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled();
  });
  it('uses minimal identity scopes, PKCE, state, nonce and a secure HTTP-only cookie', async () => {
    const { app } = setup();
    const response = await app.request('https://settle.example/auth/google/start?accepted=1');
    const location = new URL(response.headers.get('Location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')!.length).toBeGreaterThan(32);
    expect(location.searchParams.get('nonce')!.length).toBeGreaterThan(32);
    expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('Set-Cookie')).toMatch(/Secure/i);
    expect(location.searchParams.has('client_secret')).toBe(false);
  });
  it('rejects unsolicited callbacks without provisioning or issuing a session', async () => {
    const { app, provision, issue } = setup();
    const response = await app.request('https://settle.example/auth/google/callback?code=forged&state=forged');
    expect(response.headers.get('Location')).toContain('/signin?authError=google');
    expect(provision).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
});
