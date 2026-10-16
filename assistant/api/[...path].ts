import { createAssistantApi } from '../src/server/instance.js';

const app = createAssistantApi();

/** One serverless function for all /api/* — Web Standard export (Vercel Node runtime). */
export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
