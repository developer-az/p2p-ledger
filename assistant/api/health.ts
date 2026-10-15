/** Lightweight probe — no Hono / LLM imports (fast cold start + keep-warm). */
export default function GET(): Response {
  return Response.json({ status: 'ok' });
}
