import { handle } from 'hono/vercel';
import { createAssistantApi } from '../src/server/instance.js';

// Vercel routes /api/* here. Do not add a /api → /api rewrite (it can loop until 504).
const app = createAssistantApi();

export default handle(app);
