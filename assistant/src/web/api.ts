import type { SubscriptionReport } from '../server/subscriptions.js';

export type {
  DuplicateSubscription,
  SubscriptionCandidate,
  SubscriptionCadence,
  SubscriptionCharge,
  SubscriptionPriceChange,
  SubscriptionReport,
  SubscriptionStream,
} from '../server/subscriptions.js';

export interface AccountRef { id: string; owner: string }

export interface ChainReceipt {
  transferId: string; transferKey: string; commitment: string; preimage: string;
  chainId: number; contractAddress: string; status: 'PENDING' | 'SUBMITTED' | 'FINALIZED' | 'FAILED';
  transactionHash: string | null; blockNumber: number | null;
}

export interface AccountActivity {
  transferId: string;
  direction: 'sent' | 'received' | 'deposit';
  counterparty: string;
  amount: string;
  status: 'COMPLETED' | 'REJECTED';
  declineReason: string | null;
  declineExplanation: string | null;
  memo: string | null;
  createdAt: string;
  counterpartyAccountId: string;
  kind: 'TRANSFER' | 'DEPOSIT';
}

export interface PaymentTrail {
  transferId: string;
  kind: 'TRANSFER' | 'DEPOSIT';
  status: 'COMPLETED' | 'REJECTED';
  amount: string;
  memo: string | null;
  createdAt: string;
  from: string;
  to: string;
  decline: { code: string; explanation: string | null } | null;
  audited: boolean;
  request: { method: string; path: string; idempotencyKey: string; requestHash: string; body: Record<string, unknown> };
  legs: { entryId: number; account: string; side: 'debit' | 'credit'; amount: string; balanceAfter: string }[];
  legsSum: string;
  events: { eventId: string; type: string; createdAt: string; publishedAt: string | null; deliveryMs: number | null }[];
}

export interface ReplayResult {
  idempotencyKey: string;
  httpStatus: number;
  replayed: boolean;
  sameTransfer: boolean;
  status: 'COMPLETED' | 'REJECTED';
  entriesBefore: number;
  entriesAfter: number;
  balanceBefore: string;
  balanceAfter: string;
}

export interface RaceResult {
  idempotencyKey: string;
  from: string;
  amount: string;
  copies: number;
  attempts: { copyIndex: number; httpStatus: number; replayed: boolean; transferId: string; status: string; ms: number }[];
  distinctTransfers: number;
  transferId: string | null;
  status: 'COMPLETED' | 'REJECTED' | null;
  entriesPosted: number | null;
  declineExplanation: string | null;
}

export interface TamperReport {
  transferId: string;
  attempts: { attempt: string; sql: string; refused: boolean; databaseSaid: string }[];
}

export interface Integrity {
  checkedAt: string;
  entryCount: number;
  entriesSum: string;
  transferCount: number;
  unbalancedTransfers: number;
  rejectedWithEntries: number;
  accountCount: number;
  accountsDrifted: number;
  outbox: { total: number; pending: number; oldestPendingAt: string | null; p95DeliveryMs: number | null };
  balanced: boolean;
  source?: 'live' | 'practice' | 'audit-unavailable';
  auditAvailable?: boolean;
  message?: string;
}

export interface AccountSummary {
  sent: string;
  received: string;
  deposited: string;
  inflow?: string;
  stopped: string;
  declinedCount: number;
}

export type SpendCategory =
  | 'dining'
  | 'groceries'
  | 'transport'
  | 'entertainment'
  | 'housing'
  | 'shopping'
  | 'health'
  | 'other';

export const SPEND_CATEGORIES: SpendCategory[] = [
  'dining', 'groceries', 'transport', 'entertainment', 'housing', 'shopping', 'health', 'other',
];

export type ActivityFeedKind = 'logged' | 'logged_income' | 'income' | 'paid' | 'failed';

export const INCOME_SOURCES = ['salary', 'freelance', 'gift', 'refund', 'other'] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

export interface ActivityFeedRow {
  id: string;
  kind: ActivityFeedKind;
  label: string;
  detail: string;
  amount: string;
  occurredAt: string;
  transferId?: string;
  spendId?: string;
  incomeId?: string;
  category?: string;
}

export interface MoneyProfile {
  accountId: string;
  currency: string;
  periodLabel: string;
  periodStart: string;
  walletCashMinor: number | null;
  creditOwedMinor: number;
  weeklyBudgetMinor: number | null;
  spendLogsAffectWallet: boolean;
  updatedAt: string;
}

export interface FinanceSnapshot {
  periodLabel: string;
  periodStart: string;
  walletCash: string | null;
  creditOwed: string;
  weeklyBudget: string | null;
  netCash: string | null;
  ledgerWallet: string;
  spendLogsAffectWallet: boolean;
  periodTotals: { income: string; spent: string };
  projectedCash: string | null;
  bullets: string[];
}

export interface PersonalInsights {
  walletBalance: string;
  income30d: string;
  loggedSpend30d: string;
  sentToPeople30d: string;
  bullets: string[];
}

export interface HabitsHome {
  weekly: {
    weekEnding: string;
    totalThisWeek: string;
    totalLastWeek: string;
    weekOverWeek: string;
    highlights: { category: SpendCategory; thisWeek: string; lastWeek: string; direction: 'up' | 'down' | 'flat' }[];
    recentSpends: { amount: string; category: SpendCategory; note: string | null; occurredAt: string }[];
  };
  summary30d: {
    windowDays: number;
    totalSpent: string;
    byCategory: { category: SpendCategory; total: string; count: number }[];
    entryCount: number;
  };
}

export interface ImportedTransaction {
  id: string;
  importId: string;
  postedDate: string;
  amountMinor: number;
  amount: string;
  currency: string;
  descriptor: string;
  descriptorClean: string;
  category: SpendCategory;
  source: 'csv' | 'ofx' | 'qfx';
  filename: string | null;
}

export interface ImportReconciliation {
  importId: string;
  filename: string;
  periodStart: string | null;
  periodEnd: string | null;
  reconciled: boolean;
  statementClosingMinor: number | null;
  computedClosingMinor: number | null;
  differenceMinor: number | null;
}

export interface NormalizedTransactionView {
  id: string;
  accountId: string;
  source: 'logged' | 'imported';
  kind: 'expense' | 'income';
  amountMinor: number;
  signedAmountMinor: number;
  currency: string;
  category: SpendCategory;
  description: string;
  occurredAt: string;
  importId?: string;
}

export interface AccountView {
  id: string;
  owner: string;
  balance: string;
  currency: string;
  openedAt: string;
  summary: AccountSummary;
  habits?: HabitsHome;
  patterns?: SpendingPatterns;
  subscriptions?: SubscriptionReport;
  moneyProfile?: MoneyProfile;
  finance?: FinanceSnapshot;
  activityFeed?: ActivityFeedRow[];
  insights?: PersonalInsights;
  spendEntries?: SpendEntry[];
  importedTransactions?: ImportedTransaction[];
  reconciliations?: ImportReconciliation[];
  normalizedTransactions?: NormalizedTransactionView[];
  transfers: AccountActivity[];
}

export interface ImportColumnMapping {
  date: string;
  description: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  balance?: string | null;
  category?: string | null;
  dateFormat?: 'auto' | 'YMD' | 'MDY' | 'DMY';
  amountSign?: 'as-is' | 'invert';
  currency?: string;
}

export interface ImportStageState {
  status: 'pending' | 'running' | 'passed' | 'failed';
  label: string;
  detail: string;
  at?: string;
}

export interface ImportRecord {
  id: string;
  accountId: string;
  fileHash: string;
  filename: string;
  source: 'csv' | 'ofx' | 'qfx';
  status: 'received' | 'posted' | 'failed' | 'rejected';
  pipelineVersion: string;
  stages: Record<'parse' | 'validate' | 'stage' | 'dedupe' | 'post', ImportStageState>;
  counts: { parsed: number; rejected: number; duplicates: number; posted: number };
  statement: {
    currency: string;
    start: string | null;
    end: string | null;
    openingBalanceMinor: number | null;
    closingBalanceMinor: number | null;
    rowCount: number;
    balanceIssues: number;
  };
  quality: { id: 'row_count' | 'date_sanity' | 'sign_convention' | 'section_totals' | 'balance_continuity'; label: string; status: 'passed' | 'failed'; detail: string }[];
  reconciliation: {
    reconciled: boolean;
    statementOpenedMinor: number | null;
    statementClosedMinor: number | null;
    computedClosedMinor: number | null;
    differenceMinor: number | null;
    rowsMatched: number;
    detail: string;
  };
  errors: { lineNumber: number; reason: 'empty_file' | 'unsupported_type' | 'unterminated_quote' | 'missing_header' | 'missing_column' | 'no_transactions' | 'malformed_ofx' | 'bad_date' | 'bad_amount' | 'bad_balance' | 'empty_description'; detail: string }[];
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPreview {
  source: 'csv' | 'ofx' | 'qfx';
  columns: string[];
  delimiter?: string;
  suggestedMapping: ImportColumnMapping | null;
  sampleRows: string[][];
}

export interface ImportPreset {
  id: string;
  name: string;
  source: 'csv' | 'ofx' | 'qfx';
  mapping: ImportColumnMapping;
  builtIn: boolean;
  createdAt?: string;
}

export interface SpendEntry {
  id: string;
  amount: string;
  amountMinor: number;
  category: SpendCategory;
  note: string | null;
  occurredAt: string;
}

export interface PatternDay {
  date: string;
  spendMinor: number;
  incomeMinor: number;
  count: number;
}

export interface PatternCategory {
  category: SpendCategory;
  totalMinor: number;
  count: number;
  prevTotalMinor: number;
  changePct: number | null;
  sharePct: number;
}

export interface PatternWeekday {
  weekday: number;
  label: string;
  totalMinor: number;
  count: number;
  averageMinor: number;
}

export interface SpendingPatterns {
  generatedAt: string;
  days: PatternDay[];
  categories: PatternCategory[];
  weekdays: PatternWeekday[];
  week: {
    start: string;
    end: string;
    spentMinor: number;
    lastWeekSpentMinor: number;
    budgetMinor: number | null;
    remainingMinor: number | null;
  };
  month: {
    label: string;
    start: string;
    spentMinor: number;
    incomeMinor: number;
    projectedSpendMinor: number;
    dayOfMonth: number;
    daysInMonth: number;
  };
  streak: {
    currentDays: number;
    longestDays: number;
    loggedDays30d: number;
    lastLoggedAt: string | null;
  };
  totals: {
    spend30dMinor: number;
    spendPrev30dMinor: number;
    income30dMinor: number;
    averageActiveDayMinor: number;
    averageCalendarDayMinor: number;
    biggestDay: PatternDay | null;
    topCategory: PatternCategory | null;
    activeDays30d: number;
  };
}

export interface ForecastPoint {
  day: number;
  date: string;
  balanceMinor: number;
}

export interface ForecastMilestone {
  day: number;
  date: string;
  balanceMinor: number;
  incomeMinor: number;
  outflowMinor: number;
}

export interface RecurringStream {
  key: string;
  merchant: string;
  merchantKey: string;
  direction: 'in' | 'out';
  category: string | null;
  amountMinor: number;
  intervalDays: number;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface CashForecast {
  generatedAt: string;
  currency: string;
  startingBalanceMinor: number;
  horizonDays: number;
  points: ForecastPoint[];
  milestones: ForecastMilestone[];
  recurringOutflows: RecurringStream[];
  plannedIncome: { date: string; amountMinor: number; merchant: string }[];
  averageDiscretionaryMinorPerDay: number;
  monthlyIncomeMinor: number;
  monthlyRecurringOutflowMinor: number;
  lowestBalanceMinor: number;
  lowestDate: string;
  shortfall: boolean;
  assumptions: string[];
}

export type AlertRule = 'LOW_PROJECTED_BALANCE' | 'LARGE_SPEND' | 'WEEKLY_PLAN_OVERSPEND' | 'UPCOMING_LARGE_CHARGE';
export type AlertSeverity = 'high' | 'medium' | 'low';

export interface RiskAlert {
  id: string;
  rule: AlertRule;
  severity: AlertSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | null>;
  occurredAt: string | null;
}

export interface ReportCategoryRow {
  key: string;
  kind: 'spend' | 'income';
  inMinor: number;
  outMinor: number;
  count: number;
}

export interface ReportMerchantRow {
  merchant: string;
  merchantKey: string;
  spendMinor: number;
  count: number;
  sharePct: number;
}

export interface MonthlyReport {
  month: string;
  label: string;
  start: string;
  end: string;
  currency: string;
  incomeMinor: number;
  spendMinor: number;
  netMinor: number;
  transactionCount: number;
  byCategory: ReportCategoryRow[];
  topMerchants: ReportMerchantRow[];
  previous: { month: string; label: string; incomeMinor: number; spendMinor: number; netMinor: number };
  change: {
    incomePct: number | null;
    spendPct: number | null;
    netPct: number | null;
    incomeDeltaMinor: number;
    spendDeltaMinor: number;
    netDeltaMinor: number;
  };
}

export interface CorridorResult {
  corridor: 'inbound' | 'outbound';
  peer: AccountRef;
  transferId: string;
  amount: string;
  status: 'COMPLETED' | 'REJECTED';
  memo: string;
  narrative: string;
}

export interface PeerLedgerView {
  peer: AccountRef;
  windowDays: number;
  sentToPeer: string;
  receivedFromPeer: string;
  netFromPeer: string;
  completedCount: number;
  declinedCount: number;
  transfers: {
    transferId: string;
    direction: 'sent' | 'received';
    amount: string;
    status: 'COMPLETED' | 'REJECTED';
    memo: string | null;
    declineReason: string | null;
    createdAt: string;
  }[];
}

export interface LedgerEntryRow {
  id: number;
  transferId: string;
  accountId: string;
  amountMinor: number;
  balanceAfterMinor: number;
  createdAt: string;
}

export interface PracticeBootstrapAccount extends AccountRef {
  role: string;
  blurb: string;
}

export interface PracticeBootstrap {
  mode: 'practice';
  accounts: PracticeBootstrapAccount[];
  focusAccountId: string;
  stoppedTransferId: string;
  hint: string;
}

export type RequestStatus = 'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED';

/** Rails a request can settle over outside the app — future rails plug in here. */
export const SETTLE_RAILS = ['zelle', 'cashapp', 'venmo', 'cash', 'crypto', 'other'] as const;
export type SettleRail = (typeof SETTLE_RAILS)[number];

export interface PaymentRequestView {
  id: string;
  requesterAccountId: string;
  payerAccountId: string;
  requester: AccountRef;
  payer: AccountRef;
  amountMinor: number;
  amount: string;
  currency: string;
  memo: string | null;
  status: RequestStatus;
  transferId: string | null;
  /** Set when the requester recorded an outside settlement (Zelle, cash, …). */
  settledVia: SettleRail | null;
  declinedAttempts: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PayRequestResult {
  request: PaymentRequestView;
  /** Absent when a repeated tap on an already-paid request is a no-op. */
  transfer?: {
    id: string;
    status: 'COMPLETED' | 'REJECTED';
    rejectionReason: string | null;
    declineExplanation: string | null;
  };
}

export interface BootstrapResponse {
  live: boolean;
  practice: PracticeBootstrap;
  ledger?: {
    engine: string;
    apiVersion: string;
    capabilities: string[];
    persistence?: string;
    auditCapabilities?: boolean;
  };
  chat?: { provider: string; configured: boolean; model?: string; configHint?: string };
  identity?: { persistent: boolean; signupAvailable?: boolean; signinAvailable?: boolean; googleAvailable?: boolean; passwordResetAvailable?: boolean; unavailableReason?: string };
}

export interface AuthUser {
  email: string;
  displayName: string;
}

export interface AuthResult {
  user: AuthUser;
  account: AccountRef;
}

/** Password sign-in stopped after the first factor; finish it with /auth/mfa/verify. */
export interface MfaChallenge {
  mfaRequired: true;
  challenge: string;
}

export type LoginResult = AuthResult | MfaChallenge;

export function isMfaChallenge(result: unknown): result is MfaChallenge {
  return typeof result === 'object' && result !== null
    && (result as { mfaRequired?: unknown }).mfaRequired === true
    && typeof (result as { challenge?: unknown }).challenge === 'string';
}

export interface AuthSessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  device: string | null;
  ipPrefix: string | null;
}

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
}

export interface PasskeySummary {
  id: string;
  name: string;
  transports: string[];
  alg: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyCreationOptions {
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  authenticatorSelection: {
    residentKey: 'preferred';
    requireResidentKey: boolean;
    userVerification: 'preferred' | 'required' | 'discouraged';
  };
  excludeCredentials: { type: 'public-key'; id: string; transports: string[] }[];
}

export interface PasskeyRequestOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'preferred' | 'required' | 'discouraged';
  allowCredentials: { type: 'public-key'; id: string; transports: string[] }[];
}

/** Browser credential response in the base64url JSON shape the server accepts. */
export interface PasskeyCredentialJson {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string | null;
    transports?: string[];
  };
  clientExtensionResults?: unknown;
}

export interface AuditEventRow {
  id: string;
  type: string;
  at: string;
  ipPrefix: string | null;
  device: string | null;
}

export interface ToolCall { tool: string; args: unknown; result: unknown; ms: number }
export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  model?: string;
  provider?: string;
}

const API_DOWN =
  'Cannot reach the assistant API. If this is the live site, wait a moment and refresh (Vercel cold start). Locally: npm run dev or npm run dev:stack.';

/** An HTTP failure that keeps the server's machine-readable code for callers that branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Machine-readable auth codes from the server, shown as plain sentences. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_code: 'That code did not work. Try again.',
  challenge_expired: 'That sign-in timed out. Enter your email and password again.',
  step_up_required: 'Confirm it is you to continue.',
  invalid_credentials: 'That code or password did not work.',
  mfa_unavailable: 'Two-factor sign-in is not available on this server.',
  passkey_cloned: 'This passkey may have been copied. Sign in another way and remove it.',
  unsupported_attestation: 'This passkey type is not supported.',
  unsupported_algorithm: 'This passkey type is not supported.',
  passkey_exists: 'That passkey is already added.',
  passkey_not_found: 'That passkey is no longer on this account.',
  confirm_required: 'Type DELETE to confirm.',
  unsupported_format: 'Choose JSON or CSV.',
};

function requestError(status: number, path: string, body: { error?: string; code?: string }): string {
  if (body.error === 'too_many_attempts') return 'Too many attempts. Try again in a few minutes.';
  if (body.error === 'breached_password') return 'This password has appeared in a data breach. Choose a different one.';
  if (body.error === 'signup_failed') return "We couldn't create that account. If you already have one, sign in instead.";
  const authMessage = body.error ? AUTH_ERROR_MESSAGES[body.error] : undefined;
  if (authMessage) return authMessage;
  if (body.error) return body.error;
  if (status === 502 || status === 504) {
    return 'Assistant API timed out. Redeploy or retry in a few seconds (serverless cold start).';
  }
  if (status === 503 && body.code === 'LEDGER_OUTDATED') {
    return body.error ?? 'Ledger on Render needs redeploy from this branch for full audit APIs.';
  }
  if (status === 503) {
    if (path.includes('/demo')) {
      return 'Live ledger not running. Start: npm run dev:stack — or use practice accounts offline.';
    }
    return body.error ?? 'Service unavailable.';
  }
  return `Request failed (${status})`;
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Backoff for a waking ledger. A Render free-tier wake takes 30-60s, so the
 * client rides it out instead of showing an error on the first 503. Sum is
 * 39.5s, inside the minute a cold start needs.
 */
export function wakeRetryDelays(): number[] {
  return [1_500, 3_000, 5_000, 8_000, 10_000, 12_000];
}

/**
 * True when repeating the request cannot double-apply a side effect: reads
 * (GET/HEAD) always, writes only when the caller pinned an Idempotency-Key.
 * A 504 on a write may mean the write landed, so an unkeyed POST must not be
 * silently re-sent (register, login, password reset).
 */
export function isRetrySafe(init?: RequestInit): boolean {
  return isRetrySafeHeaders(init?.method ?? 'GET', new Headers(init?.headers));
}

/** The decision itself, taken from the exact method and header set that is sent. */
function isRetrySafeHeaders(method: string, headers: Headers): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  /* Same normalization call() sends with, so detection and sending agree for
     plain objects, tuple arrays and Headers instances alike. */
  return headers.has('Idempotency-Key');
}

/** Swappable so tests do not actually wait out the backoff. */
export const wakeTiming = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

export interface WakeRetryEvent {
  path: string;
  /** 1 for the first retry after the initial request. */
  attempt: number;
}

type WakeRetryListener = (event: WakeRetryEvent) => void;

const wakeRetryListeners = new Set<WakeRetryListener>();

/** Listen for each retry of a waking-ledger response. Returns an unsubscribe. */
export function onWakeRetry(listener: WakeRetryListener): () => void {
  wakeRetryListeners.add(listener);
  return () => {
    wakeRetryListeners.delete(listener);
  };
}

/** A UI listener is a bystander: if it throws, the request still goes on. */
function notifyWakeRetry(path: string, attempt: number): void {
  for (const listener of [...wakeRetryListeners]) {
    try {
      listener({ path, attempt });
    } catch {
      /* ignored on purpose */
    }
  }
}

/** Parse "$12.50" or "12.5" into minor units. */
export function dollarsToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 999_000) return null;
  return Math.round(n * 100);
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const delays = wakeRetryDelays();
  /* Built once, before the loop: spreading a Headers instance or a tuple array
     into an object would drop its entries, losing the Idempotency-Key that
     isRetrySafe() saw. Every attempt sends this same header set. */
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  /* Decided once from the outgoing snapshot: the caller's init.headers is theirs
     to mutate, and a key added mid-flight never reached this request. */
  const retrySafe = isRetrySafeHeaders(init?.method ?? 'GET', headers);
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(path, { ...init, cache: 'no-store', headers });
    } catch (error) {
      /* An aborted caller (a cancelled readiness probe) must see its own abort,
         not a retry: the request was dropped on purpose. */
      if (isAbortError(error)) throw error;
      throw new Error(API_DOWN);
    }
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
    if (res.ok) return body as T;
    /* Only a waking ledger is retried, and only when replaying the request is
       safe. Same init on every attempt, so an Idempotency-Key sent by the
       caller still covers the retried write. */
    const waking = res.status === 503 && /waking up/i.test(body.error ?? '') && retrySafe;
    const delay = delays[attempt];
    if (waking && delay !== undefined && !init?.signal?.aborted) {
      notifyWakeRetry(path, attempt + 1);
      await wakeTiming.sleep(delay);
      continue;
    }
    throw new ApiError(requestError(res.status, path, body), res.status, body.error);
  }
}

/** The export routes answer with a file, so the generic JSON helper cannot read them. */
async function fetchExport(format: 'json' | 'csv'): Promise<{ blob: Blob; filename: string }> {
  const path = `/api/account/export?format=${format}`;
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store' });
  } catch {
    throw new Error(API_DOWN);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ApiError(requestError(res.status, path, body), res.status, body.error);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? `settle-export.${format}` };
}

/** fetch rejects with a DOMException named AbortError when its signal fires. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export interface StoppedPayment {
  transferId: string;
  status: 'COMPLETED' | 'REJECTED';
  amount: string;
  memo: string | null;
  reason: string | null;
}

export const api = {
  /** Fires the ledger awake. Fire-and-forget: a cold start is not an error. */
  wake: () => call<{ awake: boolean; configured?: boolean }>('/api/wake')
    .catch((): { awake: boolean; configured?: boolean } => ({ awake: false })),
  /** Pass the caller's signal through so a cancelled readiness probe stops its fetch. */
  bootstrap: (opts?: { signal?: AbortSignal }) =>
    call<BootstrapResponse>('/api/bootstrap', opts?.signal ? { signal: opts.signal } : undefined),
  authSession: () => call<{ user: AuthUser | null; account?: AccountRef }>('/api/auth/session'),
  register: (body: { email: string; password: string; displayName: string }) =>
    call<AuthResult>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    call<LoginResult>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  requestPasswordReset: (email: string) =>
    call<{ ok: boolean; message: string }>('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmPasswordReset: (token: string, password: string) =>
    call<{ ok: true } | MfaChallenge>('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) }),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  mfaVerify: (challenge: string, code: string) =>
    call<{ ok: boolean }>('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challenge, code }) }),
  stepUp: (body: { code: string } | { password: string } | { passkey: PasskeyCredentialJson }) =>
    call<{ ok: boolean; until: string }>('/api/auth/step-up', { method: 'POST', body: JSON.stringify(body) }),
  stepUpPasskeyOptions: () =>
    call<PasskeyRequestOptions>('/api/auth/step-up/passkey/options', { method: 'POST', body: '{}' }),
  passkeys: () => call<{ passkeys: PasskeySummary[] }>('/api/auth/passkeys'),
  passkeyRegisterOptions: () =>
    call<PasskeyCreationOptions>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' }),
  passkeyRegister: (credential: PasskeyCredentialJson, name: string) =>
    call<{ ok: boolean; passkey: PasskeySummary | null }>('/api/auth/passkeys/register', {
      method: 'POST',
      body: JSON.stringify({ credential, name }),
    }),
  deletePasskey: (id: string) =>
    call<{ ok: boolean }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  passkeyLoginOptions: () =>
    call<PasskeyRequestOptions>('/api/auth/passkeys/login/options', { method: 'POST', body: '{}' }),
  passkeyLogin: (credential: PasskeyCredentialJson) =>
    call<LoginResult>('/api/auth/passkeys/login', { method: 'POST', body: JSON.stringify({ credential }) }),
  mfa: () => call<MfaStatus>('/api/auth/mfa'),
  mfaSetup: () => call<MfaSetup>('/api/auth/mfa/setup', { method: 'POST', body: '{}' }),
  mfaEnable: (code: string) =>
    call<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaDisable: (code: string) =>
    call<{ ok: boolean }>('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  sessions: () => call<{ sessions: AuthSessionRow[] }>('/api/auth/sessions'),
  revokeSession: (id: string) =>
    call<{ ok: boolean }>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  audit: () => call<{ events: AuditEventRow[] }>('/api/auth/audit'),
  exportAccount: (format: 'json' | 'csv') => fetchExport(format),
  deleteAccount: () =>
    call<{ deleted: boolean }>('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }),
  seedDemo: () => call<{ accounts: AccountRef[]; focusAccountId: string; stopped: StoppedPayment }>('/api/demo', { method: 'POST' }),
  seedPracticeDemo: () => call<{ accounts: AccountRef[]; focusAccountId: string; seeded: boolean }>('/api/demo/practice', { method: 'POST' }),
  findAccounts: (owner: string) => call<AccountRef[]>(`/api/accounts?owner=${encodeURIComponent(owner)}`),
  openAccount: (ownerId: string) =>
    call<AccountRef>('/api/accounts', { method: 'POST', body: JSON.stringify({ ownerId, currency: 'USD' }) }),
  deposit: (accountId: string, amountMinor: number) =>
    call<{ id: string; status: string }>(`/api/accounts/${encodeURIComponent(accountId)}/deposits`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ amountMinor }),
    }),
  /** Pass the same key when retrying after a network error so the payment can only happen once. */
  transfer: (body: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountMinor: number;
    currency: string;
    memo?: string;
  }, key: string = idempotencyKey()) =>
    call<{ id: string; status: string; rejectionReason?: string | null }>('/api/transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
  peers: (accountId: string) =>
    call<AccountRef[]>(`/api/peers?accountId=${encodeURIComponent(accountId)}`),

  peerLedger: (accountId: string, peerId: string, days = 30) =>
    call<PeerLedgerView>(`/api/peer-ledger?accountId=${encodeURIComponent(accountId)}&peerId=${encodeURIComponent(peerId)}&days=${days}`),

  bankStatus: () => call<{
    name: string;
    description: string;
    inboundScenarios: string[];
    outboundScenarios: string[];
  }>('/api/bank/status'),

  bankWelcome: (accountId: string) =>
    call<{ depositTransferId: string; corridor: CorridorResult }>('/api/bank/welcome', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),

  bankInbound: (accountId: string) =>
    call<CorridorResult>('/api/bank/inbound', { method: 'POST', body: JSON.stringify({ accountId }) }),

  bankOutbound: (accountId: string) =>
    call<CorridorResult>('/api/bank/outbound', { method: 'POST', body: JSON.stringify({ accountId }) }),
  account: (id: string, limit = 50, tzOffsetMinutes = 0) =>
    call<AccountView>(`/api/accounts?id=${encodeURIComponent(id)}&limit=${limit}&tzOffset=${encodeURIComponent(String(tzOffsetMinutes))}`),
  markSubscription: (accountId: string, streamId: string, markedToCancel: boolean) =>
    call<{ subscriptions: SubscriptionReport }>(`/api/accounts/${encodeURIComponent(accountId)}/subscriptions/${encodeURIComponent(streamId)}/mark`, {
      method: 'POST',
      body: JSON.stringify({ markedToCancel }),
    }),
  habits: (accountId: string) =>
    call<HabitsHome>(`/api/accounts/${encodeURIComponent(accountId)}/habits`),
  recordSpend: (accountId: string, body: { amountMinor: number; category: SpendCategory; note?: string }, key: string = idempotencyKey()) =>
    call<{ id: string }>(`/api/accounts/${encodeURIComponent(accountId)}/spends`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
  deleteSpend: (accountId: string, spendId: string) =>
    call<{ removed: boolean }>(`/api/accounts/${encodeURIComponent(accountId)}/spends/${encodeURIComponent(spendId)}`, {
      method: 'DELETE',
    }),
  recordIncome: (accountId: string, body: { amountMinor: number; source: IncomeSource; note?: string }) =>
    call<{ id: string }>(`/api/accounts/${encodeURIComponent(accountId)}/incomes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateFinance: (
    accountId: string,
    body: {
      rebaseCash?: boolean;
      walletCashMinor?: number | null;
      creditOwedMinor?: number;
      weeklyBudgetMinor?: number | null;
      spendLogsAffectWallet?: boolean;
    },
  ) =>
    call<{ profile: MoneyProfile; finance: FinanceSnapshot }>(
      `/api/accounts/${encodeURIComponent(accountId)}/finance`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  rolloverFinancePeriod: (accountId: string) =>
    call<{ profile: MoneyProfile; finance: FinanceSnapshot; message: string }>(
      `/api/accounts/${encodeURIComponent(accountId)}/finance/rollover`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  requests: (accountId: string) =>
    call<{ incoming: PaymentRequestView[]; outgoing: PaymentRequestView[] }>(
      `/api/requests?accountId=${encodeURIComponent(accountId)}`,
    ),
  createRequests: (body: {
    requesterAccountId: string;
    memo?: string;
    payers: { accountId: string; amountMinor: number }[];
  }, key: string = idempotencyKey()) => call<{ requests: PaymentRequestView[] }>('/api/requests', {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body),
  }),
  importPreview: (accountId: string, body: { filename: string; content: string }) =>
    call<ImportPreview>(`/api/accounts/${encodeURIComponent(accountId)}/imports/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importUpload: (accountId: string, body: {
    filename: string;
    content: string;
    mapping?: ImportColumnMapping;
    presetId?: string | null;
    accountKind?: 'checking' | 'credit';
    expectedRowCount?: number;
    expectedOutflowMinor?: number;
    openingBalanceMinor?: number | null;
  }) =>
    call<{ import: ImportRecord; created: boolean; reconciled: boolean; transactions: ImportedTransaction[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/imports`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  imports: (accountId: string) =>
    call<{ imports: ImportRecord[] }>(`/api/accounts/${encodeURIComponent(accountId)}/imports`),
  importDetail: (accountId: string, importId: string) =>
    call<{ import: ImportRecord; transactions: ImportedTransaction[]; reconciled: boolean }>(
      `/api/accounts/${encodeURIComponent(accountId)}/imports/${encodeURIComponent(importId)}`,
    ),
  importPresets: (accountId: string) =>
    call<{ presets: ImportPreset[] }>(`/api/accounts/${encodeURIComponent(accountId)}/imports/presets`),
  saveImportPreset: (accountId: string, body: { name: string; source: 'csv' | 'ofx' | 'qfx'; mapping: ImportColumnMapping }) =>
    call<{ preset: ImportPreset }>(`/api/accounts/${encodeURIComponent(accountId)}/imports/presets`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importSpends: (accountId: string, csv: string) =>
    call<{ imported: number; duplicates: number; rows: number }>(`/api/accounts/${encodeURIComponent(accountId)}/spends/import`, {
      method: 'POST', body: JSON.stringify({ csv, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }),
  chainReceipt: (accountId: string, transferId: string) =>
    call<ChainReceipt>(`/api/transfers/${encodeURIComponent(transferId)}/receipt?accountId=${encodeURIComponent(accountId)}`),
  payRequest: (requestId: string, accountId: string) =>
    call<PayRequestResult>(`/api/requests/${encodeURIComponent(requestId)}/pay`, {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  declineRequest: (requestId: string, accountId: string) =>
    call<{ request: PaymentRequestView }>(`/api/requests/${encodeURIComponent(requestId)}/decline`, {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  cancelRequest: (requestId: string, accountId: string) =>
    call<{ request: PaymentRequestView }>(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  /** Requester confirms the money arrived outside the app (Zelle, Cash App, cash, crypto…). */
  settleRequest: (requestId: string, accountId: string, settledVia: SettleRail) =>
    call<{ request: PaymentRequestView }>(`/api/requests/${encodeURIComponent(requestId)}/settle`, {
      method: 'POST',
      body: JSON.stringify({ accountId, settledVia }),
    }),
  entries: (accountId: string, limit = 50) =>
    call<{ accountId: string; currency: string; entries: LedgerEntryRow[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/entries?limit=${limit}`,
    ),
  forecast: (accountId: string) =>
    call<CashForecast>(`/api/accounts/${encodeURIComponent(accountId)}/forecast`),
  alerts: (accountId: string) =>
    call<{ alerts: RiskAlert[]; generatedAt: string }>(`/api/accounts/${encodeURIComponent(accountId)}/alerts`),
  dismissAlert: (accountId: string, alertId: string) =>
    call<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(accountId)}/alerts/${encodeURIComponent(alertId)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  monthlyReport: (accountId: string, month?: string) =>
    call<MonthlyReport>(`/api/accounts/${encodeURIComponent(accountId)}/reports/monthly${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  monthlyReportCsvUrl: (accountId: string, month?: string) =>
    `/api/accounts/${encodeURIComponent(accountId)}/reports/monthly.csv${month ? `?month=${encodeURIComponent(month)}` : ''}`,
  trail: (accountId: string, transferId: string) =>
    call<PaymentTrail>(`/api/trail?account=${encodeURIComponent(accountId)}&transfer=${encodeURIComponent(transferId)}`),
  integrity: () => call<Integrity>('/api/integrity'),
  replay: (accountId: string, transferId: string) =>
    call<ReplayResult>('/api/replay', { method: 'POST', body: JSON.stringify({ accountId, transferId }) }),
  race: (accountId: string, fromAccountId: string) =>
    call<RaceResult>('/api/race', { method: 'POST', body: JSON.stringify({ accountId, fromAccountId }) }),
  tamper: (accountId: string, transferId: string) =>
    call<TamperReport>('/api/tamper', { method: 'POST', body: JSON.stringify({ accountId, transferId }) }),
  chat: (accountId: string, messages: Turn[]) =>
    call<{
      answer: string;
      toolCalls: ToolCall[];
      provider: string;
      model: string;
      route?: 'gemini' | 'openrouter' | 'anthropic' | 'ledger-fallback';
      fallbackReason?: string;
      /** True when the answer came from the LLM guard cache (no model call). */
      cached?: boolean;
    }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
