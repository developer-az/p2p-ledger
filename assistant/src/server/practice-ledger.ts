import { randomUUID } from 'node:crypto';
import { RENT_AMOUNT_MINOR, RENT_MEMO } from './demo.js';
import type { Account, LedgerEntry, LedgerReader, LedgerWriter, Transfer } from './ledger.js';
import { personaForOwner } from './personas.js';

export const PRACTICE_ALEX = '01111111-1111-7111-8111-111111111101';
export const PRACTICE_SAM = '01111111-1111-7111-8111-111111111102';
export const PRACTICE_JORDAN = '01111111-1111-7111-8111-111111111103';
const FUNDING = '00000000-0000-7000-8000-000000000001';
export const PRACTICE_RENT_TRANSFER = '01111111-1111-7111-8111-111111111201';

const NEW_ACCOUNT_LIMIT_MINOR = 100_000;
const NEW_ACCOUNT_MAX_AGE_MS = 86_400_000;
const VELOCITY_MAX = 5;
const VELOCITY_WINDOW_MS = 60_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function buildPracticeData(): { accounts: Account[]; transfers: Transfer[] } {
  const accounts: Account[] = [
    {
      id: PRACTICE_ALEX,
      ownerId: 'alex',
      currency: 'USD',
      type: 'USER',
      balanceMinor: 344_951,
      createdAt: daysAgo(1),
    },
    {
      id: PRACTICE_SAM,
      ownerId: 'sam',
      currency: 'USD',
      type: 'USER',
      balanceMinor: 272_450,
      createdAt: daysAgo(30),
    },
    {
      id: PRACTICE_JORDAN,
      ownerId: 'jordan',
      currency: 'USD',
      type: 'USER',
      balanceMinor: 2_599,
      createdAt: daysAgo(30),
    },
    {
      id: FUNDING,
      ownerId: 'system:funding',
      currency: 'USD',
      type: 'SYSTEM',
      balanceMinor: -10_000_000,
      createdAt: daysAgo(365),
    },
  ];

  const transfer = (
    id: string,
    from: string,
    to: string,
    amountMinor: number,
    createdAt: string,
    memo: string | null,
    rejectionReason: string | null = null,
    kind: Transfer['kind'] = 'TRANSFER',
  ): Transfer => ({
    id,
    kind,
    sourceAccountId: from,
    destinationAccountId: to,
    amountMinor,
    currency: 'USD',
    memo,
    status: rejectionReason ? 'REJECTED' : 'COMPLETED',
    rejectionReason,
    createdAt,
  });

  const transfers: Transfer[] = [
    transfer('p-dep-alex', FUNDING, PRACTICE_ALEX, 500_000, daysAgo(1), 'Added from bank', null, 'DEPOSIT'),
    transfer('p-dep-sam', FUNDING, PRACTICE_SAM, 120_000, daysAgo(20), 'Added from bank', null, 'DEPOSIT'),
    transfer('p-pizza', PRACTICE_ALEX, PRACTICE_SAM, 4_250, daysAgo(6), 'Pizza night'),
    transfer(
      PRACTICE_RENT_TRANSFER,
      PRACTICE_ALEX,
      PRACTICE_JORDAN,
      RENT_AMOUNT_MINOR,
      daysAgo(5),
      RENT_MEMO,
      'NEW_ACCOUNT_LARGE_TRANSFER',
    ),
    transfer('p-uber', PRACTICE_SAM, PRACTICE_ALEX, 1_800, daysAgo(4), 'Uber split'),
    transfer('p-concert', PRACTICE_ALEX, PRACTICE_SAM, 150_000, daysAgo(3), 'Concert tickets — team offsite', 'VELOCITY_LIMIT'),
    transfer('p-groceries', PRACTICE_ALEX, PRACTICE_JORDAN, 2_599, daysAgo(2), 'Groceries'),
    transfer('p-util', PRACTICE_ALEX, PRACTICE_JORDAN, 8_900, daysAgo(8), 'Utilities · electric + water'),
    transfer('p-reimb', PRACTICE_SAM, PRACTICE_ALEX, 22_500, daysAgo(7), 'Reimbursement · team offsite travel'),
  ];

  return { accounts, transfers };
}

export interface PracticeBootstrapAccount {
  id: string;
  owner: string;
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

/** In-memory ledger with the same read/write surface as ledger-service (simplified rules). */
export class PracticeLedger implements LedgerReader, LedgerWriter {
  private accounts: Account[];
  private transfers: Transfer[];
  private readonly idempotency = new Map<string, Transfer>();

  constructor() {
    const data = buildPracticeData();
    this.accounts = data.accounts.map((a) => ({ ...a }));
    this.transfers = [...data.transfers];
  }

  bootstrap(): PracticeBootstrap {
    return {
      mode: 'practice',
      accounts: this.userAccounts().map((a) => {
        const p = personaForOwner(a.ownerId);
        return { id: a.id, owner: a.ownerId, role: p.role, blurb: p.blurb };
      }),
      focusAccountId: PRACTICE_ALEX,
      stoppedTransferId: PRACTICE_RENT_TRANSFER,
      hint: 'Practice network — same fraud story as live seed; statement tab shows double-entry lines.',
    };
  }

  listPeers(exceptAccountId: string): { id: string; owner: string }[] {
    return this.userAccounts()
      .filter((a) => a.id !== exceptAccountId)
      .map((a) => ({ id: a.id, owner: a.ownerId }));
  }

  isPracticeAccount(id: string): boolean {
    return this.accounts.some((a) => a.id === id);
  }

  private userAccounts(): Account[] {
    return this.accounts.filter((a) => a.type === 'USER');
  }

  private account(id: string): Account | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  async getAccount(id: string) {
    return this.account(id) ?? null;
  }

  async accountsByOwner(ownerId: string) {
    return this.accounts.filter((a) => a.ownerId === ownerId && a.type === 'USER');
  }

  async getTransfer(id: string) {
    return this.transfers.find((t) => t.id === id) ?? null;
  }

  async transfersForAccount(accountId: string, limit: number) {
    return this.transfers
      .filter((t) => t.sourceAccountId === accountId || t.destinationAccountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async entries(accountId: string, limit: number): Promise<LedgerEntry[]> {
    const account = this.account(accountId);
    if (!account) return [];
    const lines: LedgerEntry[] = [];
    let seq = 1;
    let balance = 0;
    const related = this.transfers
      .filter((t) => t.sourceAccountId === accountId || t.destinationAccountId === accountId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const t of related) {
      if (t.status !== 'COMPLETED') continue;
      let delta = 0;
      if (t.kind === 'DEPOSIT' && t.destinationAccountId === accountId) {
        delta = t.amountMinor;
      } else if (t.sourceAccountId === accountId) {
        delta = -t.amountMinor;
      } else if (t.destinationAccountId === accountId) {
        delta = t.amountMinor;
      }
      if (delta === 0) continue;
      balance += delta;
      lines.push({
        id: seq++,
        transferId: t.id,
        accountId,
        amountMinor: delta,
        balanceAfterMinor: balance,
        createdAt: t.createdAt,
      });
    }
    return lines.slice(-limit).reverse();
  }

  async openAccount(ownerId: string, currency: string): Promise<Account> {
    const account: Account = {
      id: randomUUID(),
      ownerId,
      currency,
      type: 'USER',
      balanceMinor: 0,
      createdAt: new Date().toISOString(),
    };
    this.accounts.push(account);
    return account;
  }

  async deposit(accountId: string, amountMinor: number, idempotencyKey: string): Promise<Transfer> {
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) return cached;
    const dest = this.account(accountId);
    if (!dest || dest.type !== 'USER') throw new Error('Account not found');
    const row: Transfer = {
      id: randomUUID(),
      kind: 'DEPOSIT',
      sourceAccountId: FUNDING,
      destinationAccountId: accountId,
      amountMinor,
      currency: dest.currency,
      memo: 'Bank deposit',
      status: 'COMPLETED',
      rejectionReason: null,
      createdAt: new Date().toISOString(),
    };
    dest.balanceMinor += amountMinor;
    this.transfers.push(row);
    this.idempotency.set(idempotencyKey, row);
    return row;
  }

  async transfer(
    req: { sourceAccountId: string; destinationAccountId: string; amountMinor: number; currency: string; memo?: string },
    idempotencyKey: string,
  ): Promise<Transfer> {
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) return cached;

    const source = this.account(req.sourceAccountId);
    const dest = this.account(req.destinationAccountId);
    if (!source || !dest || source.type !== 'USER' || dest.type !== 'USER') {
      throw new Error('Account not found');
    }

    let rejection: string | null = null;
    const age = Date.now() - Date.parse(source.createdAt);
    const recentSends = this.transfers.filter(
      (t) => t.sourceAccountId === req.sourceAccountId
        && t.kind === 'TRANSFER'
        && Date.now() - Date.parse(t.createdAt) < VELOCITY_WINDOW_MS,
    ).length;
    if (recentSends >= VELOCITY_MAX) {
      rejection = 'VELOCITY_LIMIT';
    } else if (age < NEW_ACCOUNT_MAX_AGE_MS && req.amountMinor > NEW_ACCOUNT_LIMIT_MINOR) {
      rejection = 'NEW_ACCOUNT_LARGE_TRANSFER';
    } else if (source.balanceMinor < req.amountMinor) {
      rejection = 'INSUFFICIENT_FUNDS';
    }

    const row: Transfer = {
      id: randomUUID(),
      kind: 'TRANSFER',
      sourceAccountId: req.sourceAccountId,
      destinationAccountId: req.destinationAccountId,
      amountMinor: req.amountMinor,
      currency: req.currency,
      memo: req.memo ?? null,
      status: rejection ? 'REJECTED' : 'COMPLETED',
      rejectionReason: rejection,
      createdAt: new Date().toISOString(),
    };

    if (!rejection) {
      source.balanceMinor -= req.amountMinor;
      dest.balanceMinor += req.amountMinor;
    }

    this.transfers.push(row);
    this.idempotency.set(idempotencyKey, row);
    return row;
  }
}

export class CompositeLedger implements LedgerReader, LedgerWriter {
  constructor(
    private readonly live: LedgerReader & LedgerWriter,
    private readonly practice: PracticeLedger,
    private readonly liveAvailable: () => Promise<boolean>,
  ) {}

  async getAccount(id: string) {
    const practiceAccount = await this.practice.getAccount(id);
    if (practiceAccount) return practiceAccount;
    return this.live.getAccount(id);
  }

  async accountsByOwner(ownerId: string) {
    const fromPractice = await this.practice.accountsByOwner(ownerId);
    const fromLive = await this.live.accountsByOwner(ownerId);
    const seen = new Set<string>();
    return [...fromPractice, ...fromLive].filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }

  async getTransfer(id: string) {
    const practiceTransfer = await this.practice.getTransfer(id);
    if (practiceTransfer) return practiceTransfer;
    return this.live.getTransfer(id);
  }

  async transfersForAccount(accountId: string, limit: number) {
    const practiceAccount = await this.practice.getAccount(accountId);
    if (practiceAccount) return this.practice.transfersForAccount(accountId, limit);
    return this.live.transfersForAccount(accountId, limit);
  }

  async entries(accountId: string, limit: number) {
    const practiceAccount = await this.practice.getAccount(accountId);
    if (practiceAccount) return this.practice.entries(accountId, limit);
    return this.live.entries(accountId, limit);
  }

  async openAccount(ownerId: string, currency: string) {
    if (await this.liveAvailable()) return this.live.openAccount(ownerId, currency);
    return this.practice.openAccount(ownerId, currency);
  }

  async deposit(accountId: string, amountMinor: number, idempotencyKey: string) {
    if (await this.practice.getAccount(accountId)) {
      return this.practice.deposit(accountId, amountMinor, idempotencyKey);
    }
    return this.live.deposit(accountId, amountMinor, idempotencyKey);
  }

  async transfer(req: Parameters<LedgerWriter['transfer']>[0], idempotencyKey: string) {
    if (await this.practice.getAccount(req.sourceAccountId)) {
      return this.practice.transfer(req, idempotencyKey);
    }
    return this.live.transfer(req, idempotencyKey);
  }

  practicePeers(exceptId: string) {
    return this.practice.listPeers(exceptId);
  }

  isPracticeAccount(id: string): boolean {
    return this.practice.isPracticeAccount(id);
  }
}

export async function isLiveLedgerReachable(baseUrl: string, timeoutMs = 2_500): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/actuator/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
