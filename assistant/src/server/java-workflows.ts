import { randomUUID } from 'node:crypto';
import { LedgerError, type Transfer } from './ledger.js';
import type { PaymentRequest } from './payment-requests.js';
import type { RecordSpendInput, SpendCursorPage, SpendLogEntry, SpendLogStore } from './spend-log.js';

/** Transport only: Java owns live request validation, persistence, and settlement. */
export class JavaWorkflows {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 20_000) {}

  private readyUntil = 0;
  async assertReady(): Promise<void> {
    if (Date.now() < this.readyUntil) return;
    const capabilities = await this.request<{ workflows?: number }>('GET', '/v1/capabilities');
    if (capabilities.workflows !== 2) throw new LedgerError(503, 'Your wallet connection is being updated. Try again shortly.');
    this.readyUntil = Date.now() + 30_000;
  }

  async request<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
    let res: Response;
    try { res = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Ledger-Key': this.apiKey, ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    }); } catch {
      throw new LedgerError(503, 'Your wallet connection is unavailable. Try again shortly.');
    }
    if (!res.ok) {
      // Do not expose Java stack details or upstream infrastructure to the browser.
      const problem = await res.json().catch(() => ({})) as { detail?: string };
      if ((res.status === 404 && (path === '/v1/capabilities' || problem.detail?.startsWith('No static resource'))) || res.status === 401 || res.status >= 500)
        throw new LedgerError(503, 'Your wallet connection is unavailable. Try again shortly.');
      throw new LedgerError(res.status, problem.detail ?? 'The ledger workflow is unavailable. Try again shortly.');
    }
    return await res.json() as T;
  }
  split(body: { requesterAccountId: string; payers: { accountId: string; amountMinor: number }[]; memo?: string }, key: string) {
    return this.request<{ requests: PaymentRequest[] }>('POST', '/v1/requests', body, key);
  }
  async get(id: string): Promise<PaymentRequest | null> {
    try { return await this.request<PaymentRequest>('GET', `/v1/requests/${encodeURIComponent(id)}`); }
    catch (e) { if (e instanceof LedgerError && e.status === 404) return null; throw e; }
  }
  list(accountId: string) { return this.request<PaymentRequest[]>('GET', `/v1/requests?accountId=${encodeURIComponent(accountId)}&limit=60`); }
  pay(id: string, accountId: string, key: string) {
    return this.request<{ request: PaymentRequest; transfer: Transfer }>('POST', `/v1/requests/${encodeURIComponent(id)}/pay`, { accountId }, key);
  }
  resolve(id: string, action: string, accountId: string, settledVia?: string) {
    return this.request<{ request: PaymentRequest }>('POST', `/v1/requests/${encodeURIComponent(id)}/${action}`, { accountId, settledVia });
  }
  receipt(id: string) { return this.request<unknown>('GET', `/v1/transfers/${encodeURIComponent(id)}/receipt`); }
  importSpends(accountId: string, csv: string, timeZone?: string) {
    return this.request<{ imported: number; duplicates: number; rows: number }>('POST', `/v1/accounts/${encodeURIComponent(accountId)}/spends/import`, { csv, timeZone });
  }
}

/** Java pages newest-first by (occurredAt, id); the cursor carries both. */
function encodeSpendCursor(row: SpendLogEntry): string {
  return Buffer.from(JSON.stringify({
    before: row.occurredAt,
    beforeId: row.id,
  }), 'utf8').toString('base64url');
}

function decodeSpendCursor(cursor: string): { before: string; beforeId: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      before?: unknown;
      beforeId?: unknown;
    };
    if (typeof parsed.before !== 'string' || typeof parsed.beforeId !== 'string') return null;
    if (!parsed.before || !parsed.beforeId) return null;
    return { before: parsed.before, beforeId: parsed.beforeId };
  } catch {
    return null;
  }
}

/** There is no live-to-memory fallback: a Java outage must not acknowledge a lost expense. */
export class RoutedSpendLogStore implements SpendLogStore {
  constructor(private readonly practice: SpendLogStore, private readonly java: JavaWorkflows,
    private readonly isPractice: (accountId: string) => boolean) {}

  record(accountId: string, input: RecordSpendInput, now?: Date, key?: string): Promise<SpendLogEntry> {
    if (this.isPractice(accountId)) return this.practice.record(accountId, input, now);
    return this.java.request('POST', `/v1/accounts/${encodeURIComponent(accountId)}/spends`,
      input, key ?? randomUUID());
  }
  list(accountId: string, opts?: { since?: Date; limit?: number }): Promise<SpendLogEntry[]> {
    if (this.isPractice(accountId)) return this.practice.list(accountId, opts);
    const params = new URLSearchParams({ limit: String(opts?.limit ?? 100) });
    if (opts?.since) params.set('since', opts.since.toISOString());
    return this.java.request('GET', `/v1/accounts/${encodeURIComponent(accountId)}/spends?${params}`);
  }
  async listSpendPage(accountId: string, afterId: string | null, limit: number, since?: Date): Promise<SpendLogEntry[]> {
    if (this.isPractice(accountId)) return this.practice.listSpendPage(accountId, afterId, limit, since);
    // The old signature cannot carry the timestamp half of the Java keyset. It
    // accepts an opaque cursor too, and an unrecognised id means "no more rows".
    return (await this.listSpendCursorPage(accountId, afterId, limit, since)).rows;
  }
  async listSpendCursorPage(accountId: string, cursor: string | null, limit: number, since?: Date): Promise<SpendCursorPage> {
    if (this.isPractice(accountId)) return this.practice.listSpendCursorPage(accountId, cursor, limit, since);
    const pageSize = Math.min(500, Math.max(1, limit));
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (since) params.set('since', since.toISOString());
    if (cursor !== null) {
      const decoded = decodeSpendCursor(cursor);
      if (!decoded) return { rows: [], next: null };
      params.set('before', decoded.before);
      params.set('beforeId', decoded.beforeId);
    }
    const rows = await this.java.request<SpendLogEntry[]>(
      'GET', `/v1/accounts/${encodeURIComponent(accountId)}/spends?${params}`,
    );
    const tail = rows[rows.length - 1];
    return {
      rows,
      next: rows.length < pageSize || !tail ? null : encodeSpendCursor(tail),
    };
  }
  listPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]> {
    return this.listSpendPage(accountId, afterId, limit);
  }
  async remove(accountId: string, id: string): Promise<boolean> {
    if (this.isPractice(accountId)) return this.practice.remove(accountId, id);
    const result = await this.java.request<{ removed: boolean }>('DELETE', `/v1/accounts/${encodeURIComponent(accountId)}/spends/${encodeURIComponent(id)}`);
    return result.removed;
  }
}
