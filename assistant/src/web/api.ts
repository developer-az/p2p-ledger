export interface AccountRef { id: string; owner: string }
export interface ToolCall { tool: string; args: unknown; result: unknown; ms: number }
export interface Turn { role: 'user' | 'assistant'; text: string; toolCalls?: ToolCall[]; model?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  seedDemo: () => call<{ accounts: AccountRef[] }>('/api/demo', { method: 'POST' }),
  findAccounts: (owner: string) => call<AccountRef[]>(`/api/accounts?owner=${encodeURIComponent(owner)}`),
  chat: (accountId: string, messages: Turn[]) =>
    call<{ answer: string; toolCalls: ToolCall[]; provider: string; model: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId, messages: messages.map(({ role, text }) => ({ role, text })) }),
    }),
};
