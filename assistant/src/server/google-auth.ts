import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getCookie, getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import type { Context, Hono } from 'hono';
import { hashSessionToken, SESSION_COOKIE, type AuthRecord, type AuthStore } from './auth.js';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const cookie = 'settle_google_flow';
export function googleConfig() {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') return null;
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (!clientId || !secret || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) return null;
  } catch { return null; }
  return { clientId, secret, origin, redirect: origin + '/api/auth/google/callback' };
}

export function installGoogleAuth(app: Hono, auth: AuthStore,
  issueSession: (c: Context, id: string) => Promise<void>,
  provision: (email: string, name: string, password: string) => Promise<AuthRecord>,
  /** Returns a second-factor challenge when the account requires one. */
  startMfa?: (userId: string) => Promise<string | null>) {
  app.get('/auth/google/start', async c => {
    const config = googleConfig();
    if (!config || !auth.persistent) return c.json({ error: 'Google sign-in is not configured.' }, 503);
    if (!await auth.allowAuthAttempt('google-start:' + (c.req.header('x-forwarded-for')?.split(',')[0] ?? 'unknown'), new Date(), 10))
      return c.json({ error: 'Too many attempts. Try again later.' }, 429);
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const session = getCookie(c, SESSION_COOKIE);
    // Linking is explicit and requires the same authenticated session at callback.
    const linking = c.req.query('link') === '1';
    if (!linking && c.req.query('accepted') !== '1') return c.redirect(config.origin + '/google-signin');
    if (linking && (!session || !await auth.userForToken(hashSessionToken(session), new Date())))
      return c.redirect(config.origin + '/signin?authError=link-required');
    const link = linking && session ? hashSessionToken(session) : null;
    await setSignedCookie(c, cookie, JSON.stringify({ state, nonce, verifier, link, expires: Date.now() + 600_000 }), config.secret,
      { httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth/google', maxAge: 600 });
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect,
      response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
  });
  app.get('/auth/google/callback', async c => {
    const config = googleConfig();
    if (!config || !auth.persistent) return c.json({ error: 'Google sign-in is not configured.' }, 503);
    c.header('Referrer-Policy', 'no-referrer');
    const fail = () => c.redirect(config.origin + '/signin?authError=google');
    let failFlow = fail;
    try {
      const raw = await getSignedCookie(c, config.secret, cookie);
      deleteCookie(c, cookie, { path: '/api/auth/google', secure: true });
      if (!raw) return fail();
      const flow = JSON.parse(raw);
      // A linking failure must land where the signed-in user can see it; /signin renders the app.
      failFlow = flow?.link ? () => c.redirect(config.origin + '/account-access?authError=google-link') : fail;
      const code = c.req.query('code');
      if (flow.expires < Date.now() || flow.state !== c.req.query('state') || !code || code.length > 4096) return failFlow();
      if (!await auth.allowAuthAttempt('google-code:' + hashSessionToken(code), new Date(), 1)) return failFlow();
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.secret,
          redirect_uri: config.redirect, grant_type: 'authorization_code', code_verifier: flow.verifier }) });
      if (!response.ok) return failFlow();
      const tokens = await response.json() as { id_token?: string };
      if (!tokens.id_token) return failFlow();
      const { payload } = await jwtVerify(tokens.id_token, keys, { audience: config.clientId,
        issuer: ['https://accounts.google.com', 'accounts.google.com'], algorithms: ['RS256'], maxTokenAge: '10m',
        requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email', 'email_verified'] });
      if (!payload.sub || payload.nonce !== flow.nonce || payload.email_verified !== true || typeof payload.email !== 'string'
        || (payload.azp !== undefined && payload.azp !== config.clientId)) return failFlow();
      let user = await auth.findByGoogleSubject(payload.sub);
      if (flow.link) {
        const session = getCookie(c, SESSION_COOKIE);
        if (!session || hashSessionToken(session) !== flow.link) return failFlow();
        const current = await auth.userForToken(flow.link, new Date());
        if (!current || (user && user.id !== current.id)) return failFlow();
        if (!user) await auth.linkGoogleSubject(payload.sub, current.id);
        user = current;
      } else if (!user) {
        const email = payload.email.toLowerCase();
        if (await auth.findByEmail(email)) return c.redirect(config.origin + '/signin?authError=link-required');
        // Stable, secret-derived reservation credential allows retries after a ledger
        // outage. It is never disclosed and cannot be computed from the public subject.
        const reservationPassword = createHmac('sha256', config.secret).update('google-provision:' + payload.sub).digest('base64url');
        user = await provision(email, typeof payload.name === 'string' ? payload.name.slice(0, 40) : 'Google user', reservationPassword);
        await auth.linkGoogleSubject(payload.sub, user.id);
      }
      // A Google sign-in for an MFA account stops here; the challenge is
      // completed through the normal POST /api/auth/mfa/verify route.
      if (!flow.link) {
        const challenge = await startMfa?.(user.id);
        if (challenge) return c.redirect(config.origin + '/signin?mfa=' + encodeURIComponent(challenge));
      }
      await issueSession(c, user.id);
      return c.redirect(config.origin + '/?authComplete=google');
    } catch { return failFlow(); }
  });
}
