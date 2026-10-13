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
  chat: (accountId: string, messages: Turn[]) =>
    call<{ answer: string; toolCalls: ToolCall[]; provider: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
