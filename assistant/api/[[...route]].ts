import { handle } from 'hono/vercel';
import { createAssistantApi } from '../src/server/instance.js';

// Vercel serverless function: every /api/* request lands here.
const app = createAssistantApi();

export const GET = handle(app);
export const POST = handle(app);
