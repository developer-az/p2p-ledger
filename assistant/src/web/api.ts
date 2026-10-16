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
}

export interface AccountSummary {
  sent: string;
  received: string;
  deposited: string;
  inflow: string;
  stopped: string;
  declinedCount: number;
}

export interface AccountView {
  id: string;
  owner: string;
  balance: string;
  currency: string;
  openedAt: string;
  summary: AccountSummary;
  transfers: AccountActivity[];
}

export interface RaceAttempt {
  copy: number;
  httpStatus: number;
  transferId: string;
  status: 'COMPLETED' | 'REJECTED';
  ms: number;
  outcome: 'admitted' | 'deduplicated';
}

export interface RaceResult {
  copies: number;
  distinctTransfers: number;
  transferId: string | null;
  amount: string;
  from: string;
  attempts: RaceAttempt[];
  wallMs: number;
}

export interface TransferResult {
  id: string;
  status: 'COMPLETED' | 'REJECTED';
  rejectionReason: string | null;
  amountMinor: number;
  memo: string | null;
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

function requestError(status: number, path: string, body: { error?: string }): string {
  if (body.error) return body.error;
  if (status === 502 || status === 504) {
    return 'Assistant API timed out. Redeploy or retry in a few seconds (serverless cold start).';
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error(API_DOWN);
  }
  const body = await res.json().catch(() => ({})) as { error?: string };
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

export interface LedgerMeta {
  engine: string;
  apiVersion: string;
  capabilities: string[];
}

export interface LedgerEntryRow {
  id: number;
  transferId: string;
  accountId: string;
  amountMinor: number;
  balanceAfterMinor: number;
  createdAt: string;
}

export interface BootstrapResponse {
  live: boolean;
  practice: PracticeBootstrap;
  ledger?: LedgerMeta & { persistence?: string };
  chat?: { provider: string; configured: boolean };
}

export const api = {
  bootstrap: () => call<BootstrapResponse>('/api/bootstrap'),
  seedDemo: () => call<{ accounts: AccountRef[]; focusAccountId: string; stopped: StoppedPayment }>('/api/demo', { method: 'POST' }),
  openAccount: (ownerId: string) =>
    call<AccountRef>('/api/accounts', { method: 'POST', body: JSON.stringify({ ownerId, currency: 'USD' }) }),
  findAccounts: (owner: string) => call<AccountRef[]>(`/api/accounts?owner=${encodeURIComponent(owner)}`),
  peers: (accountId: string) => call<AccountRef[]>(`/api/peers?accountId=${encodeURIComponent(accountId)}`),
  account: (id: string, limit = 50) =>
    call<AccountView>(`/api/accounts?id=${encodeURIComponent(id)}&limit=${limit}`),
  entries: (accountId: string, limit = 50) =>
    call<{ accountId: string; currency: string; entries: LedgerEntryRow[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/entries?limit=${limit}`,
    ),
  statementDownloadUrl: (accountId: string) =>
    `/api/accounts/${encodeURIComponent(accountId)}/statement.txt`,
  deposit: (accountId: string, amountMinor: number) =>
    call<TransferResult>(`/api/accounts/${encodeURIComponent(accountId)}/deposits`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ amountMinor }),
    }),
  race: (accountId: string, fromAccountId: string) =>
    call<RaceResult>('/api/race', {
      method: 'POST',
      body: JSON.stringify({ accountId, fromAccountId }),
    }),
  transfer: (req: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountMinor: number;
    memo?: string;
  }) =>
    call<TransferResult>('/api/transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ ...req, currency: 'USD' }),
    }),
  chat: (accountId: string, messages: Turn[]) =>
    call<{ answer: string; toolCalls: ToolCall[]; provider: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
