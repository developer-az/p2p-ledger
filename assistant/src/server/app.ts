import { Hono } from 'hono';
import { z } from 'zod';
import { runAssistant } from './agent.js';
import { booksCheck, paymentTrail, racePayment, replayPayment, tamperWithPayment } from './console.js';
import { seedDemo } from './demo.js';
import { answerFromLedger } from './fallback.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from './ledger.js';
import { isModelOutage } from './providers/retry.js';
import type { LlmProvider } from './providers/types.js';
import { loadAccountView } from './tools.js';

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

const paymentBody = z.object({ accountId: z.string().uuid(), transferId: z.string().uuid() });
const raceBody = z.object({ accountId: z.string().uuid(), fromAccountId: z.string().uuid() });

export function createApp(deps: { ledger: LedgerReader & LedgerWriter & LedgerAuditor; provider: () => LlmProvider }) {
  const app = new Hono().basePath('/api');
  const allowChat = rateLimiter(20, 60_000);
  const allowSeed = rateLimiter(3, 60_000);
  const allowProof = rateLimiter(12, 60_000);
  const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/accounts', async (c) => {
    const id = c.req.query('id');
    if (id) return respondAccount(c, await accountView(deps.ledger, id));
    const owner = c.req.query('owner');
    if (!owner) return c.json({ error: 'owner is required' }, 400);
    const accounts = await deps.ledger.accountsByOwner(owner);
    return c.json(accounts.map((a) => ({ id: a.id, owner: a.ownerId })));
  });

  // Direct links. The UI uses ?id= so a host that 404s a second path segment still reaches this app.
  app.get('/accounts/:id', async (c) => respondAccount(c, await accountView(deps.ledger, c.req.param('id'))));

  app.post('/demo', async (c) => {
    if (!allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    return c.json(await seedDemo(deps.ledger));
  });

  app.get('/trail', async (c) => {
    const parsed = paymentBody.safeParse({ accountId: c.req.query('account'), transferId: c.req.query('transfer') });
    if (!parsed.success) return c.json({ error: 'Payment not found' }, 404);
    const trail = await paymentTrail(deps.ledger, parsed.data.accountId, parsed.data.transferId);
    return trail ? c.json(trail) : c.json({ error: 'Payment not found' }, 404);
  });

  app.get('/integrity', async (c) => c.json(await booksCheck(deps.ledger)));

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
    const { accountId, messages } = parsed.data;
    const account = await deps.ledger.getAccount(accountId);
    if (!account || account.type !== 'USER') return c.json({ error: 'Account not found' }, 404);
    let provider: LlmProvider;
    try {
      provider = deps.provider();
    } catch (e) {
      console.error(e);
      return c.json({ error: 'The assistant is not configured (missing LLM API key).' }, 503);
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

async function accountView(ledger: LedgerReader, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return loadAccountView(ledger, id);
}

function respondAccount(c: { json: (body: unknown, status?: number) => Response }, view: Awaited<ReturnType<typeof loadAccountView>>) {
  if (!view) return c.json({ error: 'Account not found' }, 404);
  return c.json(view);
}
