import { describe, expect, it } from 'vitest';
import { DIAL_LARGE, DIAL_SMALL, dialParts } from '../src/web/app/brand-dial.js';

describe('dialParts', () => {
  it('builds the large dial: 60 ticks with every fifth one major, 30 rosette circles', () => {
    const p = dialParts(DIAL_LARGE);
    expect(p.minorTicks.length + p.majorTicks.length).toBe(60);
    expect(p.majorTicks.length).toBe(12);
    expect(p.rosette).toHaveLength(30);
    expect(p.bossRing).not.toBeNull();
  });

  it('builds the small dial: 12 ticks, no major set, 12 heavier rosette circles, no boss ring', () => {
    const p = dialParts(DIAL_SMALL);
    expect(p.minorTicks).toHaveLength(12);
    expect(p.majorTicks).toHaveLength(0);
    expect(p.rosette).toHaveLength(12);
    expect(p.bossRing).toBeNull();
    expect(DIAL_SMALL.roseWidth).toBeGreaterThan(DIAL_LARGE.roseWidth);
  });

  it('keeps every element inside the 64x64 viewBox and centred on (32, 32)', () => {
    for (const spec of [DIAL_LARGE, DIAL_SMALL]) {
      const p = dialParts(spec);
      expect(spec.bezelR + spec.bezelWidth / 2).toBeLessThanOrEqual(32);
      for (const c of p.rosette) {
        expect(Math.hypot(c.cx - 32, c.cy - 32)).toBeCloseTo(spec.roseOffset, 5);
        expect(Math.hypot(c.cx - 32, c.cy - 32) + spec.roseR).toBeLessThan(spec.bezelR);
      }
      for (const t of [...p.minorTicks, ...p.majorTicks]) {
        for (const [x, y] of [[t.x1, t.y1], [t.x2, t.y2]]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(64);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  it('starts the first tick at 12 o\'clock and is deterministic', () => {
    const p = dialParts(DIAL_LARGE);
    const first = p.majorTicks[0]!;
    expect(first.x1).toBeCloseTo(32, 5);
    expect(first.y1).toBeLessThan(32);
    expect(dialParts(DIAL_LARGE)).toEqual(p);
  });
});
