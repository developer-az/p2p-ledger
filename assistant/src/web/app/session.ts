import type { AccountRef } from '../api.js';

const KEY = 'settle:session';

export interface Session {
  account: AccountRef;
  /** The demo household (Alex, Sam, Jordan), so one person can "view as" another. */
  household: AccountRef[];
  /** True only for the guided demo; personal wallets are never marked demo. */
  demo?: boolean;
}

function validRef(x: unknown): x is AccountRef {
  return !!x && typeof x === 'object'
    && typeof (x as AccountRef).id === 'string'
    && typeof (x as AccountRef).owner === 'string';
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!validRef(parsed.account)) return null;
    const household = Array.isArray(parsed.household) ? parsed.household.filter(validRef) : [];
    return { account: parsed.account, household, demo: parsed.demo === true };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* private mode: the session just won't survive a reload */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
