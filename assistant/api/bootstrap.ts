import { probeLiveLedger } from '../src/server/probe-live.js';
import { practiceBootstrapPayload } from '../src/server/practice-bootstrap.js';

/** Sign-in page calls this first — must stay small (no Hono / Gemini bundle). */
export default async function GET(): Promise<Response> {
  const [live, practice] = await Promise.all([
    probeLiveLedger(),
    Promise.resolve(practiceBootstrapPayload()),
  ]);
  return Response.json({ live, practice });
}
