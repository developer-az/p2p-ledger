import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { HttpLedgerClient } from './ledger.js';
import { providerFromEnv } from './providers/index.js';

// Local/self-hosted entry point. On Vercel, api/[[...route]].ts serves the same app.
const ledger = new HttpLedgerClient(process.env.LEDGER_URL ?? 'http://localhost:8080');
let provider: ReturnType<typeof providerFromEnv> | undefined;
const app = new Hono();
app.route('/', createApp({ ledger, provider: () => (provider ??= providerFromEnv()) }));
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`assistant API on http://localhost:${port}`));
