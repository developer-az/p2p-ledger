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
import { PRACTICE_ACCOUNT_IDS, PRACTICE_ANTHONY, PRACTICE_JORDAN, PRACTICE_SAM, runInPracticeScope, type CompositeLedger, type PracticeLedger } from './practice-ledger.js';
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
import { buildHabitsFromEntries, buildHabitsHome, SPEND_CATEGORIES, type SpendLogEntry, type SpendLogStore } from './spend-log.js';
import { buildSpendingPatterns } from './spending-patterns.js';
import { buildCashForecast, buildMonthlyReport, buildRiskAlerts, normalizeTransactions, reportCsv } from './risk.js';
import { InMemoryAlertDismissalStore, type AlertDismissalStore } from './alert-store.js';
import { buildSubscriptionReport } from './subscriptions.js';
import {
  InMemorySubscriptionTrackerStore,
  type SubscriptionTrackerStore,
} from './subscription-tracker.js';
import {
  buildFinanceSnapshot,
  INCOME_SOURCES,
  InMemoryPersonalFinanceStore,
  type IncomeLogEntry,
  type PersonalFinanceStore,
} from './personal-finance.js';
import { formatMoney } from './money.js';
import {
  applyCascade,
  type UserRule,
} from './enrichment/categorize.js';
import {
  applyRuleRetroactively,
  enrichedSpendRow,
  enrichSpendDraft,
  normalizeSpend,
  previewRuleForAccount,
  recordMerchantCorrection,
} from './enrichment/service.js';
import {
  createEnrichmentStore,
  InMemoryEnrichmentStore,
  type EnrichmentStore,
} from './enrichment/store.js';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import type { DataKeyStore } from './envelope.js';
import { ImportParseError, type ImportColumnMapping } from './importers.js';
import { InMemoryImportStore, type ImportStore } from './imports-store.js';
import { runImport } from './imports-pipeline.js';
import { importedTransactionsToSpendEntries, normalizeTransactionList } from './normalized-transactions.js';
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
import { requireStepUp } from './step-up.js';
import {
  WebAuthnError,
  readClientDataChallenge,
  readCredentialId,
  verifyAssertion,
  verifyRegistration,
} from './webauthn.js';
import { CSV_HEADER_ROW, csvExportRow } from './data-export.js';
import { isBreachedPassword } from './breached-password.js';
import { LoginThrottle } from './login-throttle.js';
import { createSecurityStateStore, type ChallengePurpose, type SecurityStateStore } from './security-state.js';
import { retryAfterSeconds } from './rate-limit.js';
import { InMemoryRateLimitStore, durableLimiter, type RateLimitStore } from './rate-limit-store.js';
import { SETTLE_RAILS, type SettleRail } from './payment-requests.js';
import {
  EmailTakenError,
  InMemoryAuthStore,
  PasskeyExistsError,
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
  type AuditInput,
  type AuditType,
  type AuthStore,
  type PasskeyRecord,
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
  passkey: z.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    'invalid passkey credential',
  ).optional(),
});
const passkeyCredential = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'invalid passkey credential',
);
const passkeyRegisterBody = z.object({
  credential: passkeyCredential,
  name: z.string().trim().min(1).max(40).optional(),
});
const passkeyLoginBody = z.object({ credential: passkeyCredential });
const deleteAccountBody = z.object({ confirm: z.literal('DELETE') });

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
  // Optional: a bare descriptor lets the cascade pick the category.
  category: z.enum(SPEND_CATEGORIES).optional(),
  note: z.string().max(140).optional(),
  /** Raw statement text when the person has no note of their own. */
  descriptor: z.string().max(200).optional(),
  occurredAt: z.string().datetime().optional(),
});

const ruleDraftBody = z.object({
  merchantContains: z.string().trim().min(1).max(80),
  maxAmountMinor: z.number().int().positive().max(MAX_MINOR_UI).nullable().optional(),
  category: z.enum(SPEND_CATEGORIES),
});

const merchantCorrectionBody = z.object({
  transactionId: z.string().min(1).max(100),
  merchantName: z.string().trim().min(1).max(80),
  category: z.enum(SPEND_CATEGORIES).optional(),
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

/** M3 import upload limits: 2 MB is enough for years of CSV, and PDF is out. */
const IMPORT_MAX_CHARS = 2_000_000;
const importMappingBody = z.object({
  date: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(120),
  amount: z.string().max(120).nullable().optional(),
  debit: z.string().max(120).nullable().optional(),
  credit: z.string().max(120).nullable().optional(),
  balance: z.string().max(120).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  dateFormat: z.enum(['auto', 'YMD', 'MDY', 'DMY']).optional(),
  amountSign: z.enum(['as-is', 'invert']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});
const importUploadBody = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(5_000_000),
  mapping: importMappingBody.optional(),
  presetId: z.string().max(120).nullable().optional(),
  accountKind: z.enum(['checking', 'credit']).optional(),
  expectedRowCount: z.number().int().nonnegative().max(1_000_000).optional(),
  expectedOutflowMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  openingBalanceMinor: z.number().int().nullable().optional(),
});
const importPresetBody = z.object({
  name: z.string().trim().min(1).max(80),
  source: z.enum(['csv', 'ofx', 'qfx']),
  mapping: importMappingBody,
});
const importPreviewBody = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(5_000_000),
});

/**
 * Reject oversized bodies before parsing. Content-Length is only a hint: a
 * chunked upload has none, so the body is counted while it is read and the
 * request is abandoned as soon as it passes the limit.
 */
async function readImportBody(c: Context): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > IMPORT_MAX_CHARS) return { tooLarge: true };
  const body = c.req.raw.body;
  if (!body) return { tooLarge: false, value: null };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > IMPORT_MAX_CHARS) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { tooLarge: false, value: null };
  }
  try {
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return { tooLarge: false, value: JSON.parse(text) as unknown };
  } catch {
    return { tooLarge: false, value: null };
  }
}

/** Import detail lists every row for one import, paging by import id in the store. */
async function importTransactions(
  store: ImportStore,
  accountId: string,
  importId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Awaited<ReturnType<ImportStore['listTransactions']>>> {
  const all: Awaited<ReturnType<ImportStore['listTransactions']>> = [];
  const offset = Math.max(0, opts.offset ?? 0);
  const max = opts.limit;
  if (max !== undefined && max <= 0) return all;
  const pageSize = 1_000;
  for (let cursor = offset; ; cursor += pageSize) {
    const take = max === undefined ? pageSize : Math.min(pageSize, max - all.length);
    if (take <= 0) return all;
    const page = await store.listTransactions(accountId, { importId, limit: take, offset: cursor });
    all.push(...page);
    if (page.length < take) return all;
  }
}

/** How long /wake waits on the ledger before answering "still asleep". */
const WAKE_PROBE_TIMEOUT_MS = 9_000;

/** Sign-in second-factor challenge lifetime and the step-up window. */
const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const STEP_UP_MS = 10 * 60_000;
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Export page size. Each page is rendered as its own chunk so the response body
 * is a stream rather than one string holding every income and spend row.
 */
const EXPORT_PAGE_SIZE = 500;

/** Risk snapshots page the same way; each page is bounded so a large history cannot stall a request. */
const RISK_PAGE_SIZE = 500;
const FORECAST_LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * Cookie that names one visitor's private copy of the practice household.
 * Issued by POST /demo/practice; the value is opaque and only ever keys an
 * in-process copy, so a forged value buys a caller nothing but their own copy.
 */
const DEMO_SESSION_COOKIE = 'settle_practice';
const DEMO_SESSION_TTL_SEC = 12 * 60 * 60;
/** Bound per-instance demo copies so random cookies cannot grow memory without limit. */
const DEMO_COPY_LIMIT = 128;

/**
 * First row a risk snapshot needs: the selected month, its comparison month and
 * the forecast's discretionary lookback. The profile period start is added by
 * the caller because period totals are computed from the same rows.
 */
function riskWindowStart(at: Date, month?: string): Date {
  const fallback = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  const selected = month && /^\d{4}-\d{2}$/.test(month) ? month : fallback;
  const [yearText, monthText] = selected.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const comparisonMonthStart = Date.UTC(year, monthIndex - 1, 1);
  const forecastStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    - FORECAST_LOOKBACK_DAYS * DAY_MS;
  return new Date(Math.min(comparisonMonthStart, forecastStart));
}

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
  /** M3 imports. Tests inject memory; production builds Postgres when a DB URL is set. */
  imports?: ImportStore;
  /** Merchant aliases, rules and category corrections. Defaults to memory. */
  enrichment?: EnrichmentStore;
  /** Dismissed alert ids. Defaults to memory; production passes Postgres. */
  alertDismissals?: AlertDismissalStore;
  subscriptionMarks?: SubscriptionTrackerStore;
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
  /** Shared lockout and challenge rows. Defaults to Postgres when auth is Postgres. */
  securityState?: SecurityStateStore;
  /** 32-byte AES key that encrypts stored TOTP secrets. Defaults to MFA_ENCRYPTION_KEY. */
  mfaKey?: Buffer;
  /** Envelope-encryption keys. Account deletion shreds the user's data key first. */
  dataKeys?: DataKeyStore;
  now?: () => Date;
  /** HIBP password check. Tests inject a fake; VITEST defaults to no network. */
  breachedPassword?: (password: string) => Promise<boolean>;
}) {
  const now = deps.now ?? (() => new Date());
  const auth = deps.auth ?? new InMemoryAuthStore();
  /**
   * Production (or any deployment with a persistent identity store) publishes
   * the shared sample household to anonymous visitors. That fixture is
   * read-only there; the demo works on a private per-session copy instead.
   */
  const enforceWalletAuth = deps.enforceWalletAuth ?? (auth.persistent || process.env.NODE_ENV === 'production');
  const mfaKey = resolveMfaKey(deps.mfaKey);
  const personalFinance = deps.personalFinance ?? new InMemoryPersonalFinanceStore();
  const imports = deps.imports ?? new InMemoryImportStore();
  const enrichment = deps.enrichment ?? new InMemoryEnrichmentStore(now);
  const alertDismissals = deps.alertDismissals ?? new InMemoryAlertDismissalStore();
  const subscriptionMarks = deps.subscriptionMarks ?? new InMemorySubscriptionTrackerStore();
  const paymentRequests = deps.paymentRequests ?? new InMemoryPaymentRequestStore();
  /** Private practice copies, keyed by the demo session cookie. LRU-bounded. */
  const demoCopies = new Map<string, PracticeLedger>();
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
  /** Accounts whose stored demo history was checked in a non-enforced (dev/test) app. */
  const practiceSeedChecked = new Set<string>();
  /**
   * @param force re-check the stored history even if it was already checked;
   *   POST /demo/practice passes true so a demo start is never stale.
   */
  const ensurePracticeDemoSeeded = (accountId: string, force = false): Promise<void> => {
    const persona = PRACTICE_DEMO_PERSONAS[accountId];
    if (!persona) return Promise.resolve();
    /**
     * Writes from older builds (smoke runs, the public sample) could move a
     * shared practice balance. In production the shared fixture cannot be
     * written any more, so any drift is leftover state and is restored here
     * before a visitor reads it. Private demo copies are never touched.
     */
    if (enforceWalletAuth) deps.practice.restoreIfDrifted();
    /*
     * Production re-checks on every read: a demo session's spend/finance writes
     * still land in the shared stores, and the fixture must heal rather than
     * serve those numbers to the next visitor. Dev and tests keep the cheaper
     * once-per-instance check so a local practice wallet stays writable.
     */
    if (!force && !enforceWalletAuth && practiceSeedChecked.has(accountId)) return Promise.resolve();
    const inFlight = practiceSeedInFlight.get(accountId);
    if (inFlight) return inFlight;
    const seeding = seedDemoHabits(deps.spendLogs, personalFinance, accountId, persona, now())
      .then(() => {
        practiceSeedChecked.add(accountId);
        practiceSeedInFlight.delete(accountId);
      })
      .catch((e: unknown) => {
        practiceSeedInFlight.delete(accountId);
        throw e;
      });
    practiceSeedInFlight.set(accountId, seeding);
    return seeding;
  };

  /** Load every spend row at or after `since`, across keyset pages. */
  const listSpendsSince = async (accountId: string, since: Date): Promise<SpendLogEntry[]> => {
    const rows: SpendLogEntry[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await deps.spendLogs.listSpendCursorPage(accountId, cursor, RISK_PAGE_SIZE, since);
      rows.push(...page.rows);
      if (page.rows.length === 0 || page.next === null || page.next === cursor) break;
      cursor = page.next;
    }
    const sinceMs = since.getTime();
    return rows.filter((row) => {
      const at = Date.parse(row.occurredAt);
      return Number.isFinite(at) && at >= sinceMs;
    });
  };

  /** Load every income row at or after `since`, across id keyset pages. */
  const listIncomesSince = async (accountId: string, since: Date): Promise<IncomeLogEntry[]> => {
    const rows: IncomeLogEntry[] = [];
    let afterId: string | null = null;
    for (;;) {
      const page = await personalFinance.listIncomePage(accountId, afterId, RISK_PAGE_SIZE, since);
      rows.push(...page);
      const next = page[page.length - 1]?.id;
      if (page.length < RISK_PAGE_SIZE || !next || next === afterId) break;
      afterId = next;
    }
    const sinceMs = since.getTime();
    return rows.filter((row) => {
      const at = Date.parse(row.occurredAt);
      return Number.isFinite(at) && at >= sinceMs;
    });
  };

  /** Load the rows and settings every forecast, alert and report route needs. */
  const riskSnapshot = async (accountId: string, options: { month?: string } = {}) => {
    await ensurePracticeDemoSeeded(accountId);
    const account = await deps.ledger.getAccount(accountId);
    if (!account) return null;
    const at = now();
    const profile = await personalFinance.getProfile(accountId, account.currency, at);
    const periodStart = Date.parse(profile.periodStart);
    const windowStart = riskWindowStart(at, options.month).getTime();
    const since = new Date(Number.isFinite(periodStart) ? Math.min(periodStart, windowStart) : windowStart);
    const [spends, incomes] = await Promise.all([
      listSpendsSince(accountId, since),
      listIncomesSince(accountId, since),
    ]);
    const periodIncome = incomes
      .filter((row) => Date.parse(row.occurredAt) >= periodStart)
      .reduce((sum, row) => sum + row.amountMinor, 0);
    const periodSpend = spends
      .filter((row) => Date.parse(row.occurredAt) >= periodStart)
      .reduce((sum, row) => sum + row.amountMinor, 0);
    let currentBalanceMinor = account.balanceMinor;
    if (profile.walletCashMinor !== null) {
      currentBalanceMinor = profile.walletCashMinor + periodIncome;
      if (profile.spendLogsAffectWallet) currentBalanceMinor -= periodSpend;
    }
    return {
      account,
      at,
      profile,
      spends,
      incomes,
      patterns: buildSpendingPatterns(spends, incomes, at, profile, 0),
      transactions: normalizeTransactions(spends, incomes),
      currentBalanceMinor,
    };
  };
  const llmGuard = deps.llmGuard ?? new LlmGuard();
  const securityState = deps.securityState ?? createSecurityStateStore(auth);
  /** Issues a short-lived second-factor challenge in the shared state store. */
  const newMfaChallenge = async (userId: string): Promise<string> => {
    const challenge = randomBytes(32).toString('base64url');
    const at = now();
    await securityState.saveChallenge(challenge, userId,
      new Date(at.getTime() + MFA_CHALLENGE_TTL_MS), at, 'mfa');
    return challenge;
  };
  /** WebAuthn challenges are single-use and bound to a purpose and account. */
  const newPasskeyChallenge = async (userId: string | null, purpose: ChallengePurpose): Promise<string> => {
    const challenge = randomBytes(32).toString('base64url');
    const at = now();
    await securityState.saveChallenge(challenge, userId,
      new Date(at.getTime() + PASSKEY_CHALLENGE_TTL_MS), at, purpose);
    return challenge;
  };
  const appOrigin = (c: Context): string => appUrl
    ? new URL(appUrl).origin
    : new URL(c.req.url).origin;
  const rpIdFor = (c: Context): string => appUrl
    ? new URL(appUrl).hostname
    : new URL(c.req.url).hostname;
  const passkeySummary = (passkey: PasskeyRecord) => ({
    id: passkey.id,
    name: passkey.name,
    transports: passkey.transports,
    alg: passkey.alg,
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
  });
  /**
   * Claims the challenge before verification. The store deletes and returns it
   * in one operation, so a concurrent request cannot replay the same value.
   */
  const takePasskeyChallenge = async (
    challenge: string,
    userId: string | null,
    purpose: ChallengePurpose,
  ): Promise<boolean> => {
    const pending = await securityState.takeChallenge(challenge);
    if (!pending || pending.purpose !== purpose || pending.userId !== userId) return false;
    return pending.expiresAt.getTime() > now().getTime();
  };
  const webauthnFailure = (c: Context, error: unknown): Response => {
    if (error instanceof WebAuthnError) return c.json({ error: error.code }, 400);
    throw error;
  };
  const mailer = deps.mailer ?? createMailer();
  const appUrl = (deps.appUrl ?? process.env.APP_URL ?? '').trim().replace(/\/$/, '');
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
  const accountThrottle = new LoginThrottle({ now: threatNow, state: securityState });
  const ipThrottle = new LoginThrottle({ now: threatNow, blockAfter: 20, state: securityState });
  /** Second-factor attempts are account-scoped: five failures cover verify, disable, and step-up. */
  const mfaThrottle = new LoginThrottle({ now: threatNow, state: securityState });
  /** 429 response shared by the second-factor routes. */
  const tooManyMfaAttempts = (c: Context, retryAfterSec: number) => {
    c.header('Retry-After', String(retryAfterSec));
    return c.json({ error: 'too_many_attempts' }, 429);
  };
  const breachedPassword = deps.breachedPassword
    ?? (process.env.VITEST ? async () => false : isBreachedPassword);
  const sessionUser = async (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? auth.userForToken(hashSessionToken(token), now()) : null;
  };
  /** Coarse request metadata, shared with sessions so audit rows line up. */
  const auditMeta = (c: Context) => ({
    ipPrefix: ipPrefix(c.req.header('x-forwarded-for')),
    device: deviceLabel(c.req.header('user-agent')),
  });
  /**
   * Audit writes are best-effort: a broken audit table is logged, never allowed
   * to fail or undo the user action that produced the event.
   */
  const audit = async (c: Context, userId: string, type: AuditType,
    detail?: AuditInput['detail']): Promise<void> => {
    try {
      await auth.appendAudit({ userId, type, at: now(), ...auditMeta(c), ...(detail ? { detail } : {}) });
    } catch (error) {
      console.error('[audit] failed to append', type, (error as Error).message);
    }
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

  /**
   * The shared practice household is a fixture, not a scratch ledger. In
   * production any mutating request that names one of its ids (URL or body,
   * including the seeded demo requests) is refused unless the caller is in a
   * practice demo session — and a demo session writes to its own copy, so no
   * visitor can move the fixture another visitor reads. Local tests and dev
   * servers run without wallet auth and keep the old writable fixture.
   */
  const demoCopyFor = (c: Context): PracticeLedger | null => {
    const sessionId = getCookie(c, DEMO_SESSION_COOKIE);
    if (!sessionId) return null;
    const existing = demoCopies.get(sessionId);
    if (existing) {
      /* Refresh insertion order so the LRU keeps active sessions. */
      demoCopies.delete(sessionId);
      demoCopies.set(sessionId, existing);
      return existing;
    }
    const copy = deps.practice.fork();
    demoCopies.set(sessionId, copy);
    if (demoCopies.size > DEMO_COPY_LIMIT) {
      const oldest = demoCopies.keys().next().value;
      if (oldest) demoCopies.delete(oldest);
    }
    return copy;
  };
  /** Ids of the shared fixture named by the request URL or its JSON body. */
  const practiceTargets = async (c: Context): Promise<string[]> => {
    /*
     * The import routes stream the body themselves (readImportBody), so they
     * are not readable here; their account is always in the path. Every other
     * mutating route has a small body we can inspect: Hono caches req.text()
     * and the handler's req.json() reuses that cache, whatever the caller set
     * as content-type.
     */
    const body = c.req.path.includes('/imports')
      ? ''
      : await c.req.text().catch(() => '');
    const haystack = `${c.req.url}\n${body}`;
    const ids: string[] = PRACTICE_ACCOUNT_IDS.filter((id) => haystack.includes(id));
    for (const id of PRACTICE_REQUEST_IDS) if (haystack.includes(id)) ids.push(id);
    return ids;
  };
  app.use('*', async (c, next) => {
    const copy = demoCopyFor(c);
    if (copy) return runInPracticeScope(copy, next);
    const method = c.req.method.toUpperCase();
    if (!enforceWalletAuth || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if ((await practiceTargets(c)).length === 0) return next();
    return c.json({
      error: 'The sample household is read-only. Open the practice demo to make changes to your own copy.',
    }, 403);
  });

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
  }, async userId => {
    const state = await auth.getMfaState(userId);
    return state.secret ? newMfaChallenge(userId) : null;
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
    const accountVerdict = await accountThrottle.checkAsync(accountKey);
    const ipVerdict = await ipThrottle.checkAsync(ipKey);
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
      await accountThrottle.failAsync(accountKey);
      await ipThrottle.failAsync(ipKey);
      // Unknown emails stay unlogged so the audit log cannot confirm accounts.
      if (user) await audit(c, user.id, 'login_failed');
      return c.json({ error: 'Email or password is incorrect.' }, 401);
    }
    await accountThrottle.succeedAsync(accountKey);
    await ipThrottle.succeedAsync(ipKey);
    const mfa = await auth.getMfaState(user.id);
    if (mfa.secret) {
      const challenge = await newMfaChallenge(user.id);
      await audit(c, user.id, 'mfa_challenge');
      return c.json({ mfaRequired: true, challenge });
    }
    await issueSession(c, user.id);
    await audit(c, user.id, 'login');
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
    await audit(c, user.id, 'session_revoked', { sessionId: c.req.param('id') });
    return c.json({ ok: true });
  });

  /** The caller's own security history; detail stays server-side. */
  app.get('/auth/audit', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const events = await auth.listAudit(user.id);
    return c.json({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        at: event.at.toISOString(),
        ipPrefix: event.ipPrefix,
        device: event.device,
      })),
    });
  });

  /**
   * Data-rights export: the stores' own rows for this user, nothing else.
   * The Java ledger account is intentionally absent — it is append-only
   * financial history and remains after the identity is deleted.
   */
  app.get('/account/export', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const denied = await requireStepUp(c, auth, now);
    if (denied) return denied;
    const requested = (c.req.query('format') ?? 'json').toLowerCase();
    if (requested !== 'json' && requested !== 'csv') return c.json({ error: 'unsupported_format' }, 400);
    const format = requested as 'json' | 'csv';

    /** Walks ascending id pages without ever holding the whole table. */
    const pageRows = async <T extends { id: string }>(
      load: (afterId: string | null) => Promise<T[]>,
      visit?: (rows: T[]) => void,
    ): Promise<number> => {
      let afterId: string | null = null;
      let total = 0;
      for (;;) {
        const rows = await load(afterId);
        if (rows.length === 0) break;
        total += rows.length;
        visit?.(rows);
        if (rows.length < EXPORT_PAGE_SIZE) break;
        afterId = rows[rows.length - 1]!.id;
      }
      return total;
    };
    /** Same, for stores that own an opaque cursor instead of an id. */
    const pageCursorRows = async <T>(
      load: (cursor: string | null) => Promise<{ rows: T[]; next: string | null }>,
      visit?: (rows: T[]) => void,
    ): Promise<number> => {
      let cursor: string | null = null;
      let total = 0;
      for (;;) {
        const page = await load(cursor);
        if (page.rows.length === 0) break;
        total += page.rows.length;
        visit?.(page.rows);
        if (page.next === null || page.next === cursor) break;
        cursor = page.next;
      }
      return total;
    };
    const loadIncomePage = (afterId: string | null) =>
      personalFinance.listIncomePage(user.accountId, afterId, EXPORT_PAGE_SIZE);
    const loadSpendPage = (cursor: string | null) =>
      deps.spendLogs.listSpendCursorPage(user.accountId, cursor, EXPORT_PAGE_SIZE);

    const [profile, sessions, incomeCount, spendCount] = await Promise.all([
      personalFinance.getProfile(user.accountId, 'USD', now()),
      auth.listSessions(user.id),
      pageRows(loadIncomePage),
      pageCursorRows(loadSpendPage),
    ]);
    const at = now();
    await audit(c, user.id, 'export', { format, income: incomeCount, spendLogs: spendCount });
    const filename = `settle-export-${at.toISOString().slice(0, 10)}.${format}`;
    const headers = {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };

    if (format === 'csv') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(CSV_HEADER_ROW));
            await pageRows(loadIncomePage, (rows) => {
              controller.enqueue(encoder.encode(rows.map((entry) => csvExportRow('income', entry)).join('')));
            });
            await pageCursorRows(loadSpendPage, (rows) => {
              controller.enqueue(encoder.encode(rows.map((entry) => csvExportRow('spend', entry)).join('')));
            });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(stream, { headers });
    }

    const events = await auth.listAudit(user.id, 500);
    const userBody = { id: user.id, email: user.email, displayName: user.displayName };
    const profileBody = {
      accountId: profile.accountId,
      currency: profile.currency,
      periodLabel: profile.periodLabel,
      periodStart: profile.periodStart,
      walletCashMinor: profile.walletCashMinor,
      creditOwedMinor: profile.creditOwedMinor,
      weeklyBudgetMinor: profile.weeklyBudgetMinor,
      spendLogsAffectWallet: profile.spendLogsAffectWallet,
      updatedAt: profile.updatedAt,
    };
    const sessionsBody = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      device: session.device,
      ipPrefix: session.ipPrefix,
    }));
    const auditBody = events.map((event) => ({
      id: event.id,
      type: event.type,
      at: event.at.toISOString(),
      ipPrefix: event.ipPrefix,
      device: event.device,
    }));
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(
            '{"exportedAt":' + JSON.stringify(at.toISOString())
            + ',"user":' + JSON.stringify(userBody)
            + ',"profile":' + JSON.stringify(profileBody)
            + ',"income":[',
          ));
          let first = true;
          await pageRows(loadIncomePage, (rows) => {
            const json = rows.map((entry) => JSON.stringify({
              id: entry.id,
              amountMinor: entry.amountMinor,
              currency: entry.currency,
              source: entry.source,
              note: entry.note,
              occurredAt: entry.occurredAt,
            })).join(',');
            controller.enqueue(encoder.encode((first ? '' : ',') + json));
            first = false;
          });
          controller.enqueue(encoder.encode('],"spendLogs":['));
          first = true;
          await pageCursorRows(loadSpendPage, (rows) => {
            const json = rows.map((entry) => JSON.stringify({
              id: entry.id,
              amountMinor: entry.amountMinor,
              currency: entry.currency,
              category: entry.category,
              source: entry.source,
              note: entry.note,
              occurredAt: entry.occurredAt,
            })).join(',');
            controller.enqueue(encoder.encode((first ? '' : ',') + json));
            first = false;
          });
          controller.enqueue(encoder.encode(
            '],"sessions":' + JSON.stringify(sessionsBody)
            + ',"audit":' + JSON.stringify(auditBody) + '}',
          ));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(stream, { headers });
  });


  /**
   * Account deletion. The ledger account itself survives: it is append-only
   * financial history. Identity, sessions, MFA, personal-finance rows, spend
   * logs, and the audit history are removed; account_deleted is written first.
   */
  app.delete('/account', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const denied = await requireStepUp(c, auth, now);
    if (denied) return denied;
    const parsed = deleteAccountBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'confirm_required' }, 400);

    await audit(c, user.id, 'account_deleted');
    // Crypto-shredding: destroy the wrapped data key before the rows go, so
    // ciphertext that survives in live tables or backups can never be read.
    // Rows are account-scoped while other material is user-scoped, so both die.
    await deps.dataKeys?.shred(user.accountId);
    await deps.dataKeys?.shred(user.id);
    await personalFinance.deleteAll(user.accountId);
    await imports.deleteAll(user.accountId);
    await alertDismissals.deleteAll(user.accountId);
    await deps.spendLogs.deleteAll?.(user.accountId);
    await subscriptionMarks.deleteAll(user.accountId);
    await auth.deleteUser(user.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    return c.json({ deleted: true });
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
    // Replacing an authenticator must go through disable, which proves possession
    // of the current one; setup alone must never overwrite a live secret.
    const state = await auth.getMfaState(user.id);
    if (state.secret) return c.json({ error: 'mfa_already_enabled' }, 409);
    const secret = randomBytes(20);
    await auth.saveMfaPendingSecret(user.id, encryptSecret(secret, mfaKey));
    return c.json({ secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) });
  });

  app.post('/auth/mfa/enable', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
    const state = await auth.getMfaState(user.id);
    if (state.secret) return c.json({ error: 'mfa_already_enabled' }, 409);
    const parsed = mfaCodeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    if (!state.pendingSecret) return c.json({ error: 'invalid_code' }, 400);
    const secret = decryptSecret(state.pendingSecret, mfaKey);
    const verdict = verifyTotp(secret, parsed.data.code, now().getTime());
    if (!verdict.ok) return c.json({ error: 'invalid_code' }, 400);
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
    const enabled = await auth.enableMfa(user.id, state.pendingSecret, hashes, verdict.step ?? null);
    if (!enabled) return c.json({ error: 'mfa_already_enabled' }, 409);
    await rotateSession(c, user.id);
    await audit(c, user.id, 'mfa_enabled');
    return c.json({ recoveryCodes });
  });

  /** Password sign-in stopped after the first factor; this finishes it. */
  app.post('/auth/mfa/verify', async (c) => {
    const parsed = mfaVerifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    const pending = await securityState.getChallenge(parsed.data.challenge);
    if (!pending || pending.purpose !== 'mfa' || !pending.userId) {
      return c.json({ error: 'invalid_code' }, 400);
    }
    const at = now();
    if (pending.expiresAt.getTime() <= at.getTime()) {
      await securityState.deleteChallenge(parsed.data.challenge);
      return c.json({ error: 'challenge_expired' }, 400);
    }
    const user = await auth.findById(pending.userId);
    const state = user ? await auth.getMfaState(user.id) : null;
    if (!user || !state?.secret || !mfaKey) {
      await securityState.deleteChallenge(parsed.data.challenge);
      return c.json({ error: 'invalid_code' }, 400);
    }
    const throttleKey = 'mfa:' + user.id;
    const throttle = await mfaThrottle.checkAsync(throttleKey);
    if (!throttle.allowed) return tooManyMfaAttempts(c, throttle.retryAfterSec);
    // The attempt counter is the atomic gate. A missing or exhausted challenge
    // cannot be verified even by two requests that both read it beforehand.
    const attempts = await securityState.incrementChallengeAttempts(parsed.data.challenge);
    if (attempts === 0) {
      await securityState.deleteChallenge(parsed.data.challenge);
      return c.json({ error: 'invalid_code' }, 400);
    }
    const secret = decryptSecret(state.secret, mfaKey);
    const verdict = verifyTotp(secret, parsed.data.code, at.getTime(),
      { lastUsedStep: state.lastUsedStep });
    let accepted = verdict.ok;
    let usedRecoveryCode = false;
    if (accepted) {
      // Only the request that claims this step wins; a concurrent duplicate is a replay.
      if (verdict.step == null || !await auth.recordMfaStep(user.id, verdict.step)) accepted = false;
    } else {
      usedRecoveryCode = await consumeRecoveryCode(user.id, parsed.data.code, at);
      accepted = usedRecoveryCode;
    }
    if (accepted) {
      await mfaThrottle.succeedAsync(throttleKey);
      await securityState.deleteChallenge(parsed.data.challenge);
      await issueSession(c, user.id);
      await audit(c, user.id, 'login');
      if (usedRecoveryCode) await audit(c, user.id, 'recovery_code_used');
      return c.json({ ok: true });
    }
    if (attempts >= 5) {
      // One account-level failure per used-up challenge: a password holder gets
      // five guesses per sign-in, and repeated sign-ins back off up to 15 minutes.
      await mfaThrottle.failAsync(throttleKey);
      await securityState.deleteChallenge(parsed.data.challenge);
    }
    return c.json({ error: 'invalid_code' }, 400);
  });

  app.post('/auth/mfa/disable', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
    const throttleKey = 'mfa:' + user.id;
    const throttle = await mfaThrottle.checkAsync(throttleKey);
    if (!throttle.allowed) return tooManyMfaAttempts(c, throttle.retryAfterSec);
    const parsed = mfaCodeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_code' }, 400);
    const state = await auth.getMfaState(user.id);
    if (!state.secret) return c.json({ error: 'invalid_code' }, 400);
    const at = now();
    const verdict = verifyTotp(decryptSecret(state.secret, mfaKey), parsed.data.code, at.getTime(),
      { lastUsedStep: state.lastUsedStep });
    let accepted = verdict.ok;
    if (accepted) {
      // Only the request that claims this step wins; a concurrent duplicate is a replay.
      if (verdict.step == null || !await auth.recordMfaStep(user.id, verdict.step)) accepted = false;
    } else {
      accepted = await consumeRecoveryCode(user.id, parsed.data.code, at);
    }
    if (!accepted) {
      await mfaThrottle.failAsync(throttleKey);
      return c.json({ error: 'invalid_code' }, 400);
    }
    await mfaThrottle.succeedAsync(throttleKey);
    await auth.disableMfa(user.id);
    await rotateSession(c, user.id);
    await audit(c, user.id, 'mfa_disabled');
    return c.json({ ok: true });
  });

  /** Opens a ten-minute window for sensitive actions; later steps use requireStepUp. */
  app.post('/auth/step-up/passkey/options', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const passkeys = await auth.listPasskeys(user.id);
    const challenge = await newPasskeyChallenge(user.id, 'step-up');
    return c.json({
      challenge,
      rpId: rpIdFor(c),
      timeout: PASSKEY_CHALLENGE_TTL_MS,
      userVerification: 'preferred',
      allowCredentials: passkeys.map((passkey) => ({
        type: 'public-key',
        id: passkey.id,
        transports: passkey.transports,
      })),
    });
  });

  app.post('/auth/step-up', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const parsed = stepUpBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_credentials' }, 400);
    const throttleKey = 'mfa:' + user.id;
    const throttle = await mfaThrottle.checkAsync(throttleKey);
    if (!throttle.allowed) return tooManyMfaAttempts(c, throttle.retryAfterSec);
    const at = now();
    const state = await auth.getMfaState(user.id);
    let accepted = false;
    if (parsed.data.passkey) {
      let challenge = '';
      try {
        challenge = readClientDataChallenge(parsed.data.passkey, 'webauthn.get');
        if (!await takePasskeyChallenge(challenge, user.id, 'step-up'))
          return c.json({ error: 'challenge_expired' }, 400);
        const passkey = await auth.getPasskey(readCredentialId(parsed.data.passkey));
        if (!passkey || passkey.userId !== user.id)
          return c.json({ error: 'invalid_credentials' }, 400);
        const verified = verifyAssertion(parsed.data.passkey, {
          expectedChallenge: challenge,
          expectedOrigin: appOrigin(c),
          rpId: rpIdFor(c),
          passkey,
        });
        await auth.touchPasskey(passkey.id, verified.signCount, at);
        accepted = true;
      } catch (error) {
        if (error instanceof WebAuthnError) {
          await mfaThrottle.failAsync(throttleKey);
          return c.json({ error: error.code }, 400);
        }
        throw error;
      }
    } else if (state.secret) {
      if (!mfaKey) return c.json({ error: 'mfa_unavailable' }, 503);
      if (parsed.data.code) {
        const verdict = verifyTotp(decryptSecret(state.secret, mfaKey), parsed.data.code, at.getTime(),
          { lastUsedStep: state.lastUsedStep });
        accepted = verdict.ok;
        if (accepted) {
          // Only the request that claims this step wins; a concurrent duplicate is a replay.
      if (verdict.step == null || !await auth.recordMfaStep(user.id, verdict.step)) accepted = false;
        } else {
          accepted = await consumeRecoveryCode(user.id, parsed.data.code, at);
        }
      }
    } else if (parsed.data.password) {
      accepted = await verifyPassword(parsed.data.password, user.passwordHash);
    }
    if (!accepted) {
      await mfaThrottle.failAsync(throttleKey);
      return c.json({ error: 'invalid_credentials' }, 400);
    }
    await mfaThrottle.succeedAsync(throttleKey);
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'Sign in first.' }, 401);
    const until = new Date(at.getTime() + STEP_UP_MS);
    await auth.setSessionStepUp(hashSessionToken(token), until);
    await audit(c, user.id, 'step_up');
    return c.json({ ok: true, until: until.toISOString() });
  });

  app.post('/auth/passkeys/register/options', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const denied = await requireStepUp(c, auth, now);
    if (denied) return denied;
    const passkeys = await auth.listPasskeys(user.id);
    const challenge = await newPasskeyChallenge(user.id, 'register');
    return c.json({
      rp: { id: rpIdFor(c), name: 'Settle' },
      user: {
        id: Buffer.from(user.id, 'utf8').toString('base64url'),
        name: user.email,
        displayName: user.displayName,
      },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: PASSKEY_CHALLENGE_TTL_MS,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        requireResidentKey: false,
        userVerification: 'preferred',
      },
      excludeCredentials: passkeys.map((passkey) => ({
        type: 'public-key',
        id: passkey.id,
        transports: passkey.transports,
      })),
    });
  });

  app.post('/auth/passkeys/register', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const parsed = passkeyRegisterBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_credential' }, 400);
    // Options already require step-up; saving the credential requires the
    // window to still be open, so a stolen session cannot add a passkey later.
    const denied = await requireStepUp(c, auth, now);
    if (denied) return denied;
    try {
      const challenge = readClientDataChallenge(parsed.data.credential, 'webauthn.create');
      if (!await takePasskeyChallenge(challenge, user.id, 'register'))
        return c.json({ error: 'challenge_expired' }, 400);
      const verified = verifyRegistration(parsed.data.credential, {
        expectedChallenge: challenge,
        expectedOrigin: appOrigin(c),
        rpId: rpIdFor(c),
      });
      const name = parsed.data.name ?? 'Passkey';
      await auth.addPasskey({
        id: verified.credentialId,
        userId: user.id,
        publicKeyJwk: verified.publicKeyJwk,
        alg: verified.alg,
        signCount: verified.signCount,
        transports: verified.transports,
        name,
        createdAt: now(),
        lastUsedAt: null,
      });
      await audit(c, user.id, 'passkey_added', { name });
      const stored = await auth.getPasskey(verified.credentialId);
      return c.json({ ok: true, passkey: stored ? passkeySummary(stored) : null });
    } catch (error) {
      if (error instanceof PasskeyExistsError) return c.json({ error: 'passkey_exists' }, 409);
      return webauthnFailure(c, error);
    }
  });

  app.get('/auth/passkeys', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const passkeys = await auth.listPasskeys(user.id);
    return c.json({ passkeys: passkeys.map(passkeySummary) });
  });

  app.delete('/auth/passkeys/:id', async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: 'Sign in first.' }, 401);
    const denied = await requireStepUp(c, auth, now);
    if (denied) return denied;
    const id = c.req.param('id');
    if (!id || id.length > 2048) return c.json({ error: 'passkey_not_found' }, 404);
    if (!await auth.deletePasskey(user.id, id)) {
      return c.json({ error: 'passkey_not_found' }, 404);
    }
    await audit(c, user.id, 'passkey_removed', { id });
    return c.json({ ok: true });
  });

  app.post('/auth/passkeys/login/options', async (c) => {
    const challenge = await newPasskeyChallenge(null, 'login');
    return c.json({
      challenge,
      rpId: rpIdFor(c),
      timeout: PASSKEY_CHALLENGE_TTL_MS,
      userVerification: 'preferred',
      allowCredentials: [],
    });
  });

  /** Discoverable passkey sign-in. The credential identifies the account. */
  app.post('/auth/passkeys/login', async (c) => {
    const ipKey = 'ip:' + clientIp(c);
    const throttle = await ipThrottle.checkAsync(ipKey);
    if (!throttle.allowed) {
      c.header('Retry-After', String(throttle.retryAfterSec));
      return c.json({ error: 'too_many_attempts' }, 429);
    }
    const fail = async (response: Response): Promise<Response> => {
      await ipThrottle.failAsync(ipKey);
      return response;
    };
    const parsed = passkeyLoginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c.json({ error: 'invalid_credential' }, 400));
    try {
      const challenge = readClientDataChallenge(parsed.data.credential, 'webauthn.get');
      if (!await takePasskeyChallenge(challenge, null, 'login')) {
        return fail(c.json({ error: 'challenge_expired' }, 400));
      }
      const passkey = await auth.getPasskey(readCredentialId(parsed.data.credential));
      if (!passkey) return fail(c.json({ error: 'invalid_credentials' }, 401));
      let verified;
      try {
        verified = verifyAssertion(parsed.data.credential, {
          expectedChallenge: challenge,
          expectedOrigin: appOrigin(c),
          rpId: rpIdFor(c),
          passkey,
        });
      } catch (error) {
        if (error instanceof WebAuthnError) {
          if (error.code === 'passkey_cloned') {
            await audit(c, passkey.userId, 'passkey_login', { result: 'passkey_cloned' });
          }
          return fail(c.json({ error: error.code }, 400));
        }
        throw error;
      }
      await ipThrottle.succeedAsync(ipKey);
      await auth.touchPasskey(passkey.id, verified.signCount, now());
      await audit(c, passkey.userId, 'passkey_login', { uv: verified.userVerified });
      const user = await auth.findById(passkey.userId);
      if (!user) return c.json({ error: 'invalid_credentials' }, 401);
      if (!verified.userVerified) {
        const mfa = await auth.getMfaState(user.id);
        if (mfa.secret) {
          const mfaChallenge = await newMfaChallenge(user.id);
          await audit(c, user.id, 'mfa_challenge');
          return c.json({ mfaRequired: true, challenge: mfaChallenge });
        }
      }
      await issueSession(c, user.id);
      return c.json({
        user: { email: user.email, displayName: user.displayName },
        account: { id: user.accountId, owner: user.ownerId },
      });
    } catch (error) {
      return webauthnFailure(c, error);
    }
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
    await audit(c, userId, 'password_changed');
    // A reset only proves the email inbox. When a second factor is enrolled, the
    // reply matches a password sign-in so the TOTP (or recovery code) is still
    // required before any session is issued.
    const mfa = await auth.getMfaState(userId);
    if (mfa.secret) {
      const challenge = await newMfaChallenge(userId);
      await audit(c, userId, 'mfa_challenge');
      return c.json({ mfaRequired: true, challenge });
    }
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
      return respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, imports, subscriptionMarks, id, Math.min(limit, 100), now, tzOffsetFrom(c)));
    }
    const owner = c.req.query('owner');
    if (!owner) return c.json({ error: 'owner is required' }, 400);
    const denied = await ownerAccessError(c, owner);
    if (denied) return denied;
    const accounts = await deps.ledger.accountsByOwner(owner);
    return c.json(accounts.map((a) => ({ id: a.id, owner: a.ownerId })));
  });

  app.get('/accounts/:id/forecast', async (c) => {
    const snapshot = await riskSnapshot(c.req.param('id'));
    if (!snapshot) return c.json({ error: 'Account not found' }, 404);
    return c.json(buildCashForecast({
      now: snapshot.at,
      currentBalanceMinor: snapshot.currentBalanceMinor,
      transactions: snapshot.transactions,
      currency: snapshot.account.currency,
      horizonDays: 90,
    }));
  });

  app.get('/accounts/:id/alerts', async (c) => {
    const accountId = c.req.param('id');
    const snapshot = await riskSnapshot(accountId);
    if (!snapshot) return c.json({ error: 'Account not found' }, 404);
    const dismissed = await alertDismissals.list(accountId);
    const alerts = buildRiskAlerts({
      now: snapshot.at,
      transactions: snapshot.transactions,
      currentBalanceMinor: snapshot.currentBalanceMinor,
      weeklyBudgetMinor: snapshot.profile.weeklyBudgetMinor,
      weeklySpentMinor: snapshot.patterns.week.spentMinor,
      weekStart: snapshot.patterns.week.start,
      dismissed,
    });
    return c.json({ alerts, generatedAt: snapshot.at.toISOString() });
  });

  app.post('/accounts/:id/alerts/:alertId/dismiss', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    const alertId = c.req.param('alertId');
    if (!alertId || alertId.length > 200) return c.json({ error: 'Invalid alert' }, 400);
    if (!await deps.ledger.getAccount(accountId)) return c.json({ error: 'Account not found' }, 404);
    await alertDismissals.dismiss(accountId, alertId, now());
    return c.json({ ok: true });
  });

  app.get('/accounts/:id/reports/monthly', async (c) => {
    const snapshot = await riskSnapshot(c.req.param('id'), { month: c.req.query('month') });
    if (!snapshot) return c.json({ error: 'Account not found' }, 404);
    return c.json(buildMonthlyReport({
      now: snapshot.at,
      transactions: snapshot.transactions,
      month: c.req.query('month'),
      currency: snapshot.account.currency,
    }));
  });

  app.get('/accounts/:id/reports/monthly.csv', async (c) => {
    const snapshot = await riskSnapshot(c.req.param('id'), { month: c.req.query('month') });
    if (!snapshot) return c.json({ error: 'Account not found' }, 404);
    const report = buildMonthlyReport({
      now: snapshot.at,
      transactions: snapshot.transactions,
      month: c.req.query('month'),
      currency: snapshot.account.currency,
    });
    return c.body(reportCsv(report), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="settle-report-${report.month}.csv"`,
    });
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
    return respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, imports, subscriptionMarks, id, 30, now, tzOffsetFrom(c)));
  });

  /**
   * M3 imports run in-process. The file bytes never leave this request: parse,
   * validate, stage, dedupe and post all happen before the response.
   */
  app.post('/accounts/:id/imports/preview', async (c) => {
    const body = await readImportBody(c);
    if (body.tooLarge) return c.json({ error: 'file_too_large' }, 413);
    const parsed = importPreviewBody.safeParse(body.value);
    if (!parsed.success) return c.json({ error: 'file_too_large' }, 400);
    const filename = parsed.data.filename.toLowerCase();
    if (!/\.(csv|ofx|qfx)$/.test(filename)) return c.json({ error: 'unsupported_type' }, 400);
    if (Buffer.byteLength(parsed.data.content, 'utf8') > IMPORT_MAX_CHARS) {
      return c.json({ error: 'file_too_large' }, 413);
    }
    if (!filename.endsWith('.csv')) {
      return c.json({ source: filename.endsWith('.qfx') ? 'qfx' : 'ofx', columns: [], suggestedMapping: null, sampleRows: [] });
    }
    try {
      const { previewCsvImport } = await import('./importers.js');
      const preview = previewCsvImport(parsed.data.content);
      return c.json({ source: 'csv', ...preview });
    } catch (error) {
      const reason = error instanceof ImportParseError ? error.reason : 'missing_header';
      return c.json({ error: reason }, 400);
    }
  });

  app.get('/accounts/:id/imports', async (c) => {
    const id = c.req.param('id');
    return c.json({ imports: await imports.listImports(id) });
  });

  app.get('/accounts/:id/imports/presets', async (c) => {
    return c.json({ presets: await imports.listPresets(c.req.param('id')) });
  });

  app.post('/accounts/:id/imports/presets', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = importPresetBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_preset' }, 400);
    const preset = await imports.savePreset(c.req.param('id'), {
      name: parsed.data.name,
      source: parsed.data.source,
      mapping: parsed.data.mapping as ImportColumnMapping,
    });
    return c.json({ preset }, 201);
  });

  app.get('/accounts/:id/imports/:importId', async (c) => {
    const accountId = c.req.param('id');
    const record = await imports.getImport(accountId, c.req.param('importId'));
    if (!record) return c.json({ error: 'not_found' }, 404);
    const limit = c.req.query('limit') === undefined
      ? undefined
      : Math.min(1_000, Math.max(1, Number(c.req.query('limit')) || 1));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const transactions = (await importTransactions(imports, accountId, record.id, { limit, offset }))
      .map((row) => importTransactionView(row, record.filename));
    return c.json({
      import: record,
      transactions,
      pagination: { limit: limit ?? null, offset },
      reconciled: record.reconciliation.reconciled,
    });
  });

  app.post('/accounts/:id/imports', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const body = await readImportBody(c);
    if (body.tooLarge) return c.json({ error: 'file_too_large' }, 413);
    const parsed = importUploadBody.safeParse(body.value);
    if (!parsed.success) return c.json({ error: 'invalid_import' }, 400);
    const filename = parsed.data.filename.toLowerCase();
    if (!/\.(csv|ofx|qfx)$/.test(filename)) return c.json({ error: 'unsupported_type' }, 400);
    if (Buffer.byteLength(parsed.data.content, 'utf8') > IMPORT_MAX_CHARS) {
      return c.json({ error: 'file_too_large' }, 413);
    }
    const result = await runImport(imports, {
      accountId: c.req.param('id'),
      filename: parsed.data.filename,
      content: parsed.data.content,
      mapping: parsed.data.mapping as ImportColumnMapping | undefined,
      presetId: parsed.data.presetId ?? null,
      accountKind: parsed.data.accountKind,
      expectedRowCount: parsed.data.expectedRowCount,
      expectedOutflowMinor: parsed.data.expectedOutflowMinor,
      openingBalanceMinor: parsed.data.openingBalanceMinor,
      enrichment,
    }, now);
    return c.json({
      import: result.import,
      created: result.created,
      reconciled: result.import.reconciliation.reconciled,
      transactions: result.transactions.map((row) => importTransactionView(row, result.import.filename)),
    }, 201);
  });

  app.post('/accounts/:id/subscriptions/:streamId/mark', async (c) => {
    if (!await allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    const streamId = c.req.param('streamId');
    if (!z.string().uuid().safeParse(accountId).success || !z.string().min(3).max(160).safeParse(streamId).success) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = z.object({ markedToCancel: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    await subscriptionMarks.set(accountId, streamId, parsed.data.markedToCancel, now());
    const subscriptions = buildSubscriptionReport(
      await deps.spendLogs.list(accountId, { limit: 500 }),
      now(),
      await subscriptionMarks.list(accountId),
    );
    return c.json({ subscriptions });
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
    const descriptor = parsed.data.descriptor ?? parsed.data.note ?? '';
    const enriched = await enrichSpendDraft(enrichment, accountId, {
      amountMinor: parsed.data.amountMinor,
      descriptor,
      note: parsed.data.note ?? null,
      occurredAt: parsed.data.occurredAt ?? now().toISOString(),
      source: 'manual',
      category: parsed.data.category ?? null,
    }, now(), parsed.data.category);
    const event = await deps.spendLogs.record(accountId, {
      ...parsed.data,
      note: parsed.data.note ?? parsed.data.descriptor,
      category: enriched.category,
      descriptorClean: enriched.descriptorClean,
      merchantId: enriched.merchantId,
      merchantName: enriched.merchantName,
      merchantMethod: enriched.merchantMethod,
      merchantConfidence: enriched.merchantConfidence,
      categorySource: enriched.categorySource,
      ruleId: enriched.ruleId,
      ruleVersion: enriched.ruleVersion,
      currency: account.currency,
      source: 'manual',
    }, now(), c.req.header('Idempotency-Key'));
    if (event && parsed.data.category) {
      await enrichment.setOverride(accountId, event.id, {
        category: parsed.data.category,
        source: 'manual',
        ruleId: null,
        ruleVersion: null,
        merchantId: enriched.merchantId,
      }, now());
    }
    // Live Java spends keep only note on the wire. Store the raw descriptor
    // alongside the enrichment rows so a note cannot hide the merchant.
    if (descriptor.trim()) await enrichment.setDescriptor(accountId, event.id, descriptor, now());
    return c.json({
      id: event.id,
      amountMinor: event.amountMinor,
      category: event.category,
      categorySource: enriched.categorySource,
      descriptorClean: enriched.descriptorClean,
      merchantId: enriched.merchantId,
      merchantName: enriched.merchantName,
      merchantMethod: enriched.merchantMethod,
      merchantConfidence: enriched.merchantConfidence,
      ruleId: enriched.ruleId,
      ruleVersion: enriched.ruleVersion,
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
    await enrichment.clearOverride(accountId, spendId);
    await enrichment.clearDescriptor(accountId, spendId);
    return c.json({ removed: true });
  });

  app.get('/accounts/:id/rules', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const [entries, context, versions] = await Promise.all([
      deps.spendLogs.list(accountId, { limit: 500 }),
      (async () => {
        const [merchants, rules, overrides, descriptors] = await Promise.all([
          enrichment.listMerchants(accountId),
          enrichment.listRules(accountId),
          enrichment.getOverrides(accountId),
          enrichment.getDescriptors(accountId),
        ]);
        return { merchants, rules, overrides, descriptors };
      })(),
      enrichment.listRuleVersions(accountId),
    ]);
    const transactions = entries.map((entry) => enrichedSpendRow(entry, applyCascade(normalizeSpend(entry, context.descriptors.get(entry.id)), {
      merchants: context.merchants,
      rules: context.rules,
      override: context.overrides.get(entry.id) ?? null,
    })));
    return c.json({
      merchants: context.merchants,
      rules: context.rules,
      versions,
      transactions,
      stats: {
        transactions: transactions.length,
        merchants: context.merchants.length,
        rules: context.rules.length,
        resolved: transactions.filter((row) => row.merchantId !== null).length,
        unresolved: transactions.filter((row) => row.merchantId === null).length,
        autoCategorized: transactions.filter((row) =>
          row.categorySource === 'merchant_default' || row.categorySource === 'keyword' || row.categorySource === 'user_rule').length,
        corrected: transactions.filter((row) => row.categorySource === 'user_correction' || row.categorySource === 'manual').length,
      },
    });
  });

  app.post('/accounts/:id/rules/preview', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const parsed = ruleDraftBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const entries = await deps.spendLogs.list(accountId, { limit: 1000 });
    const preview = await previewRuleForAccount(enrichment, accountId, {
      merchantContains: parsed.data.merchantContains,
      maxAmountMinor: parsed.data.maxAmountMinor ?? null,
      category: parsed.data.category,
      status: 'active',
    }, entries);
    return c.json(preview);
  });

  app.post('/accounts/:id/rules', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const parsed = ruleDraftBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const rule = await enrichment.createRule(accountId, {
      merchantContains: parsed.data.merchantContains,
      maxAmountMinor: parsed.data.maxAmountMinor ?? null,
      category: parsed.data.category,
    }, now());
    return c.json(rule, 201);
  });

  app.patch('/accounts/:id/rules/:ruleId', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const parsed = ruleDraftBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const rule = await enrichment.updateRule(accountId, c.req.param('ruleId'), {
      merchantContains: parsed.data.merchantContains,
      maxAmountMinor: parsed.data.maxAmountMinor ?? null,
      category: parsed.data.category,
    }, now());
    if (!rule) return c.json({ error: 'Rule not found' }, 404);
    return c.json(rule);
  });

  app.delete('/accounts/:id/rules/:ruleId', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const archived = await enrichment.archiveRule(accountId, c.req.param('ruleId'));
    if (!archived) return c.json({ error: 'Rule not found' }, 404);
    return c.json({ archived: true });
  });

  app.post('/accounts/:id/rules/:ruleId/apply', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const rule: UserRule | undefined = (await enrichment.listRules(accountId))
      .find((row) => row.ruleId === c.req.param('ruleId'));
    if (!rule) return c.json({ error: 'Rule not found' }, 404);
    const entries = await deps.spendLogs.list(accountId, { limit: 1000 });
    const result = await applyRuleRetroactively(enrichment, accountId, rule, entries, now());
    return c.json({ applied: result.affected, skipped: result.skipped, overrides: result.overrides });
  });

  app.post('/accounts/:id/merchants/corrections', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const denied = await walletAccessError(c, accountId);
    if (denied) return denied;
    const parsed = merchantCorrectionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const entries = await deps.spendLogs.list(accountId, { limit: 1000 });
    try {
      const result = await recordMerchantCorrection(enrichment, accountId, entries, parsed.data, now());
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Transaction not found') {
        return c.json({ error: 'Transaction not found' }, 404);
      }
      throw error;
    }
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
    const view = await accountView(deps.ledger, deps.spendLogs, personalFinance, imports, subscriptionMarks, id, 100, now, tzOffsetFrom(c));
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

  /**
   * Guided demo in practice mode: the fixed household plus a personal history to
   * explore. This is the only route that hands out a writable copy of the
   * fixture; the shared household stays read-only for everyone else.
   */
  app.post('/demo/practice', async (c) => {
    if (!await allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const boot = deps.practice.bootstrap();
    await Promise.all([
      ensurePracticeDemoSeeded(PRACTICE_ANTHONY, true),
      ensurePracticeDemoSeeded(PRACTICE_SAM, true),
      ensurePracticeDemoSeeded(PRACTICE_JORDAN, true),
    ]);
    /* Fresh session id: each demo start gets a clean copy of the household. */
    const sessionId = randomBytes(18).toString('base64url');
    const copy = deps.practice.fork();
    demoCopies.delete(sessionId);
    demoCopies.set(sessionId, copy);
    if (demoCopies.size > DEMO_COPY_LIMIT) {
      const oldest = demoCopies.keys().next().value;
      if (oldest) demoCopies.delete(oldest);
    }
    setCookie(c, DEMO_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: DEMO_SESSION_TTL_SEC,
      secure: process.env.NODE_ENV === 'production',
    });
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
  imports: ImportStore,
  subscriptionMarks: SubscriptionTrackerStore,
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
  const importedRows = await imports.listTransactions(id, { limit: 1000 });
  const importRecords = await imports.listImports(id, { limit: 50 });
  const importedSpends = importedTransactionsToSpendEntries(importedRows);
  // The existing detector takes SpendLogEntry, so imported expenses join the
  // same normalized list. Manual logs stay first in the feed.
  const detectedSpends = [...allSpends, ...importedSpends];
  const habits = buildHabitsFromEntries(detectedSpends, now(), base.currency, profile.periodStart);
  const spends = allSpends.slice(0, 80);
  const incomes = allIncomes.slice(0, 80);
  const patterns = buildSpendingPatterns(detectedSpends, allIncomes, now(), profile, tzOffsetMinutes);
  const normalized = normalizeTransactionList({ spends: allSpends, incomes: allIncomes, imports: importedRows });
  const filenameFor = new Map(importRecords.map((record) => [record.id, record.filename]));
  const subscriptions = buildSubscriptionReport(detectedSpends, now(), await subscriptionMarks.list(id));
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
    subscriptions,
    finance,
    moneyProfile: profile,
    activityFeed,
    insights,
    normalizedTransactions: normalized.slice(0, 200),
    importedTransactions: importedRows.map((row) => importTransactionView(row, filenameFor.get(row.importId) ?? null)),
    reconciliations: importRecords.map((record) => ({
      importId: record.id,
      filename: record.filename,
      periodStart: record.statement.start,
      periodEnd: record.statement.end,
      reconciled: record.reconciliation.reconciled,
      statementClosingMinor: record.reconciliation.statementClosedMinor,
      computedClosingMinor: record.reconciliation.computedClosedMinor,
      differenceMinor: record.reconciliation.differenceMinor,
    })),
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

function importTransactionView(
  row: {
    id: string; importId: string; postedDate: string; amountMinor: number; currency: string;
    descriptorRaw: string; descriptorClean: string; categoryId: string; source: string;
  },
  filename: string | null,
) {
  return {
    id: row.id,
    importId: row.importId,
    postedDate: row.postedDate,
    amountMinor: row.amountMinor,
    amount: formatMoney(row.amountMinor, row.currency),
    currency: row.currency,
    descriptor: row.descriptorRaw,
    descriptorClean: row.descriptorClean,
    category: row.categoryId,
    source: row.source,
    filename,
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
