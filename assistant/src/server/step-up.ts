/**
 * Step-up authentication for sensitive actions.
 *
 * Enabled by POST /api/auth/step-up, which sets a 10 minute window on the
 * current session. Later steps call `requireStepUp` before mutating anything
 * that needs a fresh second factor.
 */
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { hashSessionToken, SESSION_COOKIE, type AuthStore } from './auth.js';

/**
 * Returns a 403 `{ error: 'step_up_required' }` response when the caller has no
 * live session or its step-up window is absent/expired. Returns null when the
 * action may proceed.
 */
export async function requireStepUp(
  c: Context,
  auth: AuthStore,
  now: () => Date,
): Promise<Response | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'step_up_required' }, 403);
  const until = await auth.getSessionStepUp(hashSessionToken(token));
  if (!until || until.getTime() <= now().getTime()) {
    return c.json({ error: 'step_up_required' }, 403);
  }
  return null;
}
