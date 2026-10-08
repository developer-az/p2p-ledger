import { handle } from 'hono/vercel';
import { createApp } from '../src/server/app.js';
import { HttpLedgerClient } from '../src/server/ledger.js';
import { providerFromEnv } from '../src/server/providers/index.js';

// Vercel serverless function: every /api/* request lands here.
const ledger = new HttpLedgerClient(process.env.LEDGER_URL ?? 'http://localhost:8080');
let provider: ReturnType<typeof providerFromEnv> | undefined;
const app = createApp({ ledger, provider: () => (provider ??= providerFromEnv()) });

export const GET = handle(app);
export const POST = handle(app);
