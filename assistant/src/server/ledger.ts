/** Typed client for the ledger-service REST API (read paths plus what the demo seeder needs). */

export interface Account {
  id: string;
  ownerId: string;
  currency: string;
  type: 'USER' | 'SYSTEM';
  balanceMinor: number;
  createdAt: string;
}

export interface Transfer {
  id: string;
  kind: 'TRANSFER' | 'DEPOSIT';
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
  status: 'COMPLETED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  transferId: string;
  accountId: string;
  amountMinor: number;
  balanceAfterMinor: number;
  createdAt: string;
}

export interface LedgerReader {
  getAccount(id: string): Promise<Account | null>;
  accountsByOwner(ownerId: string): Promise<Account[]>;
  getTransfer(id: string): Promise<Transfer | null>;
  transfersForAccount(accountId: string, limit: number): Promise<Transfer[]>;
  entries(accountId: string, limit: number): Promise<LedgerEntry[]>;
}

export interface LedgerWriter {
  openAccount(ownerId: string, currency: string): Promise<Account>;
  deposit(accountId: string, amountMinor: number, idempotencyKey: string): Promise<Transfer>;
  transfer(
    req: { sourceAccountId: string; destinationAccountId: string; amountMinor: number; currency: string; memo?: string },
    idempotencyKey: string,
  ): Promise<Transfer>;
}

export class LedgerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class HttpLedgerClient implements LedgerReader, LedgerWriter {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 10_000) {}

  getAccount(id: string) {
    return this.getOrNull<Account>(`/v1/accounts/${encodeURIComponent(id)}`);
  }

  accountsByOwner(ownerId: string) {
    return this.request<Account[]>('GET', `/v1/accounts?ownerId=${encodeURIComponent(ownerId)}`);
  }

  getTransfer(id: string) {
    return this.getOrNull<Transfer>(`/v1/transfers/${encodeURIComponent(id)}`);
  }

  transfersForAccount(accountId: string, limit: number) {
    return this.request<Transfer[]>('GET', `/v1/transfers?accountId=${encodeURIComponent(accountId)}&limit=${limit}`);
  }

  entries(accountId: string, limit: number) {
    return this.request<LedgerEntry[]>('GET', `/v1/accounts/${encodeURIComponent(accountId)}/entries?limit=${limit}`);
  }

  openAccount(ownerId: string, currency: string) {
    return this.request<Account>('POST', '/v1/accounts', { ownerId, currency });
  }

  deposit(accountId: string, amountMinor: number, idempotencyKey: string) {
    return this.request<Transfer>('POST', `/v1/accounts/${encodeURIComponent(accountId)}/deposits`,
      { amountMinor }, idempotencyKey);
  }

  transfer(req: Parameters<LedgerWriter['transfer']>[0], idempotencyKey: string) {
    return this.request<Transfer>('POST', '/v1/transfers', req, idempotencyKey);
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>('GET', path);
    } catch (e) {
      // 400 covers a malformed id, which the model may well produce.
      if (e instanceof LedgerError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LedgerError(res.status, `Ledger ${method} ${path} failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
