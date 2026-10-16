import { createAssistantApi } from '../src/server/instance.js';

const app = createAssistantApi();

/** Single function for all /api/* — vercel.json rewrites nested paths here (catch-all file only matches one segment). */
export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
