import type { Plugin } from 'vite';
import { getRequestListener } from '@hono/node-server';
import { createAssistantApi } from './src/server/instance.js';

/** Serves /api on the Vite dev server so one `npm run dev` is enough (no proxy to :8787). */
export function assistantApiPlugin(): Plugin {
  const listener = getRequestListener(createAssistantApi().fetch);
  return {
    name: 'assistant-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!path.startsWith('/api')) return next();
        listener(req, res);
      });
    },
  };
}
