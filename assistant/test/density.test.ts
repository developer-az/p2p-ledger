import { describe, expect, it } from 'vitest';
import {
  DENSITY_KEY,
  applyDensity,
  densityLabel,
  readDensity,
  saveDensity,
  type DensityStorage,
} from '../src/web/app/density.js';

function fakeStorage(initial: Record<string, string> = {}): DensityStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k) => (Object.hasOwn(data, k) ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

const throwing: DensityStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

describe('density preference', () => {
  it('uses the settle-density key', () => {
    expect(DENSITY_KEY).toBe('settle-density');
  });

  it('defaults to comfortable and reads a saved value', () => {
    expect(readDensity(fakeStorage())).toBe('comfortable');
    expect(readDensity(fakeStorage({ 'settle-density': 'compact' }))).toBe('compact');
    expect(readDensity(fakeStorage({ 'settle-density': 'huge' }))).toBe('comfortable');
    expect(readDensity(null)).toBe('comfortable');
    expect(readDensity(throwing)).toBe('comfortable');
  });

  it('saves and swallows storage errors', () => {
    const s = fakeStorage();
    saveDensity('compact', s);
    expect(s.data['settle-density']).toBe('compact');
    expect(() => saveDensity('compact', throwing)).not.toThrow();
    expect(() => saveDensity('compact', null)).not.toThrow();
  });

  it('applies the preference as data-density on the root element', () => {
    const doc = { documentElement: { dataset: {} as Record<string, string> } };
    applyDensity('compact', doc);
    expect(doc.documentElement.dataset.density).toBe('compact');
    applyDensity('comfortable', doc);
    expect(doc.documentElement.dataset.density).toBe('comfortable');
    expect(() => applyDensity('compact', null)).not.toThrow();
  });

  it('labels each option', () => {
    expect(densityLabel('compact')).toBe('Compact');
    expect(densityLabel('comfortable')).toBe('Comfortable');
  });
});
