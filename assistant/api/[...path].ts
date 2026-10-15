import { handle } from 'hono/vercel';

type FetchHandler = (req: Request) => Response | Promise<Response>;

let honoHandler: FetchHandler | undefined;
let honoLoading: Promise<FetchHandler> | undefined;

function loadHandler(): Promise<FetchHandler> {
  if (honoHandler) return Promise.resolve(honoHandler);
  if (!honoLoading) {
    honoLoading = import('../src/server/instance.js').then(({ createAssistantApi }) => {
      honoHandler = handle(createAssistantApi());
      return honoHandler;
    });
  }
  return honoLoading;
}

/** All /api/* except /api/health (dedicated file). */
export default function handler(req: Request): Promise<Response> {
  return loadHandler().then((h) => h(req));
}
