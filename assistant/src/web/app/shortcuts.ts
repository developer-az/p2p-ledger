/**
 * Keyboard shortcuts: a pure key-sequence matcher plus the table the cheat
 * sheet and the command palette render.
 *
 * The matcher keeps its own chord state, so callers own nothing but the
 * platform flag. It takes a plain `KeyInput` rather than a DOM `KeyboardEvent`
 * so the behaviour is testable without a browser.
 *
 * Sequences:
 * - `Mod+K` opens the palette on any platform (`Meta` on Mac, `Ctrl` elsewhere).
 * - `Escape` closes the topmost layer and always wins.
 * - Single keys: `?`, `N`, `[`, `/`.
 * - Two-key chords: `G` then `O` / `T` / `I` / `S` / `A`, within `chordMs`.
 *
 * Anything typed into a field (`INPUT`, `TEXTAREA`, `SELECT`, or a
 * contenteditable host) is ignored except `Mod+K` and `Escape`, so shortcuts
 * never eat a keystroke meant for a form.
 */

/** Every action the matcher can return. */
export type ShortcutId =
  | 'palette'
  | 'help'
  | 'new'
  | 'sidebar'
  | 'search'
  | 'escape'
  | 'go-overview'
  | 'go-transactions'
  | 'go-insights'
  | 'go-settings'
  | 'go-ask';

export type ShortcutGroup = 'General' | 'Navigation';

export interface Shortcut {
  id: ShortcutId;
  /** Display form: `Mod+K`, single key, or a space-separated chord (`G I`). */
  keys: string;
  label: string;
  group: ShortcutGroup;
}

/** The cheat sheet, in display order. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', keys: 'Mod+K', label: 'Open command palette', group: 'General' },
  { id: 'help', keys: '?', label: 'Show keyboard shortcuts', group: 'General' },
  { id: 'new', keys: 'N', label: 'New transaction', group: 'General' },
  { id: 'sidebar', keys: '[', label: 'Collapse or expand sidebar', group: 'General' },
  { id: 'search', keys: '/', label: 'Search transactions', group: 'General' },
  { id: 'escape', keys: 'Escape', label: 'Close dialog', group: 'General' },
  { id: 'go-overview', keys: 'G O', label: 'Go to Overview', group: 'Navigation' },
  { id: 'go-transactions', keys: 'G T', label: 'Go to Transactions', group: 'Navigation' },
  { id: 'go-insights', keys: 'G I', label: 'Go to Insights', group: 'Navigation' },
  { id: 'go-settings', keys: 'G S', label: 'Go to Settings', group: 'Navigation' },
  { id: 'go-ask', keys: 'G A', label: 'Go to Ask', group: 'Navigation' },
];

/** The subset of a keyboard event the matcher needs. */
export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** `event.target.tagName`, when the caller has one. */
  targetTag?: string;
  /** True for a contenteditable host. */
  targetEditable?: boolean;
  /** `event.timeStamp`, in milliseconds. */
  timeStamp: number;
}

export interface ShortcutMatcherOptions {
  isMac: boolean;
  /** How long a chord stays armed. */
  chordMs?: number;
}

const DEFAULT_CHORD_MS = 1000;

const SINGLE_KEYS: Readonly<Record<string, ShortcutId>> = {
  '?': 'help',
  n: 'new',
  '[': 'sidebar',
  '/': 'search',
};

const CHORD_KEYS: Readonly<Record<string, ShortcutId>> = {
  o: 'go-overview',
  t: 'go-transactions',
  i: 'go-insights',
  s: 'go-settings',
  a: 'go-ask',
};

const CHORD_LEADER = 'g';

const EDITABLE_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT'];

function isTyping(e: KeyInput): boolean {
  if (e.targetEditable === true) return true;
  const tag = e.targetTag?.toUpperCase();
  return tag !== undefined && EDITABLE_TAGS.includes(tag);
}

function hasNonModKey(e: KeyInput): boolean {
  return e.ctrlKey === true || e.metaKey === true || e.altKey === true;
}

/**
 * Returns a matcher closed over its own chord state. Feed it every keydown and
 * act on a non-null result. One matcher per listener.
 */
export function createShortcutMatcher(
  options: ShortcutMatcherOptions,
): (e: KeyInput) => ShortcutId | null {
  const modKey = options.isMac ? 'metaKey' : 'ctrlKey';
  const otherModKey = options.isMac ? 'ctrlKey' : 'metaKey';
  const chordMs = options.chordMs ?? DEFAULT_CHORD_MS;
  let armedAt: number | null = null;

  return (e: KeyInput): ShortcutId | null => {
    const mod = e[modKey] === true;
    const otherMod = e[otherModKey] === true;

    // Escape always closes, from fields too.
    if (e.key === 'Escape') {
      armedAt = null;
      return 'escape';
    }

    // Mod+K opens the palette, from fields too. Upper case covers Shift+K.
    if (mod && !otherMod && e.key.toLowerCase() === 'k') {
      armedAt = null;
      return 'palette';
    }

    // A keystroke meant for a field never fires a shortcut or arms a chord.
    if (isTyping(e)) {
      armedAt = null;
      return null;
    }

    // While a chord is armed the next key is consumed either way. A second key
    // with a non-modifier held is not a chord ending: it disarms and returns
    // null, so Ctrl+G O never navigates.
    if (armedAt !== null) {
      const elapsed = e.timeStamp - armedAt;
      armedAt = null;
      if (hasNonModKey(e)) return null;
      return elapsed <= chordMs ? (CHORD_KEYS[e.key] ?? null) : null;
    }

    // Bare single keys only; anything held means the user is not quoting a key.
    if (hasNonModKey(e)) return null;

    if (e.key === CHORD_LEADER) {
      armedAt = e.timeStamp;
      return null;
    }

    return SINGLE_KEYS[e.key] ?? null;
  };
}

const MOD_SYMBOL = '⌘';

function formatToken(token: string, isMac: boolean): string {
  if (token === 'Mod') return isMac ? MOD_SYMBOL : 'Ctrl';
  if (token === 'Escape') return 'Esc';
  return token;
}

/**
 * Renders a keys string for a platform: `Mod+K` becomes `⌘K` or `Ctrl+K`, and a
 * chord (`G I`) becomes `G then I`.
 */
export function formatKeys(keys: string, isMac: boolean): string {
  const trimmed = keys.trim();
  if (trimmed.includes(' ')) {
    return trimmed
      .split(/\s+/)
      .map((token) => formatToken(token, isMac))
      .join(' then ');
  }
  return trimmed
    .split('+')
    .map((token) => formatToken(token, isMac))
    .join(isMac ? '' : '+');
}
