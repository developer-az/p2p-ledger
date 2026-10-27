export interface AccountRef { id: string; owner: string }

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

export interface AccountView {
  id: string;
  owner: string;
  balance: string;
  currency: string;
  openedAt: string;
  summary: AccountSummary;
  habits?: HabitsHome;
  patterns?: SpendingPatterns;
  moneyProfile?: MoneyProfile;
  finance?: FinanceSnapshot;
  activityFeed?: ActivityFeedRow[];
  insights?: PersonalInsights;
  spendEntries?: SpendEntry[];
  transfers: AccountActivity[];
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
  transfer: {
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
  identity?: { persistent: boolean };
}

export interface AuthUser {
  email: string;
  displayName: string;
}

export interface AuthResult {
  user: AuthUser;
  account: AccountRef;
  funded?: boolean;
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

function requestError(status: number, path: string, body: { error?: string; code?: string }): string {
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

/** Parse "$12.50" or "12.5" into minor units. */
export function dollarsToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 999_000) return null;
  return Math.round(n * 100);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error(API_DOWN);
  }
  const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
  if (!res.ok) throw new Error(requestError(res.status, path, body));
  return body as T;
}

export interface StoppedPayment {
  transferId: string;
  status: 'COMPLETED' | 'REJECTED';
  amount: string;
  memo: string | null;
  reason: string | null;
}

export const api = {
  bootstrap: () => call<BootstrapResponse>('/api/bootstrap'),
  authSession: () => call<{ user: AuthUser | null; account?: AccountRef }>('/api/auth/session'),
  register: (body: { email: string; password: string; displayName: string }) =>
    call<AuthResult>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    call<AuthResult>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
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
  habits: (accountId: string) =>
    call<HabitsHome>(`/api/accounts/${encodeURIComponent(accountId)}/habits`),
  recordSpend: (accountId: string, body: { amountMinor: number; category: SpendCategory; note?: string }) =>
    call<{ id: string }>(`/api/accounts/${encodeURIComponent(accountId)}/spends`, {
      method: 'POST',
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
  }) => call<{ requests: PaymentRequestView[] }>('/api/requests', { method: 'POST', body: JSON.stringify(body) }),
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
      route?: 'gemini' | 'anthropic' | 'ledger-fallback';
      fallbackReason?: string;
      /** True when the answer came from the LLM guard cache (no model call). */
      cached?: boolean;
    }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
