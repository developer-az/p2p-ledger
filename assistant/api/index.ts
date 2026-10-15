import { handle } from 'hono/vercel';
import { createAssistantApi } from '../src/server/instance.js';

// Single Vercel function; vercel.json rewrites all /api/* here (nested paths 404 on [[...route]].ts).
const app = createAssistantApi();

export default handle(app);
