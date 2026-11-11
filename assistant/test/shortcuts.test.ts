import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  createShortcutMatcher,
  formatKeys,
  type KeyInput,
} from '../src/web/app/shortcuts.js';

function key(k: string, at: number, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: k, timeStamp: at, ...extra };
}

describe('createShortcutMatcher', () => {
  it('opens the palette with Cmd+K on Mac and Ctrl+K elsewhere', () => {
    const mac = createShortcutMatcher({ isMac: true });
    expect(mac(key('k', 0, { metaKey: true }))).toBe('palette');
    expect(mac(key('k', 10, { ctrlKey: true }))).toBeNull();
    const pc = createShortcutMatcher({ isMac: false });
    expect(pc(key('k', 0, { ctrlKey: true }))).toBe('palette');
    expect(pc(key('k', 10, { metaKey: true }))).toBeNull();
    expect(pc(key('K', 20, { ctrlKey: true, shiftKey: true }))).toBe('palette');
  });

  it('maps single keys', () => {
    const m = createShortcutMatcher({ isMac: false });
    expect(m(key('?', 0, { shiftKey: true }))).toBe('help');
    expect(m(key('n', 10))).toBe('new');
    expect(m(key('[', 20))).toBe('sidebar');
    expect(m(key('/', 30))).toBe('search');
    expect(m(key('Escape', 40))).toBe('escape');
    expect(m(key('x', 50))).toBeNull();
  });

  it('ignores single keys with Ctrl, Meta or Alt held, and uppercase letters', () => {
    const m = createShortcutMatcher({ isMac: false });
    expect(m(key('n', 0, { ctrlKey: true }))).toBeNull();
    expect(m(key('n', 10, { metaKey: true }))).toBeNull();
    expect(m(key('n', 20, { altKey: true }))).toBeNull();
    expect(m(key('N', 30, { shiftKey: true }))).toBeNull();
  });

  it('matches g-chords inside the window', () => {
    const m = createShortcutMatcher({ isMac: false, chordMs: 1000 });
    expect(m(key('g', 0))).toBeNull();
    expect(m(key('o', 400))).toBe('go-overview');
    expect(m(key('g', 1000))).toBeNull();
    expect(m(key('t', 1500))).toBe('go-transactions');
    expect(m(key('g', 2000))).toBeNull();
    expect(m(key('i', 2100))).toBe('go-insights');
    expect(m(key('g', 3000))).toBeNull();
    expect(m(key('s', 3100))).toBe('go-settings');
    expect(m(key('g', 4000))).toBeNull();
    expect(m(key('a', 4100))).toBe('go-ask');
  });

  it('drops a chord after the window or after a non-chord key', () => {
    const m = createShortcutMatcher({ isMac: false, chordMs: 1000 });
    m(key('g', 0));
    expect(m(key('o', 1001))).toBeNull();
    m(key('g', 2000));
    expect(m(key('x', 2100))).toBeNull();
    expect(m(key('o', 2200))).toBeNull();
    m(key('g', 3000));
    expect(m(key('n', 3100))).toBeNull();
  });

  it('ignores a chord ending with a modifier held, and disarms it', () => {
    const m = createShortcutMatcher({ isMac: false });
    m(key('g', 0));
    expect(m(key('t', 100, { ctrlKey: true }))).toBeNull();
    expect(m(key('t', 200))).toBeNull();
    m(key('g', 1000));
    expect(m(key('o', 1100, { metaKey: true }))).toBeNull();
    m(key('g', 2000));
    expect(m(key('i', 2100, { altKey: true }))).toBeNull();
    m(key('g', 3000));
    expect(m(key('o', 3100))).toBe('go-overview');
  });

  it('defaults the chord window to one second', () => {
    const m = createShortcutMatcher({ isMac: false });
    m(key('g', 0));
    expect(m(key('o', 999))).toBe('go-overview');
    m(key('g', 5000));
    expect(m(key('o', 6001))).toBeNull();
  });

  it('ignores everything but the palette and Escape while typing', () => {
    const m = createShortcutMatcher({ isMac: true });
    for (const target of [{ targetTag: 'INPUT' }, { targetTag: 'textarea' }, { targetTag: 'SELECT' }, { targetEditable: true }]) {
      expect(m(key('n', 0, target))).toBeNull();
      expect(m(key('?', 0, { ...target, shiftKey: true }))).toBeNull();
      expect(m(key('/', 0, target))).toBeNull();
      expect(m(key('g', 0, target))).toBeNull();
      expect(m(key('o', 10, target))).toBeNull();
      expect(m(key('k', 20, { ...target, metaKey: true }))).toBe('palette');
      expect(m(key('Escape', 30, target))).toBe('escape');
    }
  });

  it('keeps separate chord state per matcher', () => {
    const a = createShortcutMatcher({ isMac: false });
    const b = createShortcutMatcher({ isMac: false });
    a(key('g', 0));
    expect(b(key('o', 100))).toBeNull();
    expect(a(key('o', 100))).toBe('go-overview');
  });
});

describe('SHORTCUTS table', () => {
  it('lists every shortcut the matcher can return, once, with a label and group', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([
      'escape', 'go-ask', 'go-insights', 'go-overview', 'go-settings', 'go-transactions',
      'help', 'new', 'palette', 'search', 'sidebar',
    ]);
    for (const s of SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(['General', 'Navigation']).toContain(s.group);
      expect(s.keys.length).toBeGreaterThan(0);
    }
  });

  it('describes chords as two keys', () => {
    expect(SHORTCUTS.find((s) => s.id === 'go-insights')?.keys).toBe('G I');
    expect(SHORTCUTS.find((s) => s.id === 'palette')?.keys).toBe('Mod+K');
  });
});

describe('formatKeys', () => {
  it('renders Mod for the platform', () => {
    expect(formatKeys('Mod+K', true)).toBe('⌘K');
    expect(formatKeys('Mod+K', false)).toBe('Ctrl+K');
    expect(formatKeys('G I', true)).toBe('G then I');
    expect(formatKeys('?', false)).toBe('?');
    expect(formatKeys('Escape', true)).toBe('Esc');
  });
});
