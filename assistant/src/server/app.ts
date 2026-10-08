import { Hono } from 'hono';
import { z } from 'zod';
import { runAssistant } from './agent.js';
import { seedDemo } from './demo.js';
import type { LedgerReader, LedgerWriter } from './ledger.js';
import type { LlmProvider } from './providers/types.js';

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

export function createApp(deps: { ledger: LedgerReader & LedgerWriter; provider: () => LlmProvider }) {
  const app = new Hono().basePath('/api');
  const allowChat = rateLimiter(20, 60_000);
  const allowSeed = rateLimiter(3, 60_000);
  const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/accounts', async (c) => {
    const owner = c.req.query('owner');
    if (!owner) return c.json({ error: 'owner is required' }, 400);
    const accounts = await deps.ledger.accountsByOwner(owner);
    return c.json(accounts.map((a) => ({ id: a.id, owner: a.ownerId })));
  });

  app.post('/demo', async (c) => {
    if (!allowSeed(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);
    return c.json(await seedDemo(deps.ledger));
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
    return c.json(await runAssistant({ provider, ledger: deps.ledger, accountId, messages }));
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  });

  return app;
}
