import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createAssistantApi } from './instance.js';
import { PAGE_HEADERS, securityHeaders } from './security-headers.js';

// Production / API-only entry (serves built UI from dist/). Dev UI uses Vite with vite-plugin-api.
const app = new Hono();
app.route('/', createAssistantApi());
app.use('/*', securityHeaders(PAGE_HEADERS));
app.use('/*', serveStatic({ root: './dist' }));
// Client-side routes (/reset-password, /ops) get the app shell
const shell = serveStatic({ path: './dist/index.html' });
app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : shell(c, next)));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`assistant API on http://localhost:${port}`));
