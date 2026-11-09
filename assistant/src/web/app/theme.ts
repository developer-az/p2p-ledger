/**
 * Theme preference: system / light / dark, persisted in localStorage and
 * mirrored onto `<html data-theme>` plus the `theme-color` meta tags.
 *
 * Storage and DOM access is defensive: a browser with storage disabled, a
 * corrupted value, or a stripped-down document must never break the app, so
 * every read/write falls back to a sane default instead of throwing.
 */

export type ThemePref = 'system' | 'light' | 'dark';

// Keep this key and the theme-color values in sync with public/theme-init.js.
export const THEME_KEY = 'settle-theme';

export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

const LIGHT_COLOR = '#f4f3ee';
const DARK_COLOR = '#0b0b0c';

const PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

function isThemePref(value: unknown): value is ThemePref {
  return typeof value === 'string' && (PREFS as readonly string[]).includes(value);
}

/** `localStorage` may itself throw (privacy mode, sandboxed frame). */
function defaultStorage(): ThemeStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage: ThemeStorage | null | undefined): ThemeStorage | null {
  return storage === undefined ? defaultStorage() : storage;
}

function capitalize(pref: ThemePref): string {
  return pref.charAt(0).toUpperCase() + pref.slice(1);
}

/** Stored preference, or 'system' when absent, invalid, or unreadable. */
export function readTheme(storage?: ThemeStorage | null): ThemePref {
  try {
    const store = resolveStorage(storage);
    if (!store) return 'system';
    const raw = store.getItem(THEME_KEY);
    return isThemePref(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the preference. Failures are silent — the theme still applies. */
export function saveTheme(pref: ThemePref, storage?: ThemeStorage | null): void {
  try {
    const store = resolveStorage(storage);
    if (!store) return;
    store.setItem(THEME_KEY, pref);
  } catch {
    // Storage full or blocked: keep the in-memory theme, skip persistence.
  }
}

/** system -> light -> dark -> system. */
export function nextTheme(pref: ThemePref): ThemePref {
  if (pref === 'system') return 'light';
  if (pref === 'light') return 'dark';
  return 'system';
}

/**
 * Mirror the preference onto the document: the `data-theme` attribute drives
 * CSS, and each `theme-color` meta gets the background its media query expects.
 */
export function applyTheme(
  pref: ThemePref,
  doc: Pick<Document, 'documentElement' | 'querySelectorAll'> = document,
): void {
  const root = doc.documentElement;
  if (pref === 'light' || pref === 'dark') {
    root.dataset['theme'] = pref;
  } else {
    delete root.dataset['theme'];
  }

  const metas = doc.querySelectorAll('meta[name="theme-color"]');
  for (const meta of Array.from(metas)) {
    let content: string;
    if (pref === 'light') {
      content = LIGHT_COLOR;
    } else if (pref === 'dark') {
      content = DARK_COLOR;
    } else {
      const media = meta.getAttribute('media');
      content = media && media.includes('dark') ? DARK_COLOR : LIGHT_COLOR;
    }
    meta.setAttribute('content', content);
  }
}

/** Accessible label naming the current theme and the action that follows. */
export function themeLabel(pref: ThemePref): string {
  return `Theme: ${capitalize(pref)}. Switch to ${capitalize(nextTheme(pref))}`;
}
