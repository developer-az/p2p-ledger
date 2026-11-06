import { randomUUID } from 'node:crypto';


export type RequestStatus = 'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED';

/**
 * Where an outside settlement happened. The request book stays rail-agnostic:
 * Zelle, Cash App, cash and crypto all settle the same way today, and a future
 * rail integration replaces the note with a real money movement — see docs/PRODUCT.md.
 */
export const SETTLE_RAILS = ['zelle', 'cashapp', 'venmo', 'cash', 'crypto', 'other'] as const;
export type SettleRail = (typeof SETTLE_RAILS)[number];

/** "Sam asks Anthony for $18.00 for Uber." Money only moves when the payer accepts. */
export interface PaymentRequest {
  id: string;
  requesterAccountId: string;
  payerAccountId: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
  status: RequestStatus;
  /** The ledger transfer that settled this request, once paid in-app. */
  transferId: string | null;
  /** Set when the requester recorded an outside settlement (Zelle, cash, …). */
  settledVia: SettleRail | null;
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
   * so two racing clicks cannot both win. `settledVia` marks an outside settlement.
   */
  resolve(
    id: string,
    status: Exclude<RequestStatus, 'PENDING'>,
    transferId: string | null,
    now?: Date,
    settledVia?: SettleRail | null,
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
      settledVia: null,
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
    settledVia: SettleRail | null = null,
  ): Promise<PaymentRequest | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING') return null;
    row.status = status;
    row.transferId = transferId;
    row.settledVia = settledVia;
    row.resolvedAt = now.toISOString();
    return { ...row };
  }
}

// Practice-only. Live workflows and schema migrations belong to ledger-service.
export function createPaymentRequestStore(): PaymentRequestStore {
  return new InMemoryPaymentRequestStore();
}
