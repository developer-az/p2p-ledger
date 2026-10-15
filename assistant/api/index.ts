import { handle } from 'hono/vercel';
import { createAssistantApi } from '../src/server/instance.js';

/**
 * Single Vercel function for all /api/* routes.
 * Vercel deploys each file under api/ as a separate function; splitting health/bootstrap
 * caused 10s timeouts on cold start. One handler + rewrite is the supported pattern.
 */
const app = createAssistantApi();

export default handle(app);
