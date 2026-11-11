/**
 * Density preference: compact / comfortable, persisted in localStorage and
 * mirrored onto `<html data-density>` so CSS can tighten or loosen spacing.
 *
 * Storage and DOM access is defensive: a browser with storage disabled, a
 * corrupted value, or a stripped-down document must never break the app, so
 * every read/write falls back to a sane default instead of throwing.
 */

export type DensityPref = 'compact' | 'comfortable';

// Keep this key in sync with public/theme-init.js.
export const DENSITY_KEY = 'settle-density';

export type DensityStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The slice of `Document` this module touches, so tests can pass a stub. */
export interface DensityDocument {
  documentElement: { dataset: { [key: string]: string | undefined } };
}

const PREFS: readonly DensityPref[] = ['compact', 'comfortable'];

function isDensityPref(value: unknown): value is DensityPref {
  return typeof value === 'string' && (PREFS as readonly string[]).includes(value);
}

/** `localStorage` may itself throw (privacy mode, sandboxed frame). */
function defaultStorage(): DensityStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage: DensityStorage | null | undefined): DensityStorage | null {
  return storage === undefined ? defaultStorage() : storage;
}

/** `document` is absent when the module is used outside a browser. */
function defaultDocument(): DensityDocument | null {
  try {
    return globalThis.document ?? null;
  } catch {
    return null;
  }
}

function capitalize(pref: DensityPref): string {
  return pref.charAt(0).toUpperCase() + pref.slice(1);
}

/** Stored preference, or 'comfortable' when absent, invalid, or unreadable. */
export function readDensity(storage?: DensityStorage | null): DensityPref {
  try {
    const store = resolveStorage(storage);
    if (!store) return 'comfortable';
    const raw = store.getItem(DENSITY_KEY);
    return isDensityPref(raw) ? raw : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/** Persist the preference. Failures are silent — the density still applies. */
export function saveDensity(pref: DensityPref, storage?: DensityStorage | null): void {
  try {
    const store = resolveStorage(storage);
    if (!store) return;
    store.setItem(DENSITY_KEY, pref);
  } catch {
    // Storage full or blocked: keep the in-memory density, skip persistence.
  }
}

/** Mirror the preference onto the document as `data-density` on the root. */
export function applyDensity(pref: DensityPref, doc?: DensityDocument | null): void {
  const target = doc === undefined ? defaultDocument() : doc;
  if (!target) return;
  try {
    target.documentElement.dataset['density'] = pref;
  } catch {
    // A frozen or stub document must not break the caller.
  }
}

/** Human-readable name for the settings control. */
export function densityLabel(pref: DensityPref): string {
  return capitalize(pref);
}
