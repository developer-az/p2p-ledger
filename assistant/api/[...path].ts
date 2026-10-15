import { handle } from 'hono/vercel';

type FetchHandler = (req: Request) => Response | Promise<Response>;

let honoFetch: FetchHandler | undefined;
let honoLoad: Promise<FetchHandler> | undefined;

function loadHono(): Promise<FetchHandler> {
  if (honoFetch) return Promise.resolve(honoFetch);
  if (!honoLoad) {
    honoLoad = import('../src/server/instance.js').then(({ createAssistantApi }) => {
      honoFetch = handle(createAssistantApi());
      return honoFetch;
    });
  }
  return honoLoad;
}

/** One serverless function for all /api/* — no vercel.json /api rewrite (avoids 60s rewrite loops). */
export default function handler(req: Request): Promise<Response> {
  return loadHono().then((fetch) => fetch(req));
}
