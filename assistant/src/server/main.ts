import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createAssistantApi } from './instance.js';

// Production / API-only entry (serves built UI from dist/). Dev UI uses Vite with vite-plugin-api.
const app = new Hono();
app.route('/', createAssistantApi());
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`assistant API on http://localhost:${port}`));
