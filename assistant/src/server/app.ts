import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { runAssistant, type AssistantReply } from './agent.js';
import { booksCheck, paymentTrail, racePayment, replayPayment, tamperWithPayment } from './console.js';
import { seedDemo } from './demo.js';
import { seedDemoHabits, type DemoPersona } from './demo-habits.js';
import { normalizeProviderId } from './env-normalize.js';
import { answerFromLedger } from './fallback.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from './ledger.js';
import { isModelOutage } from './providers/retry.js';
import type { LlmProvider } from './providers/types.js';
import { PRACTICE_ALEX, PRACTICE_JORDAN, PRACTICE_SAM, type CompositeLedger, type PracticeLedger } from './practice-ledger.js';
import { LEDGER_CAPABILITIES } from './personas.js';
import { formatLedgerStatement } from './statement-export.js';
import {
  bankSimulatorStatus,
  simulateInboundCorridor,
  simulateOutboundCorridor,
  welcomeBankPackage,
} from './bank-sim.js';
import { peerLedgerView } from './peer-ledger.js';
import { buildActivityFeed, buildPersonalInsights } from './money-insights.js';
import { buildHabitsFromEntries, buildHabitsHome, SPEND_CATEGORIES, type SpendLogStore } from './spend-log.js';
import { buildSpendingPatterns } from './spending-patterns.js';
import {
  buildFinanceSnapshot,
  INCOME_SOURCES,
  InMemoryPersonalFinanceStore,
  type PersonalFinanceStore,
} from './personal-finance.js';
import { formatMoney } from './money.js';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import { loadAccountView } from './tools.js';
import {
  InMemoryPaymentRequestStore,
  type PaymentRequest,
  type PaymentRequestStore,
} from './payment-requests.js';
import { explainDecline } from './peer-ledger.js';
import { providerFromEnv } from './providers/index.js';
import { MAX_MINOR_UI } from './money.js';
import { LlmGuard, trimHistory } from './llm-guard.js';
import { SETTLE_RAILS, type SettleRail } from './payment-requests.js';

const openAccountBody = z.object({
  ownerId: z.string().min(1).max(64),
  currency: z.string().length(3).default('USD'),
});

const depositBody = z.object({ amountMinor: z.number().int().positive().max(MAX_MINOR_UI) });
const transferBody = z.object({
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  currency: z.string().length(3).default('USD'),
  memo: z.string().max(200).optional(),
});

const chatBody = z.object({
  accountId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(2000),
  })).min(1).max(20).refine((m) => m.at(-1)?.role === 'user', 'Last message must be from the user'),
});

const requestBody = z.object({
  requesterAccountId: z.string().uuid(),
  memo: z.string().max(140).optional(),
  payers: z.array(z.object({
    accountId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  })).min(1).max(8),
});
const requestActorBody = z.object({ accountId: z.string().uuid() });
/** The requester confirms money arrived outside the app: "paid me on Zelle". */
const requestSettleBody = z.object({
  accountId: z.string().uuid(),
  settledVia: z.enum(SETTLE_RAILS),
});

const paymentBody = z.object({ accountId: z.string().uuid(), transferId: z.string().uuid() });
const raceBody = z.object({ accountId: z.string().uuid(), fromAccountId: z.string().uuid() });

const recordSpendBody = z.object({
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  category: z.enum(SPEND_CATEGORIES),
  note: z.string().max(140).optional(),
  occurredAt: z.string().datetime().optional(),
});

const financePatchBody = z.object({
  walletCashMinor: z.number().int().min(0).max(MAX_MINOR_UI).nullable().optional(),
  creditOwedMinor: z.number().int().min(0).max(MAX_MINOR_UI).optional(),
  weeklyBudgetMinor: z.number().int().min(0).max(MAX_MINOR_UI).nullable().optional(),
  spendLogsAffectWallet: z.boolean().optional(),
});

const recordIncomeBody = z.object({
  amountMinor: z.number().int().positive().max(MAX_MINOR_UI),
  source: z.enum(INCOME_SOURCES),
  note: z.string().max(140).optional(),
  occurredAt: z.string().datetime().optional(),
});

/** Fixed-window limiter per client IP: protects the free LLM quota from one noisy visitor. */
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}

export function createApp(deps: {
  ledger: CompositeLedger;
  practice: PracticeLedger;
  spendLogs: SpendLogStore;
  personalFinance?: PersonalFinanceStore;
  paymentRequests?: PaymentRequestStore;
  liveLedger?: LedgerWriter & LedgerAuditor;
  isLiveLedgerUp?: () => Promise<boolean>;
  /** Tests inject a fake model; production loads Gemini/Claude on first chat only. */
  provider?: () => LlmProvider;
  /** Tests inject a guard with a frozen clock; production builds one per app instance. */
  llmGuard?: LlmGuard;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const personalFinance = deps.personalFinance ?? new InMemoryPersonalFinanceStore();
  const paymentRequests = deps.paymentRequests ?? new InMemoryPaymentRequestStore();
  const llmGuard = deps.llmGuard ?? new LlmGuard();
  const app = new Hono().basePath('/api');
  const allowChat = rateLimiter(20, 60_000);
  const allowSeed = rateLimiter(3, 60_000);
  const allowWrite = rateLimiter(40, 60_000);
  const allowProof = rateLimiter(12, 60_000);
  const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/bootstrap', async (c) => {
    const practice = deps.practice.bootstrap();
    let live = false;
    let auditCapabilities = false;
    if (deps.isLiveLedgerUp) {
      live = await Promise.race([
        deps.isLiveLedgerUp(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (live && deps.liveLedger) {
        auditCapabilities = true;
      }
    }
    let chat: {
      provider: string;
      configured: boolean;
      model?: string;
      configHint?: string;
    } = { provider: normalizeProviderId(process.env.LLM_PROVIDER), configured: false };
    try {
      const p = providerFromEnv();
      chat = { provider: p.name, configured: true, model: p.model };
    } catch (e) {
      chat.configured = false;
      chat.configHint = llmConfigError(e);
    }
    return c.json({
      live,
      practice,
      ledger: {
        engine: 'ledger-service',
        apiVersion: 'v1',
        capabilities: [...LEDGER_CAPABILITIES],
        persistence: live
          ? `Accounts and transfers persist in PostgreSQL (Render).${
            databaseUrlFromEnv() ? ' Habit logs persist in spend_logs on the same database.' : ''
          } Bookmark ?id= or use saved wallets below.`
          : 'Practice mode is in-memory per server instance — use live seed or create wallet while ledger is online.',
        auditCapabilities,
      },
      chat,
    });
  });

  app.get('/accounts', async (c) => {
    const id = c.req.query('id');
    const limit = Number(c.req.query('limit') ?? '30');
    if (id) return respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, id, Math.min(limit, 100), now, tzOffsetFrom(c)));
    const owner = c.req.query('owner');
    if (!owner) return c.json({ error: 'owner is required' }, 400);
    const accounts = await deps.ledger.accountsByOwner(owner);
    return c.json(accounts.map((a) => ({ id: a.id, owner: a.ownerId })));
  });

  app.post('/accounts', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = openAccountBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const account = await deps.ledger.openAccount(parsed.data.ownerId, parsed.data.currency);
    return c.json({ id: account.id, owner: account.ownerId }, 201);
  });

  app.get('/peers', async (c) => {
    const accountId = c.req.query('accountId');
    if (!accountId || !z.string().uuid().safeParse(accountId).success) {
      return c.json({ error: 'accountId is required' }, 400);
    }
    const peers = await listPeers(deps.ledger, accountId);
    return c.json(peers);
  });

  app.get('/peer-ledger', async (c) => {
    const accountId = c.req.query('accountId');
    const peerId = c.req.query('peerId');
    if (!accountId || !peerId || !z.string().uuid().safeParse(accountId).success || !z.string().uuid().safeParse(peerId).success) {
      return c.json({ error: 'accountId and peerId are required' }, 400);
    }
    const days = Math.min(Number(c.req.query('days') ?? '30'), 365);
    const view = await peerLedgerView(deps.ledger, accountId, peerId, days, 40);
    return view ? c.json(view) : c.json({ error: 'Peer not found' }, 404);
  });

  app.post('/accounts/:id/deposits', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = depositBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const id = c.req.param('id');
    const key = c.req.header('Idempotency-Key') ?? randomUUID();
    try {
      const transfer = await deps.ledger.deposit(id, parsed.data.amountMinor, key);
      return c.json(transfer, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/transfers', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = transferBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const key = c.req.header('Idempotency-Key') ?? randomUUID();
    try {
      const transfer = await deps.ledger.transfer(parsed.data, key);
      return c.json(transfer, 201);
    } catch (e) {
      if (e instanceof LedgerError) return c.json({ error: e.message }, e.status === 404 ? 404 : 400);
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Adds names and display amounts so the UI never has to look accounts up one by one. */
  async function requestView(r: PaymentRequest) {
    const [requester, payer] = await Promise.all([
      deps.ledger.getAccount(r.requesterAccountId),
      deps.ledger.getAccount(r.payerAccountId),
    ]);
    return {
      ...r,
      amount: formatMoney(r.amountMinor, r.currency),
      requester: { id: r.requesterAccountId, owner: requester?.ownerId ?? 'unknown' },
      payer: { id: r.payerAccountId, owner: payer?.ownerId ?? 'unknown' },
    };
  }

  app.post('/requests', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const { requesterAccountId, payers, memo } = parsed.data;
    const requester = await deps.ledger.getAccount(requesterAccountId);
    if (!requester || requester.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const ids = payers.map((p) => p.accountId);
    if (new Set(ids).size !== ids.length) return c.json({ error: 'Each person can be asked once per request' }, 400);
    if (ids.includes(requesterAccountId)) return c.json({ error: 'You cannot ask yourself for money' }, 400);
    for (const p of payers) {
      const payer = await deps.ledger.getAccount(p.accountId);
      if (!payer || payer.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
      if (payer.currency !== requester.currency) return c.json({ error: 'Currencies do not match' }, 400);
    }
    const created = [];
    for (const p of payers) {
      created.push(await requestView(await paymentRequests.create({
        requesterAccountId,
        payerAccountId: p.accountId,
        amountMinor: p.amountMinor,
        currency: requester.currency,
        memo: memo ?? null,
      }, now())));
    }
    return c.json({ requests: created }, 201);
  });

  /** The offline practice household starts with a few open requests so the screen is never empty. */
  let practiceSeeded: Promise<void> | null = null;
  function seedPracticeRequests(): Promise<void> {
    practiceSeeded ??= (async () => {
      if ((await paymentRequests.listFor(PRACTICE_ALEX, 1)).length > 0) return;
      const make = (requester: string, payer: string, amountMinor: number, memo: string) =>
        paymentRequests.create({ requesterAccountId: requester, payerAccountId: payer, amountMinor, currency: 'USD', memo }, now());
      await make(PRACTICE_SAM, PRACTICE_ALEX, 1_850, 'Groceries run');
      await make(PRACTICE_JORDAN, PRACTICE_ALEX, 6_000, 'Utilities share');
      await make(PRACTICE_ALEX, PRACTICE_SAM, 3_500, 'Concert parking');
    })();
    return practiceSeeded;
  }

  app.get('/requests', async (c) => {
    const accountId = c.req.query('accountId');
    if (!accountId || !z.string().uuid().safeParse(accountId).success) {
      return c.json({ error: 'accountId is required' }, 400);
    }
    if (deps.ledger.isPracticeAccount(accountId)) await seedPracticeRequests();
    const rows = await paymentRequests.listFor(accountId, 60);
    const views = await Promise.all(rows.map(requestView));
    return c.json({
      incoming: views.filter((r) => r.payerAccountId === accountId),
      outgoing: views.filter((r) => r.requesterAccountId === accountId),
    });
  });

  /**
   * Pays a request from the payer's wallet. The idempotency key comes from the request itself,
   * so a double click, a retry after a timeout, or two open tabs move the money once.
   */
  app.post('/requests/:id/pay', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestActorBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const request = await paymentRequests.get(c.req.param('id'));
    if (!request) return c.json({ error: 'Request not found' }, 404);
    if (request.payerAccountId !== parsed.data.accountId) return c.json({ error: 'Only the person asked can pay this' }, 403);
    if (request.status !== 'PENDING' && request.status !== 'PAID') {
      return c.json({ error: `This request was ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
    }
    const transfer = await deps.ledger.transfer({
      sourceAccountId: request.payerAccountId,
      destinationAccountId: request.requesterAccountId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      memo: request.memo ?? 'Payment request',
    }, `request-${request.id}-${request.declinedAttempts}`);
    const summary = {
      id: transfer.id,
      status: transfer.status,
      rejectionReason: transfer.rejectionReason,
      declineExplanation: explainDecline(transfer.rejectionReason),
    };
    if (transfer.status === 'REJECTED') {
      await paymentRequests.noteDecline(request.id);
      return c.json({ request: await requestView((await paymentRequests.get(request.id)) ?? request), transfer: summary });
    }
    const resolved = await paymentRequests.resolve(request.id, 'PAID', transfer.id, now());
    const current = resolved ?? (await paymentRequests.get(request.id)) ?? request;
    return c.json({ request: await requestView(current), transfer: summary });
  });

  for (const [action, status, who] of [
    ['decline', 'DECLINED', 'payerAccountId'],
    ['cancel', 'CANCELLED', 'requesterAccountId'],
  ] as const) {
    app.post(`/requests/:id/${action}`, async (c) => {
      if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
      const parsed = requestActorBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
      const request = await paymentRequests.get(c.req.param('id'));
      if (!request) return c.json({ error: 'Request not found' }, 404);
      if (request[who] !== parsed.data.accountId) {
        return c.json({ error: action === 'decline' ? 'Only the person asked can decline' : 'Only the person who asked can cancel' }, 403);
      }
      const resolved = await paymentRequests.resolve(request.id, status, null, now());
      if (!resolved) return c.json({ error: `This request was already ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
      return c.json({ request: await requestView(resolved) });
    });
  }

  /**
   * The wedge: settle a request over any rail. The requester confirms the money
   * arrived outside the app (Zelle, Cash App, cash, crypto…), the request closes,
   * and the book keeps the rail on the receipt. No bank integration required.
   */
  app.post('/requests/:id/settle', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = requestSettleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const request = await paymentRequests.get(c.req.param('id'));
    if (!request) return c.json({ error: 'Request not found' }, 404);
    if (request.requesterAccountId !== parsed.data.accountId) {
      return c.json({ error: 'Only the person who asked can record an outside settlement' }, 403);
    }
    const settledVia = parsed.data.settledVia as SettleRail;
    const resolved = await paymentRequests.resolve(request.id, 'PAID', null, now(), settledVia);
    if (!resolved) return c.json({ error: `This request was already ${request.status.toLowerCase()}`, request: await requestView(request) }, 409);
    return c.json({ request: await requestView(resolved) });
  });

  // Direct links. The UI uses ?id= so a host that 404s a second path segment still reaches this app.
  app.get('/accounts/:id', async (c) => respondAccount(c, await accountView(deps.ledger, deps.spendLogs, personalFinance, c.req.param('id'), 30, now, tzOffsetFrom(c))));

  app.post('/accounts/:id/spends', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = recordSpendBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const event = await deps.spendLogs.record(accountId, {
      ...parsed.data,
      currency: account.currency,
      source: 'manual',
    }, now());
    return c.json({
      id: event.id,
      amountMinor: event.amountMinor,
      category: event.category,
      note: event.note,
      occurredAt: event.occurredAt,
    }, 201);
  });

  app.delete('/accounts/:id/spends/:spendId', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    const spendId = c.req.param('spendId');
    if (!z.string().uuid().safeParse(accountId).success || !z.string().uuid().safeParse(spendId).success) {
      return c.json({ error: 'Invalid id' }, 400);
    }
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const removed = await deps.spendLogs.remove(accountId, spendId);
    if (!removed) return c.json({ error: 'That log was already removed' }, 404);
    return c.json({ removed: true });
  });

  app.get('/accounts/:id/habits', async (c) => {
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const profile = await personalFinance.getProfile(accountId, account.currency, now());
    return c.json(await buildHabitsHome(deps.spendLogs, accountId, now(), account.currency, profile.periodStart));
  });

  app.patch('/accounts/:id/finance', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = financePatchBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const profile = await personalFinance.updateProfile(accountId, account.currency, parsed.data, now());
    const spends = await deps.spendLogs.list(accountId, { limit: 500 });
    const incomes = await personalFinance.listIncome(accountId, { limit: 500 });
    const finance = buildFinanceSnapshot(profile, formatMoney(account.balanceMinor, account.currency), spends, incomes);
    return c.json({ profile, finance });
  });

  app.post('/accounts/:id/finance/rollover', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const profile = await personalFinance.startNewPeriod(accountId, account.currency, now());
    const spends = await deps.spendLogs.list(accountId, { limit: 500 });
    const incomes = await personalFinance.listIncome(accountId, { limit: 500 });
    const finance = buildFinanceSnapshot(profile, formatMoney(account.balanceMinor, account.currency), spends, incomes);
    return c.json({ profile, finance, message: 'New period started. Older logs stay in ACTIVITY; totals below are from now.' });
  });

  app.post('/accounts/:id/incomes', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const accountId = c.req.param('id');
    if (!z.string().uuid().safeParse(accountId).success) return c.json({ error: 'Invalid account id' }, 400);
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const parsed = recordIncomeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    const event = await personalFinance.recordIncome(accountId, {
      ...parsed.data,
      currency: account.currency,
    }, now());
    return c.json({
      id: event.id,
      amountMinor: event.amountMinor,
      source: event.source,
      note: event.note,
      occurredAt: event.occurredAt,
    }, 201);
  });

  app.get('/accounts/:id/entries', async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'Invalid account id' }, 400);
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
    const account = await deps.ledger.getAccount(id);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    const entries = await deps.ledger.entries(id, limit);
    return c.json({ accountId: id, currency: account.currency, entries });
  });

  app.get('/accounts/:id/statement.txt', async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) return c.text('Invalid account id', 400);
    const view = await accountView(deps.ledger, deps.spendLogs, personalFinance, id, 100, now, tzOffsetFrom(c));
    if (!view) return c.text('Account not found', 404);
    const entries = await deps.ledger.entries(id, 200);
    const body = formatLedgerStatement(view, entries, {
      generatedAt: new Date().toISOString(),
      engine: deps.isLiveLedgerUp && (await deps.isLiveLedgerUp()) ? 'ledger-service (PostgreSQL)' : 'practice mirror',
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="statement-${id.slice(0, 8)}.txt"`,
      },
    });
  });

  app.post('/demo', async (c) => {
    if (!allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const live = deps.isLiveLedgerUp ? await deps.isLiveLedgerUp() : false;
    if (!live || !deps.liveLedger) {
      return c.json({
        error: 'The live ledger is not running. Use the guided practice demo below — it works without Docker.',
      }, 503);
    }
    const seeded = await seedDemo(deps.liveLedger);
    const personas: DemoPersona[] = ['alex', 'sam', 'jordan'];
    await Promise.all(seeded.accounts.map((account, i) =>
      seedDemoHabits(deps.spendLogs, personalFinance, account.id, personas[i] ?? 'alex', now())));
    const [alex, sam, jordan] = seeded.accounts;
    if (alex && sam && jordan) {
      const ask = (requester: string, payer: string, amountMinor: number, memo: string) =>
        paymentRequests.create({ requesterAccountId: requester, payerAccountId: payer, amountMinor, currency: 'USD', memo }, now());
      await ask(sam.id, alex.id, 1_850, 'Groceries run');
      await ask(jordan.id, alex.id, 6_000, 'Utilities share');
      await ask(alex.id, sam.id, 3_500, 'Concert parking');
    }
    return c.json(seeded);
  });

  /** Guided demo in practice mode: the fixed household plus a personal history to explore. */
  app.post('/demo/practice', async (c) => {
    if (!allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const boot = deps.practice.bootstrap();
    await Promise.all([
      seedDemoHabits(deps.spendLogs, personalFinance, PRACTICE_ALEX, 'alex', now()),
      seedDemoHabits(deps.spendLogs, personalFinance, PRACTICE_SAM, 'sam', now()),
      seedDemoHabits(deps.spendLogs, personalFinance, PRACTICE_JORDAN, 'jordan', now()),
    ]);
    return c.json({
      accounts: boot.accounts.map(({ id, owner }) => ({ id, owner })),
      focusAccountId: boot.focusAccountId,
      seeded: true,
    });
  });

  app.get('/bank/status', (c) => c.json(bankSimulatorStatus()));

  const bankBody = z.object({ accountId: z.string().uuid() });

  app.post('/bank/welcome', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await welcomeBankPackage(deps.ledger, parsed.data.accountId, 500_00));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/bank/inbound', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await simulateInboundCorridor(deps.ledger, parsed.data.accountId));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/bank/outbound', async (c) => {
    if (!allowWrite(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = bankBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const account = await deps.ledger.getAccount(parsed.data.accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    try {
      return c.json(await simulateOutboundCorridor(deps.ledger, parsed.data.accountId));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get('/trail', async (c) => {
    const parsed = paymentBody.safeParse({ accountId: c.req.query('account'), transferId: c.req.query('transfer') });
    if (!parsed.success) return c.json({ error: 'Payment not found' }, 404);
    const trail = await paymentTrail(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    return trail ? c.json(trail) : c.json({ error: 'Payment not found' }, 404);
  });

  app.get('/integrity', async (c) => {
    try {
      return c.json(await booksCheck(deps.ledger));
    } catch (e) {
      if (e instanceof LedgerError && e.status === 404) {
        return c.json({ error: 'Reconciliation is not on the deployed ledger build yet.', code: 'LEDGER_OUTDATED' }, 503);
      }
      throw e;
    }
  });

  app.post('/replay', async (c) => {
    if (!allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = paymentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const result = await replayPayment(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    return result ? c.json(result) : c.json({ error: 'Payment not found' }, 404);
  });

  app.post('/race', async (c) => {
    if (!allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = raceBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const result = await racePayment(deps.ledger, parsed.data.accountId, parsed.data.fromAccountId);
    if (!result) return c.json({ error: 'Account not found' }, 404);
    return 'error' in result ? c.json(result, 400) : c.json(result);
  });

  app.post('/tamper', async (c) => {
    if (!allowProof(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = paymentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
    const result = await tamperWithPayment(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    if (!result) return c.json({ error: 'Payment not found' }, 404);
    return 'error' in result ? c.json(result, 400) : c.json(result);
  });

  app.post('/chat', async (c) => {
    if (!allowChat(clientIp(c))) return c.json({ error: 'Too many requests, slow down a little.' }, 429);
    const parsed = chatBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const { accountId, messages: rawMessages } = parsed.data;
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);

    // Only the newest turns go to the model; old history is cost without value.
    const messages = trimHistory(rawMessages);
    const question = messages.at(-1)?.text ?? '';

    /** Deterministic ledger answers — used on config errors, budget exhaustion and model failures. */
    const degrade = async (reason: string): Promise<AssistantReply> => ({
      ...(await answerFromLedger({ ledger: deps.ledger, spendLogs: deps.spendLogs, accountId, question, now })),
      route: 'ledger-fallback',
      fallbackReason: reason,
    });

    let provider: LlmProvider;
    try {
      provider = deps.provider ? deps.provider() : providerFromEnv();
    } catch (e) {
      console.error(e);
      return c.json(await degrade(llmConfigError(e)));
    }

    try {
      // Cache → shared in-flight → budgeted fresh call. Same question, one Gemini call.
      const { reply, cache } = await llmGuard.answer({
        accountId,
        messages,
        produce: async () => {
          const peers = await listPeers(deps.ledger, accountId);
          return runAssistant({ provider, ledger: deps.ledger, spendLogs: deps.spendLogs, accountId, messages, peers, now });
        },
        degrade,
      });
      return c.json({ ...reply, cached: cache === 'hit' || cache === 'shared' ? true : undefined });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const errStatus = (e as { status?: number }).status;
      console.error('chat LLM error', errStatus, errMsg.slice(0, 500));
      // Never 500 the UI for model/config errors — ledger tools still answer.
      return c.json(await degrade(`LLM call failed (${errStatus ?? 'no status'}): ${errMsg.slice(0, 220)}`));
    }
  });

  app.onError((err, c) => {
    console.error(err);
    if ((err as { status?: number }).status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(err.message)) {
      return c.json({ error: 'The assistant is busy right now. Try again in a moment.' }, 429);
    }
    if (err instanceof LedgerError && (err.status === 502 || err.status === 503 || err.status === 504)) {
      return c.json({ error: 'The ledger is waking up. Try again in a moment.' }, 503);
    }
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  });

  return app;
}

function tzOffsetFrom(c: { req: { query(name: string): string | undefined } }): number {
  const raw = Number(c.req.query('tzOffset') ?? '0');
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(raw)));
}

async function accountView(
  ledger: LedgerReader,
  spendLogs: SpendLogStore,
  personalFinance: PersonalFinanceStore,
  id: string,
  limit = 30,
  now: () => Date,
  tzOffsetMinutes = 0,
) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const base = await loadAccountView(ledger, id, limit);
  if (!base) return null;
  const profile = await personalFinance.getProfile(id, base.currency, now());
  const allSpends = await spendLogs.list(id, { limit: 500 });
  const allIncomes = await personalFinance.listIncome(id, { limit: 500 });
  const habits = buildHabitsFromEntries(allSpends, now(), base.currency, profile.periodStart);
  const spends = allSpends.slice(0, 80);
  const incomes = allIncomes.slice(0, 80);
  const patterns = buildSpendingPatterns(allSpends, allIncomes, now(), profile, tzOffsetMinutes);
  const activityFeed = buildActivityFeed(
    base.transfers,
    spends,
    (minor, currency) => formatMoney(minor, currency),
    incomes,
  );
  const finance = buildFinanceSnapshot(profile, base.balance, allSpends, allIncomes);
  const insights = buildPersonalInsights(base.balance, base.summary, habits, finance);
  return {
    ...base,
    habits,
    patterns,
    finance,
    moneyProfile: profile,
    activityFeed,
    insights,
    spendEntries: spends.map((s) => ({
      id: s.id,
      amount: formatMoney(s.amountMinor, s.currency),
      amountMinor: s.amountMinor,
      category: s.category,
      note: s.note,
      occurredAt: s.occurredAt,
    })),
  };
}

async function listPeers(ledger: CompositeLedger, accountId: string) {
  if (ledger.isPracticeAccount(accountId)) {
    return ledger.practicePeers(accountId);
  }
  const recent = await ledger.transfersForAccount(accountId, 200);
  const ids = new Set<string>();
  for (const t of recent) {
    const other = t.sourceAccountId === accountId ? t.destinationAccountId : t.sourceAccountId;
    ids.add(other);
  }
  const peers: { id: string; owner: string }[] = [];
  for (const id of ids) {
    const a = await ledger.getAccount(id);
    if (a && a.type === 'USER' && id !== accountId) peers.push({ id, owner: a.ownerId });
  }
  return peers.sort((a, b) => a.owner.localeCompare(b.owner));
}

function respondAccount(c: { json: (body: unknown, status?: number) => Response }, view: Awaited<ReturnType<typeof loadAccountView>>) {
  if (!view) return c.json({ error: 'Account not found' }, 404);
  return c.json(view);
}

function llmConfigError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/GEMINI_API_KEY is not set/i.test(message)) {
    return 'GEMINI_API_KEY is not set. Add GEMINI_API_KEY or OPENROUTER_API_KEY on Vercel (assistant/.env locally), redeploy, then refresh.';
  }
  if (/OPENROUTER_API_KEY is not set/i.test(message)) {
    return 'OPENROUTER_API_KEY is not set. Get a key at openrouter.ai/keys or use GEMINI_API_KEY with LLM_PROVIDER=gemini.';
  }
  if (/ANTHROPIC_API_KEY is not set/i.test(message)) {
    return 'ANTHROPIC_API_KEY is not set on the assistant server.';
  }
  return message;
}
