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
  attempts: { httpStatus: number; replayed: boolean; transferId: string; status: string; ms: number }[];
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
}

export interface AccountSummary {
  sent: string;
  received: string;
  deposited: string;
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
export interface ToolCall { tool: string; args: unknown; result: unknown; ms: number }
export interface Turn { role: 'user' | 'assistant'; text: string; toolCalls?: ToolCall[]; model?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const waking = res.status === 502 || res.status === 503 || res.status === 504;
    throw new Error(body.error ?? (waking ? 'The ledger is waking up. Try again in a moment.' : `Request failed (${res.status})`));
  }
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
  seedDemo: () => call<{ accounts: AccountRef[]; focusAccountId: string; stopped: StoppedPayment }>('/api/demo', { method: 'POST' }),
  findAccounts: (owner: string) => call<AccountRef[]>(`/api/accounts?owner=${encodeURIComponent(owner)}`),
  account: (id: string) => call<AccountView>(`/api/accounts?id=${encodeURIComponent(id)}`),
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
    call<{ answer: string; toolCalls: ToolCall[]; provider: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
