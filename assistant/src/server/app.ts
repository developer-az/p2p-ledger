import { randomBytes, randomUUID } from 'node:crypto';
import { googleConfig, installGoogleAuth } from './google-auth.js';
import type { JavaWorkflows } from './java-workflows.js';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { runAssistant, type AssistantReply } from './agent.js';
import { booksCheck, paymentTrail, racePayment, replayPayment, tamperWithPayment } from './console.js';
import { seedDemo } from './demo.js';
import { seedDemoHabits, type DemoPersona } from './demo-habits.js';
import { normalizeProviderId } from './env-normalize.js';
import { answerFromLedger } from './fallback.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from './ledger.js';
import { isModelOutage } from './providers/retry.js';
import type { LlmProvider } from './providers/types.js';
import { PRACTICE_ANTHONY, PRACTICE_JORDAN, PRACTICE_SAM, type CompositeLedger, type PracticeLedger } from './practice-ledger.js';
import { LEDGER_CAPABILITIES } from './personas.js';
import { formatLedgerStatement } from './statement-export.js';
import {
  bankSimulatorStatus,
  simulateInboundCorridor,
  simulateOutboundCorridor,
  welcomeBankPackage,
} from './bank-sim.js';
import { peerLedgerView } from './peer-ledger.js';
import { buildActivityFeed, buildPersonalInsights } from './money-insights.js';
import { buildHabitsFromEntries, buildHabitsHome, SPEND_CATEGORIES, type SpendLogStore } from './spend-log.js';
import { buildSpendingPatterns } from './spending-patterns.js';
import {
  buildFinanceSnapshot,
  INCOME_SOURCES,
  InMemoryPersonalFinanceStore,
  type PersonalFinanceStore,
} from './personal-finance.js';
import { formatMoney } from './money.js';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import { loadAccountView, type WeeklyFinance } from './tools.js';
import {
  InMemoryPaymentRequestStore,
  type PaymentRequest,
  type PaymentRequestStore,
} from './payment-requests.js';
import { explainDecline } from './peer-ledger.js';
import { providerFromEnv } from './providers/index.js';
import { MAX_MINOR_UI } from './money.js';
import { LlmGuard, trimHistory } from './llm-guard.js';
import { API_HEADERS, securityHeaders } from './security-headers.js';
import { createMailer, passwordResetEmail, type Mailer } from './mailer.js';
import { isBreachedPassword } from './breached-password.js';
import { LoginThrottle } from './login-throttle.js';
import { retryAfterSeconds } from './rate-limit.js';
import { InMemoryRateLimitStore, durableLimiter, type RateLimitStore } from './rate-limit-store.js';
import { SETTLE_RAILS, type SettleRail } from './payment-requests.js';
import {
  EmailTakenError,
  InMemoryAuthStore,
  SESSION_COOKIE,
  RESET_TOKEN_TTL_SEC,
  SESSION_ABSOLUTE_MS,
  SESSION_MAX_AGE_SEC,
  deviceLabel,
  dummyPasswordHash,
  hashPassword,
  hashSessionToken,
  ipPrefix,
  newSessionToken,
  verifyPassword,
  type AuthStore,
} from './auth.js';
import {
  base32Encode,
  decryptSecret,
  devMfaKey,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  otpauthUri,
  verifyRecoveryCode,
  verifyTotp,
} from './totp.js';

const openAccountBody = z.object({
  ownerId: z.string().min(1).max(64),
  currency: z.string().length(3).default('USD'),
});

/* Digits are allowed after the first letter: a name like "Verify Check 25"
   is a name, not a handle. The letters-only version of this rule rejected
   it at signup (found in the 2026-11-01 live check). */
const displayNameField = z.string().trim().min(1).max(40).regex(/^[\p{L}][\p{L}\p{N}\s'.-]{0,39}$/u, 'Use your name, not a handle.');
const registerBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8, 'Use at least 8 characters.').max(72),
  displayName: displayNameField,
});
const loginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72),
});
const mfaCodeBody = z.object({ code: z.string().trim().min(1).max(64) });
const mfaVerifyBody = z.object({
  challenge: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(64),
});
const stepUpBody = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(72).optional(),
});

const depositBody = z.object({ amountMinor: z.number().int().positive().max(MAX_MINOR_UI) });
const transferBody = z.object({
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  currency: z.string().length(3).default('USD'),
  memo: z.string().max(200).optional(),
});

const chatBody = z.object({
  accountId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(2000),
  })).min(1).max(20).refine((m) => m.at(-1)?.role === 'user', 'Last message must be from the user'),
});

const requestBody = z.object({
  requesterAccountId: z.string().uuid(),
  memo: z.string().max(140).optional(),
  payers: z.array(z.object({
    accountId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  })).min(1).max(8),
});
const requestActorBody = z.object({ accountId: z.string().uuid() });
/** The requester confirms money arrived outside the app: "paid me on Zelle". */
const requestSettleBody = z.object({
  accountId: z.string().uuid(),
  settledVia: z.enum(SETTLE_RAILS),
});

const paymentBody = z.object({ accountId: z.string().uuid(), transferId: z.string().uuid() });
const raceBody = z.object({ accountId: z.string().uuid(), fromAccountId: z.string().uuid() });

/**
 * Fixed ids for the three seeded demo requests. Every serverless instance agrees on these
 * keys, so a pay/decline call can land anywhere and still find the row (see PLAN.md step 2).
 */
export const PRACTICE_REQUEST_GROCERIES = '01111111-1111-7111-8111-111111111301';
export const PRACTICE_REQUEST_UTILITIES = '01111111-1111-7111-8111-111111111302';
export const PRACTICE_REQUEST_PARKING = '01111111-1111-7111-8111-111111111303';
const PRACTICE_REQUEST_IDS = new Set([PRACTICE_REQUEST_GROCERIES, PRACTICE_REQUEST_UTILITIES, PRACTICE_REQUEST_PARKING]);

const recordSpendBody = z.object({
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  category: z.enum(SPEND_CATEGORIES),
  note: z.string().max(140).optional(),
  occurredAt: z.string().datetime().optional(),
});

const financePatchBody = z.object({
  rebaseCash: z.boolean().optional(),
  walletCashMinor: z.number().int().min(0).max(MAX_MINOR_UI).nullable().optional(),
  creditOwedMinor: z.number().int().min(0).max(MAX_MINOR_UI).optional(),
  weeklyBudgetMinor: z.number().int().min(0).max(MAX_MINOR_UI).nullable().optional(),
  spendLogsAffectWallet: z.boolean().optional(),
});

const recordIncomeBody = z.object({
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  source: z.enum(INCOME_SOURCES),
  note: z.string().max(140).optional(),
  occurredAt: z.string().datetime().optional(),
});

/** How long /wake waits on the ledger before answering "still asleep". */
const WAKE_PROBE_TIMEOUT_MS = 9_000;

/** Sign-in second-factor challenge lifetime and the step-up window. */
const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const STEP_UP_MS = 10 * 60_000;

/**
 * Rate limiters are built once per app instance (see rate-limit-store.ts). The
 * chat limiter guards the paid LLM quota; the rest guard writes. All of them
 * are per client IP and backed by the shared store when one is supplied, so the
 * limit is the same across serverless instances and a burst cannot be doubled
 * by straddling a fixed-window boundary.
 */
export function createApp(deps: {
  ledger: CompositeLedger;
  practice: PracticeLedger;
  spendLogs: SpendLogStore;
  personalFinance?: PersonalFinanceStore;
  paymentRequests?: PaymentRequestStore;
  javaWorkflows?: JavaWorkflows;
  liveLedger?: LedgerWriter & LedgerAuditor;
  isLiveLedgerUp?: () => Promise<boolean>;
  /** Tests and practice mode use memory. Production passes Postgres when a database URL is set. */
  auth?: AuthStore;
  /** Sends password-reset links. Defaults to Resend when configured, else the server log (dev). */
  mailer?: Mailer;
  /** Public origin used in emailed links (APP_URL). Falls back to the request's own origin. */
  appUrl?: string;
  /** Practice fixtures stay public; production requires registered identities for all other wallets. */
  enforceWalletAuth?: boolean;
  /** Tests inject a fake model; production loads Gemini/Claude on first chat only. */
  provider?: () => LlmProvider;
  /** Tests inject a guard with a frozen clock; production builds one per app instance. */
  llmGuard?: LlmGuard;
  /** Shared hit counters. Production passes Postgres so limits span instances; tests default to memory. */
  rateLimitStore?: RateLimitStore;
  /** 32-byte AES key that encrypts stored TOTP secrets. Defaults to MFA_ENCRYPTION_KEY. */
  mfaKey?: Buffer;
  now?: () => Date;
  /** HIBP password check. Tests inject a fake; VITEST defaults to no network. */
  breachedPassword?: (password: string) => Promise<boolean>;
}) {
  const now = deps.now ?? (() => new Date());
  const mfaKey = resolveMfaKey(deps.mfaKey);
  /**
   * Pending second-factor challenges for password sign-in. This map is per
   * process: a multi-instance deploy (Vercel, several Node workers) needs these
   * rows in Postgres so a challenge survives a request landing elsewhere.
   */
  const mfaChallenges = new Map<string, { userId: string; expiresAt: number; attempts: number }>();
  const personalFinance = deps.personalFinance ?? new InMemoryPersonalFinanceStore();
  const paymentRequests = deps.paymentRequests ?? new InMemoryPaymentRequestStore();
  /**
   * Practice demo history lives in memory, so a cold serverless instance that
   * never saw POST /demo/practice would render an empty demo. Every read path
   * for a PRACTICE_* wallet seeds lazily instead. seedDemoHabits is idempotent;
   * the map below collapses concurrent calls for the same wallet within one
   * instance so a burst of reads cannot double-seed.
   */
  const PRACTICE_DEMO_PERSONAS: Record<string, DemoPersona> = {
    [PRACTICE_ANTHONY]: 'anthony',
    [PRACTICE_SAM]: 'sam',
    [PRACTICE_JORDAN]: 'jordan',
  };
  const practiceSeedInFlight = new Map<string, Promise<void>>();
  const ensurePracticeDemoSeeded = (accountId: string): Promise<void> => {
    const persona = PRACTICE_DEMO_PERSONAS[accountId];
    if (!persona) return Promise.resolve();
    const inFlight = practiceSeedInFlight.get(accountId);
    if (inFlight) return inFlight;
    const seeding = seedDemoHabits(deps.spendLogs, personalFinance, accountId, persona, now())
      .then(() => undefined)
      .catch((e: unknown) => {
        practiceSeedInFlight.delete(accountId);
        throw e;
      });
    practiceSeedInFlight.set(accountId, seeding);
    return seeding;
  };
  const llmGuard = deps.llmGuard ?? new LlmGuard();
  const auth = deps.auth ?? new InMemoryAuthStore();
  const mailer = deps.mailer ?? createMailer();
  const appUrl = (deps.appUrl ?? process.env.APP_URL ?? '').trim().replace(/\/$/, '');
  const enforceWalletAuth = deps.enforceWalletAuth ?? (auth.persistent || process.env.NODE_ENV === 'production');
  const app = new Hono().basePath('/api');
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      const allowed = new Set([new URL(c.req.url).origin]);
      if (appUrl) allowed.add(new URL(appUrl).origin);
      if (c.req.header('Sec-Fetch-Site') === 'cross-site' || (origin && !allowed.has(origin)))
        return c.json({ error: 'cross_origin' }, 403);
    }
    await next();
  });
  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const allowChat = durableLimiter(rateLimitStore, 'chat', 20, 60_000);
  const allowSeed = durableLimiter(rateLimitStore, 'seed', 3, 60_000);
  const allowWrite = durableLimiter(rateLimitStore, 'write', 40, 60_000);
  const allowProof = durableLimiter(rateLimitStore, 'proof', 12, 60_000);
  const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  // Per-process sign-in counters (see login-throttle.ts). IPs get 20 free
  // failures because one address can legitimately try several accounts.
  const threatNow = () => now().getTime();
  const accountThrottle = new LoginThrottle({ now: threatNow });
  const ipThrottle = new LoginThrottle({ now: threatNow, blockAfter: 20 });
  const breachedPassword = deps.breachedPassword
    ?? (process.env.VITEST ? async () => false : isBreachedPassword);
  const sessionUser = async (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? auth.userForToken(hashSessionToken(token), now()) : null;
  };
  const walletAccessError = async (c: Context, accountId: string): Promise<Response | null> => {
    const owner = await auth.findByAccountId(accountId);
    if (!owner) {
      if (deps.practice.isPracticeAccount(accountId) || !enforceWalletAuth) return null;
      return c.json({ error: 'Sign in to access this wallet.' }, 401);
    }
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in to access this wallet.' }, 401);
    if (user.id !== owner.id || user.accountId !== accountId) {
      return c.json({ error: 'This wallet belongs to another account.' }, 403);
    }
    return null;
  };
  const walletsAccessError = async (c: Context, ...accountIds: string[]): Promise<Response | null> => {
    for (const accountId of accountIds) {
      const denied = await walletAccessError(c, accountId);
      if (denied) return denied;
    }
    return null;
  };
  const ownerAccessError = async (c: Context, ownerId: string): Promise<Response | null> => {
    if ((await deps.practice.accountsByOwner(ownerId)).length > 0) return null;
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in to access this wallet.' }, 401);
    if (user.ownerId !== ownerId) return c.json({ error: 'This wallet belongs to another account.' }, 403);
    return null;
  };
  const protectWalletPath = async (c: Context, next: () => Promise<void>) => {
    const accountId = c.req.param('id');
    if (!accountId) {
      await next();
      return;
    }
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    await next();
  };
  app.use('*', securityHeaders(API_HEADERS));
  app.use('/accounts/:id', protectWalletPath);
  app.use('/accounts/:id/*', protectWalletPath);

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/ready', async (c) => {
    if (!auth.persistent || !deps.javaWorkflows) return c.json({ ready: false }, 503);
    try {
      await auth.findByEmail('readiness-probe@invalid.local');
      await deps.javaWorkflows.assertReady();
      return c.json({ ready: true });
    } catch { return c.json({ ready: false }, 503); }
  });

  /**
   * Cheap wake trigger. Render's free tier sleeps the ledger after ~15 idle
   * minutes and takes 30-60s to come back. The client fires this on first paint
   * so the ledger starts booting while the landing page renders. It probes,
   * gives up after 9s, and never returns 5xx: a cold ledger is not an error.
   */
  app.get('/wake', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!deps.isLiveLedgerUp) return c.json({ awake: false, configured: false });
    const started = Date.now();
    let awake = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      awake = await Promise.race([
        deps.isLiveLedgerUp(),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), WAKE_PROBE_TIMEOUT_MS); }),
      ]);
    } catch {
      awake = false;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return c.json({ awake, configured: true, ms: Date.now() - started });
  });

  app.get('/bootstrap', async (c) => {
    const practice = deps.practice.bootstrap();
    let live = false;
    let auditCapabilities = false;
    if (deps.isLiveLedgerUp) {
      live = await Promise.race([
        deps.isLiveLedgerUp(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (live && deps.liveLedger) {
        auditCapabilities = true;
      }
    }
    let chat: {
      provider: string;
      configured: boolean;
      model?: string;
      configHint?: string;
    } = { provider: normalizeProviderId(process.env.LLM_PROVIDER), configured: false };
    try {
      const p = providerFromEnv();
      chat = { provider: p.name, configured: true, model: p.model };
    } catch (e) {
      chat.configured = false;
      chat.configHint = llmConfigError(e);
    }
    const production = process.env.NODE_ENV === 'production';
    let signupAvailable = !production;
    let unavailableReason: string | undefined;
    if (production && !auth.persistent) unavailableReason = 'Accounts are not connected on this deployment. You can explore the sample without signing up.';
    else if (auth.persistent && deps.javaWorkflows) {
      try {
        await auth.findByEmail('readiness-probe@invalid.local');
        await deps.javaWorkflows.assertReady();
        signupAvailable = true;
      } catch { signupAvailable = false; unavailableReason = 'Account creation is unavailable. You can try signing in to an existing account or explore the sample.'; }
    } else if (production) unavailableReason = 'Account services are not connected on this deployment. The sample is available.';
    return c.json({
      live,
      practice,
      ledger: {
        engine: 'ledger-service',
        apiVersion: 'v1',
        capabilities: [...LEDGER_CAPABILITIES],
        persistence: live
          ? `Accounts and transfers persist in PostgreSQL (Render).${
            databaseUrlFromEnv() ? ' Habit logs persist in spend_logs on the same database.' : ''
          }`
          : 'The ledger on this server is in memory until it restarts.',
        auditCapabilities,
      },
      chat,
      identity: {
        persistent: auth.persistent, signupAvailable,
        googleAvailable: auth.persistent && !!googleConfig(),
        signinAvailable: !production || auth.persistent,
        passwordResetAvailable: mailer.delivers && (!production || auth.persistent),
        unavailableReason,
      },
    });
  });

  const issueSession = async (c: Parameters<typeof setCookie>[0], userId: string) => {
    const token = newSessionToken();
    const createdAt = now();
    const expires = new Date(createdAt.getTime() + SESSION_ABSOLUTE_MS);
    await auth.saveSession(hashSessionToken(token), userId, expires, {
      createdAt,
      device: deviceLabel(c.req.header('user-agent')),
      ipPrefix: ipPrefix(c.req.header('x-forwarded-for')),
    });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      secure: true,
    });
  };

  installGoogleAuth(app, auth, issueSession, async (email, displayName, password) => {
    if (!deps.javaWorkflows || !auth.persistent) throw new Error('Account services unavailable');
    return auth.provision({ email, displayName, password }, async reserved => {
      await deps.javaWorkflows!.assertReady();
      await deps.javaWorkflows!.request('PUT', `/v1/accounts/${reserved.accountId}/provision`,
        { ownerId: reserved.ownerId, currency: 'USD' });
    });
  });

  const rotateSession = async (c: Context, userId: string) => {
    // Drop the current token and every other session, then hand out a fresh one.
    await auth.deleteSessionsForUser(userId);
    await issueSession(c, userId);
  };

  const consumeRecoveryCode = async (userId: string, code: string, at: Date): Promise<boolean> => {
    for (const stored of await auth.listRecoveryCodes(userId)) {
      if (await verifyRecoveryCode(code, stored.codeHash)) {
        return await auth.useRecoveryCode(userId, stored.id, at);
      }
    }
    return false;
  };

  app.post('/auth/register', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const parsed = registerBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0];
      if (field === 'email') return c.json({ error: 'Enter a valid email.' }, 400);
      if (field === 'password') return c.json({ error: 'Use at least 8 characters.' }, 400);
      if (field === 'displayName') return c.json({ error: issue?.message ?? 'Use your name, not a handle.' }, 400);
      return c.json({ error: 'Check the email, name, and password.' }, 400);
    }
    const email = parsed.data.email.toLowerCase();
    if (!await auth.allowAuthAttempt('credentials:' + email, now()))
      return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const displayName = parsed.data.displayName.replace(/\s+/g, ' ');
    if (process.env.NODE_ENV === 'production' && !auth.persistent)
      return c.json({ error: 'Account creation is temporarily unavailable. Please try again later.' }, 503);
    if (await breachedPassword(parsed.data.password))
      return c.json({ error: 'breached_password' }, 400);
    let user;
    try {
      user = await auth.provision({ email, password: parsed.data.password, displayName }, async (reserved) => {
        if (deps.javaWorkflows && auth.persistent) {
          await deps.javaWorkflows.assertReady();
          await deps.javaWorkflows.request('PUT', `/v1/accounts/${reserved.accountId}/provision`,
            { ownerId: reserved.ownerId, currency: 'USD' });
        } else {
          if (process.env.NODE_ENV === 'production') throw new LedgerError(503, 'Account creation is temporarily unavailable.');
          const account = await deps.ledger.openAccount(reserved.ownerId, 'USD');
          reserved.accountId = account.id;
        }
      });
    } catch (e) {
      // Constant body: the reply must not describe the existing account.
      if (e instanceof EmailTakenError) return c.json({ error: 'signup_failed' }, 409);
      return c.json({ error: 'We could not finish creating your account. Try again with the same email and password.' }, 503);
    }
    const userId = user.id;
    const account = { id: user.accountId, ownerId: user.ownerId };
    await issueSession(c, userId);
    return c.json({
      user: { email, displayName },
      account: { id: account.id, owner: account.ownerId },
    }, 201);
  });

  app.post('/auth/login', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter the email and password for your account.' }, 400);
    const email = parsed.data.email.toLowerCase();
    const accountKey = 'acct:' + email;
    const ipKey = 'ip:' + clientIp(c);
    const accountVerdict = accountThrottle.check(accountKey);
    const ipVerdict = ipThrottle.check(ipKey);
    if (!accountVerdict.allowed || !ipVerdict.allowed) {
      const retryAfterSec = Math.max(accountVerdict.retryAfterSec, ipVerdict.retryAfterSec);
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'too_many_attempts' }, 429);
    }
    if (!await auth.allowAuthAttempt('credentials:' + email, now()))
      return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const user = await auth.findByEmail(email);
    // A missing email still pays the scrypt cost, so timing does not separate
    // unknown accounts from wrong passwords.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? await dummyPasswordHash());
    if (!user || !ok) {
      accountThrottle.fail(accountKey);
      ipThrottle.fail(ipKey);
      return c.json({ error: 'Email or password is incorrect.' }, 401);
    }
    accountThrottle.succeed(accountKey);
    ipThrottle.succeed(ipKey);
    const mfa = await auth.getMfaState(user.id);
    if (mfa.secret) {
      const at = now().getTime();
      for (const [token, challenge] of mfaChallenges) {
        if (challenge.expiresAt <= at) mfaChallenges.delete(token);
      }
      const challenge = randomBytes(32).toString('base64url');
      mfaChallenges.set(challenge, {
        userId: user.id,
        expiresAt: at + MFA_CHALLENGE_TTL_MS,
        attempts: 0,
      });
      return c.json({ mfaRequired: true, challenge });
    }
    await issueSession(c, user.id);
    return c.json({
      user: { email: user.email, displayName: user.displayName },
      account: { id: user.accountId, owner: user.ownerId },
    });
  });

  app.get('/auth/session', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ user: null });
    const user = await auth.userForToken(hashSessionToken(token), now());
    if (!user) return c.json({ user: null });
    return c.json({
      user: { email: user.email, displayName: user.displayName },
      account: { id: user.accountId, owner: user.ownerId },
    });
  });

  app.get('/auth/sessions', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'Sign in first.' }, 401);
    const tokenHash = hashSessionToken(token);
    const user = await auth.userForToken(tokenHash, now());
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const sessions = await auth.listSessions(user.id);
    return c.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        current: session.tokenHash === tokenHash,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        device: session.device,
        ipPrefix: session.ipPrefix,
      })),
    });
  });

  app.delete('/auth/sessions/:id', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'Sign in first.' }, 401);
    const user = await auth.userForToken(hashSessionToken(token), now());
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const revoked = await auth.revokeSession(user.id, c.req.param('id'));
    if (!revoked) return c.json({ error: 'Session not found.' }, 404);
    return c.json({ ok: true });
  });

  app.post('/auth/google/disconnect', async c => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!await auth.allowAuthAttempt('disconnect:' + user.id, now(), 5)) return c.json({ error: 'Try again later.' }, 429);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.password !== 'string' || body.password.length > 72 || !await verifyPassword(body.password, user.passwordHash))
      return c.json({ error: 'Enter your password. If you joined with Google, use Forgot password to set one first.' }, 400);
    await auth.unlinkGoogle(user.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    return c.json({ ok: true });
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.deleteSession(hashSessionToken(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    return c.json({ ok: true });
  });

  // TOTP MFA: a pending secret is encrypted until the first valid code confirms
  // it. Enabling/disabling rotates the session and signs out every other device.
  app.get('/auth/mfa', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const state = await auth.getMfaState(user.id);
    return c.json({
      enabled: state.secret !== null,
      recoveryCodesLeft: state.recoveryCodesLeft,
    });
  });

  app.post('/auth/mfa/setup', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
    const secret = randomBytes(20);
    await auth.saveMfaPendingSecret(user.id, encryptSecret(secret, mfaKey));
    return c.json({ secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) });
  });

  app.post('/auth/mfa/enable', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
    const parsed = mfaCodeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    const state = await auth.getMfaState(user.id);
    if (!state.pendingSecret) return c.json({ error: 'invalid_code' }, 400);
    const secret = decryptSecret(state.pendingSecret, mfaKey);
    const verdict = verifyTotp(secret, parsed.data.code, now().getTime());
    if (!verdict.ok) return c.json({ error: 'invalid_code' }, 400);
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
    await auth.enableMfa(user.id, state.pendingSecret, hashes, verdict.step ?? null);
    await rotateSession(c, user.id);
    return c.json({ recoveryCodes });
  });

  /** Password sign-in stopped after the first factor; this finishes it. */
  app.post('/auth/mfa/verify', async (c) => {
    const parsed = mfaVerifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    const pending = mfaChallenges.get(parsed.data.challenge);
    if (!pending) return c.json({ error: 'invalid_code' }, 400);
    const at = now();
    if (pending.expiresAt <= at.getTime()) {
      mfaChallenges.delete(parsed.data.challenge);
      return c.json({ error: 'challenge_expired' }, 400);
    }
    const user = await auth.findById(pending.userId);
    const state = user ? await auth.getMfaState(user.id) : null;
    if (!user || !state?.secret || !mfaKey) {
      mfaChallenges.delete(parsed.data.challenge);
      return c.json({ error: 'invalid_code' }, 400);
    }
    const secret = decryptSecret(state.secret, mfaKey);
    const verdict = verifyTotp(secret, parsed.data.code, at.getTime(),
      { lastUsedStep: state.lastUsedStep });
    let accepted = verdict.ok;
    if (accepted) {
      if (verdict.step != null) await auth.recordMfaStep(user.id, verdict.step);
    } else {
      accepted = await consumeRecoveryCode(user.id, parsed.data.code, at);
    }
    if (accepted) {
      mfaChallenges.delete(parsed.data.challenge);
      await issueSession(c, user.id);
      return c.json({ ok: true });
    }
    pending.attempts += 1;
    if (pending.attempts >= 5) mfaChallenges.delete(parsed.data.challenge);
    return c.json({ error: 'invalid_code' }, 400);
  });

  app.post('/auth/mfa/disable', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
    const parsed = mfaCodeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    const state = await auth.getMfaState(user.id);
    if (!state.secret) return c.json({ error: 'invalid_code' }, 400);
    const at = now();
    const verdict = verifyTotp(decryptSecret(state.secret, mfaKey), parsed.data.code, at.getTime(),
      { lastUsedStep: state.lastUsedStep });
    let accepted = verdict.ok;
    if (accepted) {
      if (verdict.step != null) await auth.recordMfaStep(user.id, verdict.step);
    } else {
      accepted = await consumeRecoveryCode(user.id, parsed.data.code, at);
    }
    if (!accepted) return c.json({ error: 'invalid_code' }, 400);
    await auth.disableMfa(user.id);
    await rotateSession(c, user.id);
    return c.json({ ok: true });
  });

  /** Opens a ten-minute window for sensitive actions; later steps use requireStepUp. */
  app.post('/auth/step-up', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const parsed = stepUpBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_credentials' }, 400);
    const at = now();
    const state = await auth.getMfaState(user.id);
    let accepted = false;
    if (state.secret) {
      if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
      if (parsed.data.code) {
        const verdict = verifyTotp(decryptSecret(state.secret, mfaKey), parsed.data.code, at.getTime(),
          { lastUsedStep: state.lastUsedStep });
        accepted = verdict.ok;
        if (accepted) {
          if (verdict.step != null) await auth.recordMfaStep(user.id, verdict.step);
        } else {
          accepted = await consumeRecoveryCode(user.id, parsed.data.code, at);
        }
      }
    } else if (parsed.data.password) {
      accepted = await verifyPassword(parsed.data.password, user.passwordHash);
    }
    if (!accepted) return c.json({ error: 'invalid_credentials' }, 400);
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'Sign in first.' }, 401);
    const until = new Date(at.getTime() + STEP_UP_MS);
    await auth.setSessionStepUp(hashSessionToken(token), until);
    return c.json({ ok: true, until: until.toISOString() });
  });

  // Password reset. The request step answers the same way whether or not the email has an account,
  // and takes at least RESET_MIN_MS so timing does not tell either. Tokens are random, stored hashed,
  // expire after RESET_TOKEN_TTL_SEC, work once, and a successful reset signs out every other session.
  const allowReset = durableLimiter(rateLimitStore, 'reset', 5, 60_000);
  const RESET_MIN_MS = 600;
  const resetRequestBody = z.object({ email: z.string().trim().email().max(254) });
  const resetConfirmBody = z.object({
    token: z.string().min(20).max(200),
    password: z.string().min(8, 'Use at least 8 characters.').max(72),
  });
  const RESET_ACCEPTED = 'If an account uses that email, a reset link is on its way. It expires in 30 minutes.';

  app.post('/auth/password-reset/request', async (c) => {
    if (!mailer.delivers || (process.env.NODE_ENV === 'production' && !auth.persistent))
      return c.json({ error: 'Password reset email is not connected on this deployment. No email was sent.' }, 503);
    if (!await allowReset(clientIp(c))) return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const started = Date.now();
    const parsed = resetRequestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter a valid email.' }, 400);
    const email = parsed.data.email.toLowerCase();
    try {
      const user = await auth.findByEmail(email);
      if (user) {
        const token = newSessionToken();
        await auth.saveResetToken(hashSessionToken(token), user.id, new Date(now().getTime() + RESET_TOKEN_TTL_SEC * 1000));
        const origin = appUrl || new URL(c.req.url).origin;
        const link = `${origin}/reset-password#token=${token}`;
        await mailer.send(passwordResetEmail(user.email, user.displayName, link, RESET_TOKEN_TTL_SEC / 60));
      }
    } catch (e) {
      console.error('[auth] password reset request failed:', (e as Error).message);
    }
    const wait = RESET_MIN_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return c.json({ ok: true, message: RESET_ACCEPTED }, 202);
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    if (!await allowReset(clientIp(c))) return c.json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    const parsed = resetConfirmBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      if (field === 'password') return c.json({ error: 'Use at least 8 characters.' }, 400);
      return c.json({ error: 'This reset link is invalid or has expired. Ask for a new one.' }, 400);
    }
    if (await breachedPassword(parsed.data.password))
      return c.json({ error: 'breached_password' }, 400);
    const userId = await auth.completeReset(hashSessionToken(parsed.data.token), now(), await hashPassword(parsed.data.password));
    if (!userId) return c.json({ error: 'This reset link is invalid or has expired. Ask for a new one.' }, 400);
    await issueSession(c, userId);
    return c.json({ ok: true });
  });

  app.get('/accounts', async (c) => {
    const id = c.req.query('id');
    const limit = Number(c.req.query('limit') ?? '30');
    if (id) {
      const denied = await walletAccessError(c, id);
      if (denied) return denied;
      await ensurePracticeDemoSeeded(id);
      return respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, id, Math.min(limit, 100), now, tzOffsetFrom(c)));
    }
    const owner = c.req.query('owner');
    if (!owner) return c.json({ error: 'owner is required' }, 400);
    const denied = await ownerAccessError(c, owner);
    if (denied) return denied;
    const accounts = await deps.ledger.accountsByOwner(owner);
    return c.json(accounts.map((a) => ({ id: a.id, owner: a.ownerId })));
  });

  app.post('/accounts', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    if (process.env.NODE_ENV === 'production' || (deps.isLiveLedgerUp && await deps.isLiveLedgerUp())) {
      return c.json({ error: 'Create a wallet through account registration.' }, 403);
    }
    const parsed = openAccountBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const account = await deps.ledger.openAccount(parsed.data.ownerId, parsed.data.currency);
    return c.json({ id: account.id, owner: account.ownerId }, 201);
  });

  app.get('/peers', async (c) => {
    const accountId = c.req.query('accountId');
    if (!accountId || !z.string().uuid().safeParse(accountId).success) {
      return c.json({ error: 'accountId is required' }, 400);
    }
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const peers = await listPeers(deps.ledger, accountId);
    return c.json(peers);
  });

  app.get('/peer-ledger', async (c) => {
    const accountId = c.req.query('accountId');
    const peerId = c.req.query('peerId');
    if (!accountId || !peerId || !z.string().uuid().safeParse(accountId).success || !z.string().uuid().safeParse(peerId).success) {
      return c.json({ error: 'accountId and peerId are required' }, 400);
    }
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const days = Math.min(Number(c.req.query('days') ?? '30'), 365);
    const view = await peerLedgerView(deps.ledger, accountId, peerId, days, 40);
    return view ? c.json(view) : c.json({ error: 'Peer not found' }, 404);
  });

  app.post('/accounts/:id/deposits', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = depositBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const id = c.req.param('id');
    const key = c.req.header('Idempotency-Key') ?? randomUUID();
    try {
      const transfer = await deps.ledger.deposit(id, parsed.data.amountMinor, key);
      return c.json(transfer, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/transfers', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = transferBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const denied = await walletAccessError(c, parsed.data.sourceAccountId);
    if (denied) return denied;
    const key = c.req.header('Idempotency-Key') ?? randomUUID();
    try {
      const transfer = await deps.ledger.transfer(parsed.data, key);
      return c.json(transfer, 201);
    } catch (e) {
      if (e instanceof LedgerError) return c.json({ error: e.message }, e.status === 404 ? 404 : 400);
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Adds names and display amounts so the UI never has to look accounts up one by one. */
  async function requestView(r: PaymentRequest) {
    const [requester, payer] = await Promise.all([
      deps.ledger.getAccount(r.requesterAccountId),
      deps.ledger.getAccount(r.payerAccountId),
    ]);
    return {
      ...r,
      amount: formatMoney(r.amountMinor, r.currency),
      requester: { id: r.requesterAccountId, owner: requester?.ownerId ?? 'unknown' },
      payer: { id: r.payerAccountId, owner: payer?.ownerId ?? 'unknown' },
    };
  }

  app.post('/requests', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const { requesterAccountId, payers, memo } = parsed.data;
    const denied = await walletAccessError(c, requesterAccountId);
    if (denied) return denied;
    if (deps.javaWorkflows && !deps.ledger.isPracticeAccount(requesterAccountId)) {
      const key = c.req.header('Idempotency-Key') ?? randomUUID();
      const result = await deps.javaWorkflows.split(parsed.data, key);
      return c.json({ requests: await Promise.all(result.requests.map(requestView)) }, 201);
    }
    const requester = await deps.ledger.getAccount(requesterAccountId);
    if (!requester || requester.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const ids = payers.map((p) => p.accountId);
    if (new Set(ids).size !== ids.length) return c.json({ error: 'Each person can be asked once per request' }, 400);
    if (ids.includes(requesterAccountId)) return c.json({ error: 'You cannot ask yourself for money' }, 400);
    for (const p of payers) {
      const payer = await deps.ledger.getAccount(p.accountId);
      if (!payer || payer.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
      if (payer.currency !== requester.currency) return c.json({ error: 'Currencies do not match' }, 400);
    }
    const created = [];
    for (const p of payers) {
      created.push(await requestView(await paymentRequests.create({
        requesterAccountId,
        payerAccountId: p.accountId,
        amountMinor: p.amountMinor,
        currency: requester.currency,
        memo: memo ?? null,
      }, now())));
    }
    return c.json({ requests: created }, 201);
  });

  /**
   * The offline practice household starts with a few open requests so the screen is never empty.
   * The ids are fixed (not random) because Vercel spreads the list and the pay/decline call across
   * instances: with a deterministic key, any instance can seed on demand and then resolve the row.
   */
  let practiceSeeded: Promise<void> | null = null;
  function seedPracticeRequests(): Promise<void> {
    practiceSeeded ??= (async () => {
      const seeds = [
        { id: PRACTICE_REQUEST_GROCERIES, requester: PRACTICE_SAM, payer: PRACTICE_ANTHONY, amountMinor: 1_850, memo: 'Groceries run' },
        { id: PRACTICE_REQUEST_UTILITIES, requester: PRACTICE_JORDAN, payer: PRACTICE_ANTHONY, amountMinor: 6_000, memo: 'Utilities share' },
        { id: PRACTICE_REQUEST_PARKING, requester: PRACTICE_ANTHONY, payer: PRACTICE_SAM, amountMinor: 3_500, memo: 'Concert parking' },
      ];
      for (const seed of seeds) {
        /* Idempotent per instance: a row that is already here may be PAID or DECLINED, so
           leave it alone instead of recreating it as PENDING. */
        if (await paymentRequests.get(seed.id)) continue;
        await paymentRequests.create({
          id: seed.id,
          requesterAccountId: seed.requester,
          payerAccountId: seed.payer,
          amountMinor: seed.amountMinor,
          currency: 'USD',
          memo: seed.memo,
        }, now());
      }
    })().catch((error: unknown) => {
      practiceSeeded = null;
      throw error;
    });
    return practiceSeeded;
  }

  /** Seeded demo rows are the only practice requests that resolve idempotently. */
  function isSeedPracticeRequest(id: string): boolean {
    return PRACTICE_REQUEST_IDS.has(id);
  }

  app.get('/requests', async (c) => {
    const accountId = c.req.query('accountId');
    if (!accountId || !z.string().uuid().safeParse(accountId).success) {
      return c.json({ error: 'accountId is required' }, 400);
    }
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    if (deps.ledger.isPracticeAccount(accountId)) await seedPracticeRequests();
    const rows = deps.javaWorkflows && !deps.ledger.isPracticeAccount(accountId)
      ? await deps.javaWorkflows.list(accountId) : await paymentRequests.listFor(accountId, 60);
    const views = await Promise.all(rows.map(requestView));
    return c.json({
      incoming: views.filter((r) => r.payerAccountId === accountId),
      outgoing: views.filter((r) => r.requesterAccountId === accountId),
    });
  });

  /**
   * Pays a request from the payer's wallet. The idempotency key comes from the request itself,
   * so a double click, a retry after a timeout, or two open tabs move the money once.
   */
  async function findRequest(id: string) {
    return await paymentRequests.get(id) ?? await deps.javaWorkflows?.get(id) ?? null;
  }

  app.post('/requests/:id/pay', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestActorBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    /* Another instance may own the write: seed the fixed demo rows here first so the id resolves. */
    if (isSeedPracticeRequest(c.req.param('id')) || deps.ledger.isPracticeAccount(parsed.data.accountId)) {
      await seedPracticeRequests();
    }
    const request = await findRequest(c.req.param('id'));
    if (!request) return c.json({ error: 'Request not found' }, 404);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    if (request.payerAccountId !== parsed.data.accountId) return c.json({ error: 'Only the person asked can pay this' }, 403);
    if (deps.javaWorkflows && !deps.ledger.isPracticeAccount(request.payerAccountId)) {
      const result = await deps.javaWorkflows.pay(request.id, parsed.data.accountId,
        c.req.header('Idempotency-Key') ?? `request-${request.id}-${request.declinedAttempts}`);
      return c.json({ request: await requestView(result.request), transfer: {
        id: result.transfer.id, status: result.transfer.status, rejectionReason: result.transfer.rejectionReason,
        declineExplanation: explainDecline(result.transfer.rejectionReason),
      } });
    }
    if (request.status !== 'PENDING' && request.status !== 'PAID') {
      return c.json({ error: `This request was ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
    }
    /* A repeated tap on a demo request is a no-op, not a second transfer. */
    if (request.status === 'PAID' && isSeedPracticeRequest(request.id)) {
      return c.json({ request: await requestView(request) });
    }
    const transfer = await deps.ledger.transfer({
      sourceAccountId: request.payerAccountId,
      destinationAccountId: request.requesterAccountId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      memo: request.memo ?? 'Payment request',
    }, `request-${request.id}-${request.declinedAttempts}`);
    const summary = {
      id: transfer.id,
      status: transfer.status,
      rejectionReason: transfer.rejectionReason,
      declineExplanation: explainDecline(transfer.rejectionReason),
    };
    if (transfer.status === 'REJECTED') {
      await paymentRequests.noteDecline(request.id);
      return c.json({ request: await requestView((await paymentRequests.get(request.id)) ?? request), transfer: summary });
    }
    const resolved = await paymentRequests.resolve(request.id, 'PAID', transfer.id, now());
    const current = resolved ?? (await paymentRequests.get(request.id)) ?? request;
    return c.json({ request: await requestView(current), transfer: summary });
  });

  for (const [action, status, who] of [
    ['decline', 'DECLINED', 'payerAccountId'],
    ['cancel', 'CANCELLED', 'requesterAccountId'],
  ] as const) {
    app.post(`/requests/:id/${action}`, async (c) => {
      if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
      const parsed = requestActorBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
      if (isSeedPracticeRequest(c.req.param('id')) || deps.ledger.isPracticeAccount(parsed.data.accountId)) {
        await seedPracticeRequests();
      }
      const request = await findRequest(c.req.param('id'));
      if (!request) return c.json({ error: 'Request not found' }, 404);
      const denied = await walletAccessError(c, parsed.data.accountId);
      if (denied) return denied;
      if (request[who] !== parsed.data.accountId) {
        return c.json({ error: action === 'decline' ? 'Only the person asked can decline' : 'Only the person who asked can cancel' }, 403);
      }
      if (deps.javaWorkflows && !deps.ledger.isPracticeAccount(parsed.data.accountId)) {
        const result = await deps.javaWorkflows.resolve(request.id, action, parsed.data.accountId);
        return c.json({ request: await requestView(result.request) });
      }
      /* A repeated tap on a demo request is a no-op, not a 409. */
      if (request.status === status && isSeedPracticeRequest(request.id)) {
        return c.json({ request: await requestView(request) });
      }
      const resolved = await paymentRequests.resolve(request.id, status, null, now());
      if (!resolved) return c.json({ error: `This request was already ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
      return c.json({ request: await requestView(resolved) });
    });
  }

  /**
   * The wedge: settle a request over any rail. The requester confirms the money
   * arrived outside the app (Zelle, Cash App, cash, crypto…), the request closes,
   * and the book keeps the rail on the receipt. No bank integration required.
   */
  app.post('/requests/:id/settle', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestSettleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    if (isSeedPracticeRequest(c.req.param('id')) || deps.ledger.isPracticeAccount(parsed.data.accountId)) {
      await seedPracticeRequests();
    }
    const request = await findRequest(c.req.param('id'));
    if (!request) return c.json({ error: 'Request not found' }, 404);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    if (request.requesterAccountId !== parsed.data.accountId) {
      return c.json({ error: 'Only the person who asked can record an outside settlement' }, 403);
    }
    const settledVia = parsed.data.settledVia as SettleRail;
    if (deps.javaWorkflows && !deps.ledger.isPracticeAccount(parsed.data.accountId)) {
      const result = await deps.javaWorkflows.resolve(request.id, 'settle', parsed.data.accountId, settledVia);
      return c.json({ request: await requestView(result.request) });
    }
    /* Recording the same rail twice on a demo row returns the settled row, not a 409. */
    if (request.status === 'PAID' && isSeedPracticeRequest(request.id)) {
      return c.json({ request: await requestView(request) });
    }
    const resolved = await paymentRequests.resolve(request.id, 'PAID', null, now(), settledVia);
    if (!resolved) return c.json({ error: `This request was already ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
    return c.json({ request: await requestView(resolved) });
  });

  app.get('/transfers/:id/receipt', async (c) => {
    const parsed = z.object({ id: z.string().uuid(), accountId: z.string().uuid() }).safeParse({
      id: c.req.param('id'), accountId: c.req.query('accountId'),
    });
    if (!parsed.success) return c.json({ error: 'Provide a transfer id and your accountId' }, 400);
    const { id, accountId } = parsed.data;
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const transfer = await deps.ledger.getTransfer(id);
    if (!transfer) return c.json({ error: 'Transfer not found' }, 404);
    if (transfer.sourceAccountId !== accountId && transfer.destinationAccountId !== accountId)
      return c.json({ error: 'This receipt belongs to another wallet' }, 403);
    if (!deps.javaWorkflows || deps.ledger.isPracticeAccount(accountId))
      return c.json({ error: 'Chain receipts are available for live ledger transfers only' }, 404);
    return c.json(await deps.javaWorkflows.receipt(id));
  });

  // Direct links. The UI uses ?id= so a host that 404s a second path segment still reaches this app.
  app.get('/accounts/:id', async (c) => {
    const id = c.req.param('id');
    await ensurePracticeDemoSeeded(id);
    return respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, id, 30, now, tzOffsetFrom(c)));
  });

  app.post('/accounts/:id/spends/import', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = z.object({ csv: z.string().min(1).max(1_000_000), timeZone: z.string().min(1).max(64).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Provide an expense CSV up to 1 MB' }, 400);
    const id = c.req.param('id');
    if (!deps.javaWorkflows || deps.ledger.isPracticeAccount(id))
      return c.json({ error: 'CSV import is available for connected wallets. This wallet is in practice mode.' }, 409);
    return c.json(await deps.javaWorkflows.importSpends(id, parsed.data.csv, parsed.data.timeZone));
  });

  app.post('/accounts/:id/spends', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = recordSpendBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const event = await deps.spendLogs.record(accountId, {
      ...parsed.data,
      currency: account.currency,
      source: 'manual',
    }, now(), c.req.header('Idempotency-Key'));
    return c.json({
      id: event.id,
      amountMinor: event.amountMinor,
      category: event.category,
      note: event.note,
      occurredAt: event.occurredAt,
    }, 201);
  });

  app.delete('/accounts/:id/spends/:spendId', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    const spendId = c.req.param('spendId');
    if (!z.string().uuid().safeParse(accountId).success || !z.string().uuid().safeParse(spendId).success) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const removed = await deps.spendLogs.remove(accountId, spendId);
    if (!removed) return c.json({ error: 'That log was already removed' }, 404);
    return c.json({ removed: true });
  });

  app.get('/accounts/:id/habits', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    await ensurePracticeDemoSeeded(accountId);
    const profile = await personalFinance.getProfile(accountId, account.currency, now());
    return c.json(await buildHabitsHome(deps.spendLogs, accountId, now(), account.currency, profile.periodStart));
  });

  app.patch('/accounts/:id/finance', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = financePatchBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const { rebaseCash, ...patch } = parsed.data;
    if (rebaseCash && patch.walletCashMinor == null) return c.json({ error: 'Set a cash amount to start a new snapshot.' }, 400);
    const profile = await personalFinance.updateProfile(accountId, account.currency,
      { ...patch, ...(rebaseCash ? { periodStart: now().toISOString() } : {}) }, now());
    const spends = await deps.spendLogs.list(accountId, { limit: 500 });
    const incomes = await personalFinance.listIncome(accountId, { limit: 500 });
    const finance = buildFinanceSnapshot(profile, formatMoney(account.balanceMinor, account.currency), spends, incomes);
    return c.json({ profile, finance });
  });

  app.post('/accounts/:id/finance/rollover', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const profile = await personalFinance.startNewPeriod(accountId, account.currency, now());
    const spends = await deps.spendLogs.list(accountId, { limit: 500 });
    const incomes = await personalFinance.listIncome(accountId, { limit: 500 });
    const finance = buildFinanceSnapshot(profile, formatMoney(account.balanceMinor, account.currency), spends, incomes);
    return c.json({ profile, finance, message: 'New period started. Older logs stay in ACTIVITY; totals below are from now.' });
  });

  app.post('/accounts/:id/incomes', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = recordIncomeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const event = await personalFinance.recordIncome(accountId, {
      ...parsed.data,
      currency: account.currency,
    }, now());
    return c.json({
      id: event.id,
      amountMinor: event.amountMinor,
      source: event.source,
      note: event.note,
      occurredAt: event.occurredAt,
    }, 201);
  });

  app.get('/accounts/:id/entries', async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'Invalid account id' }, 400);
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
    const account = await deps.ledger.getAccount(id);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const entries = await deps.ledger.entries(id, limit);
    return c.json({ accountId: id, currency: account.currency, entries });
  });

  app.get('/accounts/:id/statement.txt', async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) return c.text('Invalid account id', 400);
    const view = await accountView(deps.ledger, deps.spendLogs, personalFinance, id, 100, now, tzOffsetFrom(c));
    if (!view) return c.text('Account not found', 404);
    const entries = await deps.ledger.entries(id, 200);
    const body = formatLedgerStatement(view, entries, {
      generatedAt: new Date().toISOString(),
      engine: deps.isLiveLedgerUp && (await deps.isLiveLedgerUp()) ? 'ledger-service (PostgreSQL)' : 'practice mirror',
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="statement-${id.slice(0, 8)}.txt"`,
      },
    });
  });

  /**
   * Live-ledger seed for the /ops console only. Do NOT use this for the
   * consumer "Preview a sample household" button: it creates real accounts
   * in PostgreSQL, and those unsigned accounts are rejected (401) by the
   * wallet-ownership check on every later read. The consumer preview uses
   * POST /demo/practice instead (see Welcome.tsx).
   */
  app.post('/demo', async (c) => {
    if (!await allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const live = deps.isLiveLedgerUp ? await deps.isLiveLedgerUp() : false;
    if (!live || !deps.liveLedger) {
      return c.json({
        error: 'The live ledger is not running. Use the guided practice demo below — it works without Docker.',
      }, 503);
    }
    const seeded = await seedDemo(deps.liveLedger);
    const personas: DemoPersona[] = ['anthony', 'sam', 'jordan'];
    await Promise.all(seeded.accounts.map((account, i) =>
      seedDemoHabits(deps.spendLogs, personalFinance, account.id, personas[i] ?? 'anthony', now())));
    const [anthony, sam, jordan] = seeded.accounts;
    if (anthony && sam && jordan) {
      const ask = (requester: string, payer: string, amountMinor: number, memo: string) =>
        paymentRequests.create({ requesterAccountId: requester, payerAccountId: payer, amountMinor, currency: 'USD', memo }, now());
      await ask(sam.id, anthony.id, 1_850, 'Groceries run');
      await ask(jordan.id, anthony.id, 6_000, 'Utilities share');
      await ask(anthony.id, sam.id, 3_500, 'Concert parking');
    }
    return c.json(seeded);
  });

  /** Guided demo in practice mode: the fixed household plus a personal history to explore. */
  app.post('/demo/practice', async (c) => {
    if (!await allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const boot = deps.practice.bootstrap();
    await Promise.all([
      ensurePracticeDemoSeeded(PRACTICE_ANTHONY),
      ensurePracticeDemoSeeded(PRACTICE_SAM),
      ensurePracticeDemoSeeded(PRACTICE_JORDAN),
    ]);
    return c.json({
      accounts: boot.accounts.map(({ id, owner }) => ({ id, owner })),
      focusAccountId: boot.focusAccountId,
      seeded: true,
    });
  });

  app.get('/bank/status', (c) => c.json(bankSimulatorStatus()));

  const bankBody = z.object({ accountId: z.string().uuid() });

  app.post('/bank/welcome', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await welcomeBankPackage(deps.ledger, parsed.data.accountId, 500_00));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/bank/inbound', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await simulateInboundCorridor(deps.ledger, parsed.data.accountId));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/bank/outbound', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await simulateOutboundCorridor(deps.ledger, parsed.data.accountId));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get('/trail', async (c) => {
    const parsed = paymentBody.safeParse({ accountId: c.req.query('account'), transferId: c.req.query('transfer') });
    if (!parsed.success) return c.json({ error: 'Payment not found' }, 404);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const trail = await paymentTrail(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    return trail ? c.json(trail) : c.json({ error: 'Payment not found' }, 404);
  });

  app.get('/integrity', async (c) => {
    try {
      return c.json(await booksCheck(deps.ledger));
    } catch (e) {
      if (e instanceof LedgerError && e.status === 404) {
        return c.json({ error: 'Reconciliation is not on the deployed ledger build yet.', code: 'LEDGER_OUTDATED' }, 503);
      }
      throw e;
    }
  });

  app.post('/replay', async (c) => {
    if (!await allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = paymentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const result = await replayPayment(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    return result ? c.json(result) : c.json({ error: 'Payment not found' }, 404);
  });

  app.post('/race', async (c) => {
    if (!await allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = raceBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const denied = await walletAccessError(c, parsed.data.fromAccountId);
    if (denied) return denied;
    const result = await racePayment(deps.ledger, parsed.data.accountId, parsed.data.fromAccountId);
    if (!result) return c.json({ error: 'Account not found' }, 404);
    return 'error' in result ? c.json(result, 400) : c.json(result);
  });

  app.post('/tamper', async (c) => {
    if (!await allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = paymentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const denied = await walletAccessError(c, parsed.data.accountId);
    if (denied) return denied;
    const result = await tamperWithPayment(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    if (!result) return c.json({ error: 'Payment not found' }, 404);
    return 'error' in result ? c.json(result, 400) : c.json(result);
  });

  /**
   * The LLM route. Anti-flooding is layered, cheapest first:
   *   1. sliding-window IP limit (below) — rejects a burst before any work runs;
   *   2. `trimHistory` — caps what is even treated as context;
   *   3. `LlmGuard` — cache hit → shared in-flight → daily budget → provider;
   *   4. `answerFromLedger` — deterministic answers once the budget/quota is gone,
   *      so the person still gets a correct answer with zero model calls.
   * A rejected request carries `Retry-After` so clients back off politely instead
   * of retrying in a hot loop.
   */
  app.post('/chat', async (c) => {
    const verdict = await allowChat.check(clientIp(c));
    if (!verdict.allowed) {
      return c.json(
        { error: 'Too many requests, slow down a little.', retryAfterMs: verdict.retryAfterMs },
        429,
        { 'Retry-After': retryAfterSeconds({ ...verdict, remaining: 0 }) },
      );
    }
    const parsed = chatBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const { accountId, messages: rawMessages } = parsed.data;
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const deadlineAt = Date.now() + 50_000;

    // Only the newest turns go to the model; old history is cost without value.
    const messages = trimHistory(rawMessages);
    const question = messages.at(-1)?.text ?? '';

    const chatFinance = async (): Promise<WeeklyFinance> => {
      const [profile, spends, incomes] = await Promise.all([
        personalFinance.getProfile(accountId, account.currency, now()),
        deps.spendLogs.list(accountId, { limit: 500 }),
        personalFinance.listIncome(accountId, { limit: 500 }),
      ]);
      const snapshot = buildFinanceSnapshot(profile, formatMoney(account.balanceMinor, account.currency), spends, incomes);
      // Match snapshot.projectedCash, including its income and spend-log rules.
      // No entered cash means unknown. The P2P balance settles up with friends; it is not the user's cash.
      const spendableMinor = profile.walletCashMinor === null ? null
        : profile.walletCashMinor + snapshot.periodTotals.incomeMinor
          - (profile.spendLogsAffectWallet ? snapshot.periodTotals.spendMinor : 0);
      return {
        spendableMinor,
        budgetMinor: profile.weeklyBudgetMinor,
        spentMinor: buildSpendingPatterns(spends, [], now(), profile).week.spentMinor,
      };
    };

    /** Deterministic ledger answers — used on config errors, budget exhaustion and model failures. */
    const degrade = async (reason: string): Promise<AssistantReply> => ({
      ...(await answerFromLedger({
        ledger: deps.ledger,
        spendLogs: deps.spendLogs,
        accountId,
        question,
        now,
        finance: chatFinance,
      })),
      route: 'ledger-fallback',
      fallbackReason: reason,
    });

    let provider: LlmProvider;
    try {
      provider = deps.provider ? deps.provider() : providerFromEnv();
    } catch (e) {
      console.error(e);
      return c.json(await degrade(llmConfigError(e)));
    }

    try {
      // Cache → shared in-flight → budgeted fresh call. Same question, one Gemini call.
      const { reply, cache } = await llmGuard.answer({
        accountId,
        messages,
        produce: async () => {
          const peers = await listPeers(deps.ledger, accountId);
          return runAssistant({ provider, ledger: deps.ledger, spendLogs: deps.spendLogs, accountId, messages, peers, now, finance: chatFinance, deadlineAt });
        },
        degrade,
      });
      return c.json({ ...reply, cached: cache === 'hit' || cache === 'shared' ? true : undefined });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const errStatus = (e as { status?: number }).status;
      console.error('chat LLM error', errStatus, errMsg.slice(0, 500));
      // Never 500 the UI for model/config errors — ledger tools still answer.
      return c.json(await degrade(`LLM call failed (${errStatus ?? 'no status'}): ${errMsg.slice(0, 220)}`));
    }
  });

  app.onError((err, c) => {
    if (err instanceof LedgerError) {
      if ([502, 503, 504].includes(err.status))
        return c.json({ error: 'The ledger is waking up. Try again in a moment.' }, 503);
      const status = ([400, 401, 403, 404, 409, 422, 429, 503].includes(err.status) ? err.status
        : [502, 504].includes(err.status) ? 503 : 502) as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503;
      return c.json({ error: err.message }, status);
    }
    console.error(err);
    if ((err as { status?: number }).status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(err.message)) {
      return c.json({ error: 'The assistant is busy right now. Try again in a moment.' }, 429);
    }
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  });

  return app;
}

let warnedDevMfaKey = false;

/** Resolves the AES key for TOTP secrets; null means MFA setup is unavailable. */
function resolveMfaKey(injected?: Buffer): Buffer | null {
  if (injected) {
    if (injected.length !== 32) throw new Error('mfaKey must be 32 bytes');
    return injected;
  }
  const configured = (process.env.MFA_ENCRYPTION_KEY ?? '').trim();
  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes');
    return key;
  }
  if (process.env.NODE_ENV === 'production') return null;
  if (!warnedDevMfaKey) {
    warnedDevMfaKey = true;
    console.warn('[mfa] MFA_ENCRYPTION_KEY is not set; using a development-only key.');
  }
  return devMfaKey();
}

function tzOffsetFrom(c: { req: { query(name: string): string | undefined } }): number {
  const raw = Number(c.req.query('tzOffset') ?? '0');
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(raw)));
}

async function accountView(
  ledger: LedgerReader,
  spendLogs: SpendLogStore,
  personalFinance: PersonalFinanceStore,
  id: string,
  limit = 30,
  now: () => Date,
  tzOffsetMinutes = 0,
) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const base = await loadAccountView(ledger, id, limit, now());
  if (!base) return null;
  const profile = await personalFinance.getProfile(id, base.currency, now());
  const allSpends = await spendLogs.list(id, { limit: 500 });
  const allIncomes = await personalFinance.listIncome(id, { limit: 500 });
  const habits = buildHabitsFromEntries(allSpends, now(), base.currency, profile.periodStart);
  const spends = allSpends.slice(0, 80);
  const incomes = allIncomes.slice(0, 80);
  const patterns = buildSpendingPatterns(allSpends, allIncomes, now(), profile, tzOffsetMinutes);
  const activityFeed = buildActivityFeed(
    base.transfers,
    spends,
    (minor, currency) => formatMoney(minor, currency),
    incomes,
  );
  const finance = buildFinanceSnapshot(profile, base.balance, allSpends, allIncomes);
  const insights = buildPersonalInsights(base.balance, base.summary, habits, finance);
  return {
    ...base,
    habits,
    patterns,
    finance,
    moneyProfile: profile,
    activityFeed,
    insights,
    spendEntries: spends.map((s) => ({
      id: s.id,
      amount: formatMoney(s.amountMinor, s.currency),
      amountMinor: s.amountMinor,
      category: s.category,
      note: s.note,
      occurredAt: s.occurredAt,
    })),
  };
}

async function listPeers(ledger: CompositeLedger, accountId: string) {
  if (ledger.isPracticeAccount(accountId)) {
    return ledger.practicePeers(accountId);
  }
  const recent = await ledger.transfersForAccount(accountId, 200);
  const ids = new Set<string>();
  for (const t of recent) {
    const other = t.sourceAccountId === accountId ? t.destinationAccountId : t.sourceAccountId;
    ids.add(other);
  }
  const peers: { id: string; owner: string }[] = [];
  for (const id of ids) {
    const a = await ledger.getAccount(id);
    if (a && a.type === 'USER' && id !== accountId) peers.push({ id, owner: a.ownerId });
  }
  return peers.sort((a, b) => a.owner.localeCompare(b.owner));
}

function respondAccount(c: { json: (body: unknown, status?: number) => Response }, view: Awaited<ReturnType<typeof loadAccountView>>) {
  if (!view) return c.json({ error: 'Account not found' }, 404);
  return c.json(view);
}

function llmConfigError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/GEMINI_API_KEY is not set/i.test(message)) {
    return 'GEMINI_API_KEY is not set. Add GEMINI_API_KEY or OPENROUTER_API_KEY on Vercel (assistant/.env locally), redeploy, then refresh.';
  }
  if (/OPENROUTER_API_KEY is not set/i.test(message)) {
    return 'OPENROUTER_API_KEY is not set. Get a key at openrouter.ai/keys or use GEMINI_API_KEY with LLM_PROVIDER=gemini.';
  }
  if (/ANTHROPIC_API_KEY is not set/i.test(message)) {
    return 'ANTHROPIC_API_KEY is not set on the assistant server.';
  }
  return message;
}
