import { describe, expect, it } from 'vitest';
import {
  THEME_KEY,
  applyTheme,
  nextTheme,
  readTheme,
  saveTheme,
  themeLabel,
  type ThemePref,
  type ThemeStorage,
} from '../src/web/app/theme.js';

type Meta = { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
type FakeDoc = Pick<Document, 'documentElement' | 'querySelectorAll'> & {
  documentElement: { dataset: Record<string, string> };
};

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string): string | null {
      return Object.hasOwn(data, key) ? (data[key] as string) : null;
    },
    setItem(key: string, value: string): void {
      data[key] = value;
    },
  };
}

const throwingStorage: ThemeStorage = {
  getItem(): string | null {
    throw new Error('storage blocked');
  },
  setItem(): void {
    throw new Error('storage blocked');
  },
};

function fakeMeta(media: string | null): Meta & { content: string | null } {
  const attrs: Record<string, string | null> = { media, content: null };
  return {
    get content() {
      return attrs['content'] ?? null;
    },
    getAttribute(name: string): string | null {
      return attrs[name] ?? null;
    },
    setAttribute(name: string, value: string): void {
      attrs[name] = value;
    },
  };
}

function fakeDoc(metas: Meta[] = []): FakeDoc {
  const documentElement = { dataset: {} as Record<string, string> };
  return {
    documentElement,
    querySelectorAll: () => metas as unknown as NodeListOf<Element>,
  } as unknown as FakeDoc;
}

describe('readTheme', () => {
  it('returns the stored preference', () => {
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'light' }))).toBe('light');
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'system' }))).toBe('system');
  });

  it('falls back to system when the key is missing', () => {
    expect(readTheme(fakeStorage())).toBe('system');
    expect(readTheme(fakeStorage({ 'other-key': 'dark' }))).toBe('system');
  });

  it('falls back to system on an invalid value', () => {
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'sepia' }))).toBe('system');
    expect(readTheme(fakeStorage({ [THEME_KEY]: '' }))).toBe('system');
  });

  it('falls back to system when getItem throws', () => {
    expect(readTheme(throwingStorage)).toBe('system');
  });

  it('falls back to system when storage is null', () => {
    expect(readTheme(null)).toBe('system');
  });

  it('falls back to system when the default localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('no storage here');
      },
    });
    try {
      expect(readTheme()).toBe('system');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('reads through the default localStorage when present', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: fakeStorage({ [THEME_KEY]: 'light' }),
    });
    try {
      expect(readTheme()).toBe('light');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('saveTheme', () => {
  it('writes the preference under THEME_KEY', () => {
    const storage = fakeStorage();
    saveTheme('dark', storage);
    expect(storage.data).toEqual({ [THEME_KEY]: 'dark' });
  });

  it('overwrites a previous value', () => {
    const storage = fakeStorage({ [THEME_KEY]: 'light' });
    saveTheme('system', storage);
    expect(storage.data[THEME_KEY]).toBe('system');
  });

  it('never throws when setItem throws', () => {
    expect(() => saveTheme('light', throwingStorage)).not.toThrow();
  });

  it('never throws when storage is null', () => {
    expect(() => saveTheme('dark', null)).not.toThrow();
  });

  it('never throws when the default localStorage setItem throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: throwingStorage,
    });
    try {
      expect(() => saveTheme('light')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('writes to the default localStorage when present', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = fakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    try {
      saveTheme('dark');
      expect(storage.data[THEME_KEY]).toBe('dark');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('round-trips with readTheme', () => {
    const storage = fakeStorage();
    saveTheme('light', storage);
    expect(readTheme(storage)).toBe('light');
  });
});

describe('nextTheme', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme(nextTheme(nextTheme('system')))).toBe('system');
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark', () => {
    const lightDoc = fakeDoc();
    applyTheme('light', lightDoc);
    expect(lightDoc.documentElement.dataset['theme']).toBe('light');

    const darkDoc = fakeDoc();
    applyTheme('dark', darkDoc);
    expect(darkDoc.documentElement.dataset['theme']).toBe('dark');
  });

  it('removes data-theme for system', () => {
    const doc = fakeDoc();
    applyTheme('dark', doc);
    applyTheme('system', doc);
    expect('theme' in doc.documentElement.dataset).toBe(false);
  });

  it('is safe when no theme-color meta exists', () => {
    const doc = fakeDoc();
    expect(() => applyTheme('dark', doc)).not.toThrow();
  });

  it('paints every theme-color meta with the fixed colour', () => {
    const metas = [fakeMeta('(prefers-color-scheme: light)'), fakeMeta('(prefers-color-scheme: dark)')];

    const lightMetas = [fakeMeta('(prefers-color-scheme: light)'), fakeMeta('(prefers-color-scheme: dark)')];
    applyTheme('light', fakeDoc(lightMetas));
    expect(lightMetas.map((m) => m.content)).toEqual(['#fafaf9', '#fafaf9']);

    applyTheme('dark', fakeDoc(metas));
    expect(metas.map((m) => m.content)).toEqual(['#0f1012', '#0f1012']);
  });

  it('follows each meta media query for system', () => {
    const light = fakeMeta('(prefers-color-scheme: light)');
    const dark = fakeMeta('(prefers-color-scheme: dark)');
    const noMedia = fakeMeta(null);

    applyTheme('system', fakeDoc([light, dark, noMedia]));

    expect(light.content).toBe('#fafaf9');
    expect(dark.content).toBe('#0f1012');
    expect(noMedia.content).toBe('#fafaf9');
  });
});

describe('themeLabel', () => {
  it('names the current theme and the next one', () => {
    expect(themeLabel('system')).toBe('Theme: System. Switch to Light');
    expect(themeLabel('light')).toBe('Theme: Light. Switch to Dark');
    expect(themeLabel('dark')).toBe('Theme: Dark. Switch to System');
  });

  it('covers every preference', () => {
    const prefs: ThemePref[] = ['system', 'light', 'dark'];
    for (const pref of prefs) {
      expect(themeLabel(pref).startsWith(`Theme: ${pref.charAt(0).toUpperCase()}`)).toBe(true);
    }
  });
});
