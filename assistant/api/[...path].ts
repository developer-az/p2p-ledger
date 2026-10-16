import { handle } from 'hono/vercel';
import { createAssistantApi } from '../src/server/instance.js';

/** One serverless function for all /api/* — no vercel.json /api rewrite (avoids 60s rewrite loops). */
export default handle(createAssistantApi());
