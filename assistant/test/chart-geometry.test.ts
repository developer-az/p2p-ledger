import { describe, expect, it } from 'vitest';
import {
  areaPath,
  linePath,
  niceMax,
  scaleX,
  scaleY,
} from '../src/web/app/chart-geometry.js';

describe('niceMax', () => {
  it('picks the first nice step at or above the value', () => {
    expect(niceMax(1234)).toBe(2000);
    expect(niceMax(2000)).toBe(2000);
    expect(niceMax(250)).toBe(250);
    expect(niceMax(251)).toBe(500);
    expect(niceMax(9000)).toBe(10_000);
    expect(niceMax(7)).toBe(10);
  });

  it('falls back to 100 for zero and non-positive input', () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(-1)).toBe(100);
    expect(niceMax(-1234)).toBe(100);
  });

  it('falls back to 100 for non-finite input', () => {
    expect(niceMax(Number.NaN)).toBe(100);
    expect(niceMax(Number.POSITIVE_INFINITY)).toBe(100);
    expect(niceMax(Number.NEGATIVE_INFINITY)).toBe(100);
  });

  it('handles exact nice steps and gaps between them', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(2)).toBe(2);
    expect(niceMax(2.4)).toBe(2.5);
    expect(niceMax(2.5)).toBe(2.5);
    expect(niceMax(2.6)).toBe(5);
    expect(niceMax(10)).toBe(10);
  });
});

describe('scaleX', () => {
  it('centers the axis when there are no points', () => {
    expect(scaleX(0, 0, 400)).toBe(200);
    expect(scaleX(5, 0, 400)).toBe(200);
  });

  it('centers the axis for a single point', () => {
    expect(scaleX(0, 1, 400)).toBe(200);
    expect(scaleX(9, 1, 400)).toBe(200);
  });

  it('spans the full width for two points', () => {
    expect(scaleX(0, 2, 400)).toBe(0);
    expect(scaleX(1, 2, 400)).toBe(400);
  });

  it('places a middle index proportionally', () => {
    expect(scaleX(2, 4, 300)).toBe(200);
    expect(scaleX(1, 3, 100)).toBe(50);
  });

  it('does not round', () => {
    expect(scaleX(1, 4, 10)).toBeCloseTo(10 / 3, 12);
    expect(scaleX(1, 4, 10)).not.toBe(3.3);
  });
});

describe('scaleY', () => {
  it('maps zero to the bottom', () => {
    expect(scaleY(0, 100, 200)).toBe(200);
  });

  it('maps the max to the top', () => {
    expect(scaleY(100, 100, 200)).toBe(0);
  });

  it('clamps values above the max to the top', () => {
    expect(scaleY(150, 100, 200)).toBe(0);
  });

  it('clamps negative values to the bottom', () => {
    expect(scaleY(-50, 100, 200)).toBe(200);
  });

  it('uses the full height when max is zero or negative', () => {
    expect(scaleY(50, 0, 200)).toBe(200);
    expect(scaleY(0, 0, 200)).toBe(200);
    expect(scaleY(50, -10, 200)).toBe(200);
  });

  it('does not round', () => {
    expect(scaleY(25, 100, 300)).toBe(225);
    expect(scaleY(1, 3, 10)).toBeCloseTo(6.666666666666667, 12);
    expect(scaleY(1, 3, 10)).not.toBe(6.7);
  });
});

describe('linePath', () => {
  it('returns an empty string for no values', () => {
    expect(linePath([], 100, 100, 100)).toBe('');
  });

  it('draws a single point', () => {
    expect(linePath([50], 100, 100, 100)).toBe('M 50 50');
  });

  it('respects a count wider than the values for a single point', () => {
    expect(linePath([50], 100, 100, 100, 3)).toBe('M 0 50');
  });

  it('draws several points', () => {
    expect(linePath([0, 50, 100], 200, 100, 100)).toBe('M 0 100 L 100 50 L 200 0');
  });

  it('stretches a partial line across a wider axis', () => {
    expect(linePath([0, 100], 300, 100, 100, 5)).toBe('M 0 100 L 75 0');
  });

  it('rounds coordinates to one decimal', () => {
    expect(linePath([0, 12.34, 25], 100, 100, 100)).toBe('M 0 100 L 50 87.7 L 100 75');
  });

  it('rounds x coordinates across a wider axis', () => {
    expect(linePath([0, 0, 0], 100, 100, 100, 7)).toBe('M 0 100 L 16.7 100 L 33.3 100');
  });

  it('clamps negative values to the bottom edge', () => {
    expect(linePath([-10], 100, 100, 100)).toBe('M 50 100');
  });
});

describe('areaPath', () => {
  it('returns an empty string for no values', () => {
    expect(areaPath([], 100, 100, 100)).toBe('');
  });

  it('closes the line down to the baseline and back', () => {
    expect(areaPath([0, 50, 100], 200, 100, 100)).toBe(
      'M 0 100 L 100 50 L 200 0 L 200 100 L 0 100 Z',
    );
  });

  it('closes a two-point area', () => {
    expect(areaPath([10, 20], 100, 50, 100, 2)).toBe(
      'M 0 45 L 100 40 L 100 50 L 0 50 Z',
    );
  });

  it('closes a single-point area at its own x', () => {
    expect(areaPath([50], 100, 100, 100)).toBe('M 50 50 L 50 100 L 50 100 Z');
  });

  it('uses the rounded height for the baseline', () => {
    expect(areaPath([0, 0], 100, 12.34, 100, 2)).toBe(
      'M 0 12.3 L 100 12.3 L 100 12.3 L 0 12.3 Z',
    );
  });
});
