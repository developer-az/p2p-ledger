import { describe, expect, it } from 'vitest';
import { simulateInboundCorridor, welcomeBankPackage } from '../src/server/bank-sim.js';
import type { Account, LedgerWriter, Transfer } from '../src/server/ledger.js';

const FUNDING = '00000000-0000-7000-8000-000000000001';
const USER = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

class SimLedger implements LedgerWriter {
  accounts = new Map<string, Account>([
    [USER, { id: USER, ownerId: 'me', currency: 'USD', type: 'USER', balanceMinor: 0, createdAt: '2026-01-01T00:00:00Z' }],
    [FUNDING, { id: FUNDING, ownerId: 'system:funding', currency: 'USD', type: 'SYSTEM', balanceMinor: 1_000_000_00, createdAt: '2026-01-01T00:00:00Z' }],
  ]);
  transfers: Transfer[] = [];
  private seq = 0;

  async openAccount(ownerId: string, currency: string): Promise<Account> {
    const id = `bbbbbbbb-bbbb-7bbb-8bbb-${String(++this.seq).padStart(12, '0')}`;
    const a: Account = { id, ownerId, currency, type: 'USER', balanceMinor: 0, createdAt: new Date().toISOString() };
    this.accounts.set(id, a);
    return a;
  }

  async deposit(accountId: string, amountMinor: number, _key: string): Promise<Transfer> {
    const t = this.mk('DEPOSIT', FUNDING, accountId, amountMinor, null);
    this.accounts.get(accountId)!.balanceMinor += amountMinor;
    return t;
  }

  async transfer(req: Parameters<LedgerWriter['transfer']>[0], _key: string): Promise<Transfer> {
    const t = this.mk('TRANSFER', req.sourceAccountId, req.destinationAccountId, req.amountMinor, req.memo ?? null);
    this.accounts.get(req.sourceAccountId)!.balanceMinor -= req.amountMinor;
    this.accounts.get(req.destinationAccountId)!.balanceMinor += req.amountMinor;
    return t;
  }

  private mk(kind: Transfer['kind'], from: string, to: string, amountMinor: number, memo: string | null): Transfer {
    const t: Transfer = {
      id: `t-${++this.seq}`,
      kind,
      sourceAccountId: from,
      destinationAccountId: to,
      amountMinor,
      currency: 'USD',
      memo,
      status: 'COMPLETED',
      rejectionReason: null,
      createdAt: new Date().toISOString(),
    };
    this.transfers.push(t);
    return t;
  }
}

describe('bank-sim', () => {
  it('welcome package deposits and creates inbound peer', async () => {
    const ledger = new SimLedger();
    const pack = await welcomeBankPackage(ledger, USER, 50_000);
    expect(pack.corridor.corridor).toBe('inbound');
    expect(ledger.accounts.get(USER)!.balanceMinor).toBeGreaterThan(50_000);
    expect(ledger.transfers.length).toBeGreaterThanOrEqual(2);
  });

  it('inbound corridor opens a new peer account', async () => {
    const ledger = new SimLedger();
    const r = await simulateInboundCorridor(ledger, USER);
    expect(r.peer.owner).toMatch(/^(payroll|client|marketplace|refund|stripe|gig|insurance|taxrefund)-/);
    expect(r.status).toBe('COMPLETED');
  });
});
