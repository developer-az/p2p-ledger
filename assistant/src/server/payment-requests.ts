import { randomUUID } from 'node:crypto';
import { databaseUrlFromEnv } from './integrity-postgres.js';

export type RequestStatus = 'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED';

/** "Sam asks Alex for $18.00 for Uber." Money only moves when the payer accepts. */
export interface PaymentRequest {
  id: string;
  requesterAccountId: string;
  payerAccountId: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
  status: RequestStatus;
  /** The ledger transfer that settled this request, once paid. */
  transferId: string | null;
  /**
   * How many times the ledger declined a payment attempt. It is part of the idempotency key:
   * a double click shares one key (so money moves once), but a decline is stored under its key
   * forever, so the next attempt after the payer adds funds must use a fresh one.
   */
  declinedAttempts: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NewPaymentRequest {
  requesterAccountId: string;
  payerAccountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
}

export interface PaymentRequestStore {
  create(input: NewPaymentRequest, now?: Date): Promise<PaymentRequest>;
  get(id: string): Promise<PaymentRequest | null>;
  /** Requests where the account is the requester or the payer, newest first. */
  listFor(accountId: string, limit?: number): Promise<PaymentRequest[]>;
  /** Records a declined payment attempt and returns the new count. */
  noteDecline(id: string): Promise<number>;
  /**
   * Moves a PENDING request to a final status. Returns null if it was already resolved,
   * so two racing clicks cannot both win.
   */
  resolve(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    transferId: string | null,
    now?: Date,
  ): Promise<PaymentRequest | null>;
}

export class InMemoryPaymentRequestStore implements PaymentRequestStore {
  private readonly rows = new Map<string, PaymentRequest>();

  async create(input: NewPaymentRequest, now = new Date()): Promise<PaymentRequest> {
    const row: PaymentRequest = {
      id: randomUUID(),
      requesterAccountId: input.requesterAccountId,
      payerAccountId: input.payerAccountId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      memo: input.memo ?? null,
      status: 'PENDING',
      transferId: null,
      declinedAttempts: 0,
      createdAt: now.toISOString(),
      resolvedAt: null,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async get(id: string): Promise<PaymentRequest | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async listFor(accountId: string, limit = 50): Promise<PaymentRequest[]> {
    return [...this.rows.values()]
      .filter((r) => r.requesterAccountId === accountId || r.payerAccountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async noteDecline(id: string): Promise<number> {
    const row = this.rows.get(id);
    if (!row) return 0;
    row.declinedAttempts += 1;
    return row.declinedAttempts;
  }

  async resolve(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    transferId: string | null,
    now = new Date(),
  ): Promise<PaymentRequest | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING') return null;
    row.status = status;
    row.transferId = transferId;
    row.resolvedAt = now.toISOString();
    return { ...row };
  }
}

const SCHEMA_SQL = `
create table if not exists payment_requests (
    id                   uuid primary key,
    requester_account_id uuid        not null,
    payer_account_id     uuid        not null,
    amount_minor         bigint      not null check (amount_minor > 0),
    currency             char(3)     not null default 'USD',
    memo                 text,
    status               text        not null default 'PENDING'
                         check (status in ('PENDING', 'PAID', 'DECLINED', 'CANCELLED')),
    transfer_id          uuid,
    declined_attempts    int         not null default 0,
    created_at           timestamptz not null default now(),
    resolved_at          timestamptz,
    constraint request_distinct_accounts check (requester_account_id <> payer_account_id)
);
create index if not exists payment_requests_requester_idx on payment_requests (requester_account_id, created_at desc);
create index if not exists payment_requests_payer_idx on payment_requests (payer_account_id, created_at desc);
`;

type Row = Record<string, unknown>;

function fromRow(row: Row): PaymentRequest {
  return {
    id: String(row.id),
    requesterAccountId: String(row.requester_account_id),
    payerAccountId: String(row.payer_account_id),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    memo: (row.memo as string | null) ?? null,
    status: row.status as RequestStatus,
    transferId: row.transfer_id ? String(row.transfer_id) : null,
    declinedAttempts: Number(row.declined_attempts ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
  };
}

const COLUMNS =
  'id, requester_account_id, payer_account_id, amount_minor, currency, memo, status, transfer_id, declined_attempts, created_at, resolved_at';

/** Same database as the ledger, but a separate table the ledger service never reads. */
export class PostgresPaymentRequestStore implements PaymentRequestStore {
  private schemaReady = false;

  constructor(private readonly connectionString: string) {}

  private async client() {
    const { default: pg } = await import('pg');
    const ssl = /supabase|sslmode=require/i.test(this.connectionString) ? { rejectUnauthorized: false } : undefined;
    const client = new pg.Client({ connectionString: this.connectionString, ssl });
    await client.connect();
    if (!this.schemaReady) {
      await client.query(SCHEMA_SQL);
      this.schemaReady = true;
    }
    return client;
  }

  async create(input: NewPaymentRequest, now = new Date()): Promise<PaymentRequest> {
    const id = randomUUID();
    const c = await this.client();
    try {
      const res = await c.query(
        `insert into payment_requests
           (id, requester_account_id, payer_account_id, amount_minor, currency, memo, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${COLUMNS}`,
        [id, input.requesterAccountId, input.payerAccountId, input.amountMinor, input.currency, input.memo ?? null, now.toISOString()],
      );
      return fromRow(res.rows[0] as Row);
    } finally {
      await c.end();
    }
  }

  async get(id: string): Promise<PaymentRequest | null> {
    const c = await this.client();
    try {
      const res = await c.query(`select ${COLUMNS} from payment_requests where id = $1`, [id]);
      return res.rows[0] ? fromRow(res.rows[0] as Row) : null;
    } finally {
      await c.end();
    }
  }

  async listFor(accountId: string, limit = 50): Promise<PaymentRequest[]> {
    const c = await this.client();
    try {
      const res = await c.query(
        `select ${COLUMNS} from payment_requests
         where requester_account_id = $1 or payer_account_id = $1
         order by created_at desc limit $2`,
        [accountId, Math.min(limit, 200)],
      );
      return res.rows.map((r: Row) => fromRow(r));
    } finally {
      await c.end();
    }
  }

  async noteDecline(id: string): Promise<number> {
    const c = await this.client();
    try {
      const res = await c.query(
        'update payment_requests set declined_attempts = declined_attempts + 1 where id = $1 returning declined_attempts',
        [id],
      );
      return Number((res.rows[0] as Row | undefined)?.declined_attempts ?? 0);
    } finally {
      await c.end();
    }
  }

  async resolve(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    transferId: string | null,
    now = new Date(),
  ): Promise<PaymentRequest | null> {
    const c = await this.client();
    try {
      // The status guard in the WHERE clause is what makes a double click safe.
      const res = await c.query(
        `update payment_requests set status = $2, transfer_id = $3, resolved_at = $4
         where id = $1 and status = 'PENDING'
         returning ${COLUMNS}`,
        [id, status, transferId, now.toISOString()],
      );
      return res.rows[0] ? fromRow(res.rows[0] as Row) : null;
    } finally {
      await c.end();
    }
  }
}

export function createPaymentRequestStore(env: NodeJS.ProcessEnv = process.env): PaymentRequestStore {
  const url = databaseUrlFromEnv(env);
  return url ? new PostgresPaymentRequestStore(url) : new InMemoryPaymentRequestStore();
}
