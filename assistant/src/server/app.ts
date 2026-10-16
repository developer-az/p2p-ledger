import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { runAssistant } from './agent.js';
import { seedDemo } from './demo.js';
import { answerFromLedger } from './fallback.js';
import { LedgerError, type LedgerReader, type LedgerWriter } from './ledger.js';
import { isModelOutage } from './providers/retry.js';
import type { LlmProvider } from './providers/types.js';
import type { CompositeLedger, PracticeLedger } from './practice-ledger.js';
import { LEDGER_CAPABILITIES } from './personas.js';
import { formatLedgerStatement } from './statement-export.js';
import { loadAccountView } from './tools.js';
import { providerFromEnv } from './providers/index.js';
import { MAX_MINOR_UI } from './money.js';
import { racePayment } from './race.js';

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

const raceBody = z.object({ accountId: z.string().uuid(), fromAccountId: z.string().uuid() });

const chatBody = z.object({
  accountId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(2000),
  })).min(1).max(20).refine((m) => m.at(-1)?.role === 'user', 'Last message must be from the user'),
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
  liveLedger?: LedgerWriter;
  isLiveLedgerUp?: () => Promise<boolean>;
  /** Tests inject a fake model; production loads Gemini/Claude on first chat only. */
  provider?: () => LlmProvider;
}) {
  const app = new Hono().basePath('/api');
  const allowChat = rateLimiter(20, 60_000);
  const allowSeed = rateLimiter(3, 60_000);
  const allowWrite = rateLimiter(40, 60_000);
  const allowRace = rateLimiter(8, 60_000);
  const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/bootstrap', async (c) => {
    const practice = deps.practice.bootstrap();
    let live = false;
    if (deps.isLiveLedgerUp) {
      live = await Promise.race([
        deps.isLiveLedgerUp(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
    }
    let chat = { provider: (process.env.LLM_PROVIDER ?? 'gemini').toLowerCase(), configured: false };
    try {
      providerFromEnv();
      chat = { ...chat, configured: true };
    } catch {
      chat.configured = false;
    }
    return c.json({
      live,
      practice,
      ledger: {
        engine: 'ledger-service',
        apiVersion: 'v1',
        capabilities: [...LEDGER_CAPABILITIES],
        persistence: live
          ? 'Accounts and transfers persist in PostgreSQL (Render). Bookmark ?id= or use saved wallets below.'
          : 'Practice mode is in-memory per server instance — use live seed or create wallet while ledger is online.',
      },
      chat,
    });
  });

  app.get('/accounts', async (c) => {
    const id = c.req.query('id');
    const limit = Number(c.req.query('limit') ?? '30');
    if (id) return respondAccount(c, await accountView(deps.ledger, id, Math.min(limit, 100)));
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

  // Direct links. The UI uses ?id= so a host that 404s a second path segment still reaches this app.
  app.get('/accounts/:id', async (c) => respondAccount(c, await accountView(deps.ledger, c.req.param('id'))));

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
    const view = await accountView(deps.ledger, id, 100);
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

  app.post('/race', async (c) => {
    if (!allowRace(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const parsed = raceBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid body' }, 400);
    const result = await racePayment(deps.ledger, parsed.data.accountId, parsed.data.fromAccountId);
    if (!result) return c.json({ error: 'Account not found' }, 404);
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  });

  app.post('/demo', async (c) => {
    if (!allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    const live = deps.isLiveLedgerUp ? await deps.isLiveLedgerUp() : false;
    if (!live || !deps.liveLedger) {
      return c.json({
        error: 'The live ledger is not running. Use Alex, Sam, or Jordan below — they work without Docker. To create fresh accounts, run: docker compose up',
      }, 503);
    }
    return c.json(await seedDemo(deps.liveLedger));
  });

  app.post('/chat', async (c) => {
    if (!allowChat(clientIp(c))) return c.json({ error: 'Too many requests, slow down a little.' }, 429);
    const parsed = chatBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const { accountId, messages } = parsed.data;
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    let provider: LlmProvider;
    try {
      if (deps.provider) {
        provider = deps.provider();
      } else {
        const { providerFromEnv } = await import('./providers/index.js');
        provider = providerFromEnv();
      }
    } catch (e) {
      console.error(e);
      const question = messages.at(-1)?.text ?? '';
      return c.json(await answerFromLedger({ ledger: deps.ledger, accountId, question }));
    }
    try {
      return c.json(await runAssistant({ provider, ledger: deps.ledger, accountId, messages }));
    } catch (e) {
      // The free Gemini cap is 20 requests a day. The books can still answer.
      if (isModelOutage(e)) {
        const question = messages.at(-1)?.text ?? '';
        return c.json(await answerFromLedger({ ledger: deps.ledger, accountId, question }));
      }
      throw e;
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

async function accountView(ledger: LedgerReader, id: string, limit = 30) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return loadAccountView(ledger, id, limit);
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
