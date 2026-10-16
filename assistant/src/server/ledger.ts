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

export interface LedgerEvent {
  eventId: string;
  eventType: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface TransferTrail {
  transfer: Transfer;
  idempotencyKey: string;
  requestHash: string;
  entries: LedgerEntry[];
  events: LedgerEvent[];
}

export interface Integrity {
  checkedAt: string;
  entryCount: number;
  entriesSumMinor: number;
  transferCount: number;
  unbalancedTransfers: number;
  rejectedWithEntries: number;
  accountCount: number;
  accountsDrifted: number;
  outbox: { total: number; pending: number; oldestPendingAt: string | null; p95DeliveryMs: number | null };
  balanced: boolean;
  /** Set by the BFF when serving composite ledger integrity. */
  source?: 'live' | 'practice';
}

export interface TamperReport {
  transferId: string;
  accountId: string;
  attempts: { attempt: string; sql: string; refused: boolean; databaseSaid: string }[];
}

/** What the ledger answered to a write, including whether it was a replay of a stored result. */
export interface WriteResult {
  status: number;
  replayed: boolean;
  transfer: Transfer;
}

export type TransferRequest = {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: string;
  memo?: string;
};

/** Operator reads and raw writes used by the console. */
export interface LedgerAuditor {
  trail(transferId: string): Promise<TransferTrail | null>;
  integrity(): Promise<Integrity>;
  tamperChecks(transferId: string): Promise<TamperReport | null>;
  postTransfer(req: TransferRequest, idempotencyKey: string): Promise<WriteResult>;
  postDeposit(accountId: string, body: { amountMinor: number; memo?: string }, idempotencyKey: string): Promise<WriteResult>;
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
  transfer(req: TransferRequest, idempotencyKey: string): Promise<Transfer>;
}

export class LedgerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class HttpLedgerClient implements LedgerReader, LedgerWriter, LedgerAuditor {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 20_000,
    private readonly retryDelayMs = 4_000,
  ) {}

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

  trail(transferId: string) {
    return this.getOrNull<TransferTrail>(`/v1/transfers/${encodeURIComponent(transferId)}/trail`);
  }

  integrity() {
    return this.request<Integrity>('GET', '/v1/ledger/integrity');
  }

  async tamperChecks(transferId: string) {
    try {
      return await this.request<TamperReport>('POST', `/v1/ledger/tamper-checks?transferId=${encodeURIComponent(transferId)}`);
    } catch (e) {
      if (e instanceof LedgerError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
  }

  postTransfer(req: TransferRequest, idempotencyKey: string) {
    return this.write('/v1/transfers', req, idempotencyKey);
  }

  postDeposit(accountId: string, body: { amountMinor: number; memo?: string }, idempotencyKey: string) {
    return this.write(`/v1/accounts/${encodeURIComponent(accountId)}/deposits`, body, idempotencyKey);
  }

  private async write(path: string, body: unknown, idempotencyKey: string): Promise<WriteResult> {
    const res = await this.send('POST', path, body, idempotencyKey);
    return {
      status: res.status,
      replayed: res.headers.get('Idempotent-Replayed') === 'true',
      transfer: (await res.json()) as Transfer,
    };
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
    return (await (await this.send(method, path, body, idempotencyKey)).json()) as T;
  }

  /** Writes are safe to retry here because every one carries an idempotency key. */
  private async send(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // Render's gateway returns 502/503 while a sleeping free instance starts.
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new LedgerError(res.status, `Ledger ${method} ${path} failed: ${res.status} ${detail.slice(0, 200)}`);
      }
      return res;
    }
  }
}
