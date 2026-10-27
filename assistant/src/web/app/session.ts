import type { AccountRef } from '../api.js';

const KEY = 'settle:session';

export interface SessionUser {
  email: string;
  displayName: string;
}

export interface Session {
  account: AccountRef;
  /** The demo household (Alex, Sam, Jordan), so one person can "view as" another. */
  household: AccountRef[];
  /** True only for the guided demo; personal wallets are never marked demo. */
  demo?: boolean;
  /** Present after email sign-in. Absent for the sample household. */
  user?: SessionUser;
}

function validUser(x: unknown): x is SessionUser {
  return !!x && typeof x === 'object'
    && typeof (x as SessionUser).email === 'string'
    && typeof (x as SessionUser).displayName === 'string';
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
    const user = validUser(parsed.user) ? parsed.user : undefined;
    return { account: parsed.account, household, demo: parsed.demo === true, user };
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
