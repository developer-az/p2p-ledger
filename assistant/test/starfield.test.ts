import { describe, expect, it } from 'vitest';
import { constellations, starField } from '../src/web/app/starfield.js';

describe('starField', () => {
  it('is deterministic for a seed and different across seeds', () => {
    expect(starField(42, 120)).toEqual(starField(42, 120));
    expect(starField(42, 120)).not.toEqual(starField(43, 120));
  });

  it('returns the requested count with coordinates inside a 0-100 viewBox', () => {
    const stars = starField(7, 200);
    expect(stars).toHaveLength(200);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(100);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(100);
    }
  });

  it('assigns three depth layers with smaller, dimmer stars further away', () => {
    const stars = starField(11, 300);
    const layers = new Set(stars.map((s) => s.layer));
    expect([...layers].sort()).toEqual([0, 1, 2]);
    const avg = (layer: number, key: 'r' | 'opacity') => {
      const xs = stars.filter((s) => s.layer === layer).map((s) => s[key]);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg(0, 'r')).toBeLessThan(avg(2, 'r'));
    expect(avg(0, 'opacity')).toBeLessThan(avg(2, 'opacity'));
    // Far stars dominate, like a real sky.
    expect(stars.filter((s) => s.layer === 0).length).toBeGreaterThan(stars.filter((s) => s.layer === 2).length);
  });

  it('keeps radii and opacity in a restrained range and marks only a few stars to twinkle', () => {
    const stars = starField(3, 400);
    for (const s of stars) {
      expect(s.r).toBeGreaterThan(0);
      expect(s.r).toBeLessThanOrEqual(0.3);
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
    const twinkling = stars.filter((s) => s.twinkle).length;
    expect(twinkling).toBeGreaterThan(0);
    expect(twinkling / stars.length).toBeLessThanOrEqual(0.12);
  });
});

describe('constellations', () => {
  it('returns a few line sketches whose points stay in the viewBox and index real points', () => {
    const shapes = constellations(5);
    expect(shapes.length).toBeGreaterThanOrEqual(2);
    expect(shapes.length).toBeLessThanOrEqual(3);
    for (const shape of shapes) {
      expect(shape.points.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of shape.points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      for (const [a, b] of shape.edges) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(shape.points.length);
        expect(a).not.toBe(b);
      }
    }
    expect(constellations(5)).toEqual(constellations(5));
  });
});
