/**
 * Deterministic star-atlas geometry. Pure functions only: the sky is generated
 * from a seed so it is identical on every render and between server and client,
 * and no random values leak into React.
 */

export interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  layer: 0 | 1 | 2;
  twinkle: boolean;
}

export interface Constellation {
  points: [number, number][];
  edges: [number, number][];
}

/** Mulberry32: a small, fast, seeded PRNG. Same seed, same stream. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const TWINKLE_RATE = 0.07;

/**
 * A field of stars inside a 0-100 viewBox. Three depth layers: far stars are
 * small and dim and make up most of the sky, near stars are larger and brighter.
 */
export function starField(seed: number, count: number): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  let twinkling = 0;

  for (let i = 0; i < count; i += 1) {
    const pick = rand();
    const layer: Star['layer'] = pick < 0.65 ? 0 : pick < 0.9 ? 1 : 2;
    const r = layer === 0 ? between(rand, 0.05, 0.1) : layer === 1 ? between(rand, 0.09, 0.16) : between(rand, 0.15, 0.28);
    const opacity = layer === 0 ? between(rand, 0.25, 0.5) : layer === 1 ? between(rand, 0.45, 0.75) : between(rand, 0.7, 1);
    const twinkle = rand() < TWINKLE_RATE;
    if (twinkle) twinkling += 1;
    stars.push({ x: between(rand, 0, 100), y: between(rand, 0, 100), r, opacity, layer, twinkle });
  }

  // A small field can roll no twinkling star at all; keep at least one, but
  // only when one star stays under the 12% ceiling.
  if (twinkling === 0 && stars.length >= 9) {
    const index = Math.floor(rand() * stars.length);
    const star = stars[index];
    if (star) star.twinkle = true;
  }

  return stars;
}

/**
 * Two or three small constellation sketches: a handful of points joined by a
 * simple path with one short branch. Coordinates live in the same 0-100 box as
 * the star field so both can share one SVG.
 */
export function constellations(seed: number): Constellation[] {
  const rand = mulberry32(seed);
  const shapes: Constellation[] = [];
  const shapeCount = 2 + Math.floor(rand() * 2);

  for (let s = 0; s < shapeCount; s += 1) {
    const pointCount = 4 + Math.floor(rand() * 4);
    const cx = between(rand, 18, 82);
    const cy = between(rand, 18, 82);
    const points: [number, number][] = [];

    for (let i = 0; i < pointCount; i += 1) {
      const x = clamp(cx + (rand() - 0.5) * 26, 2, 98);
      const y = clamp(cy + (rand() - 0.5) * 20, 2, 98);
      points.push([x, y]);
    }

    const edges: [number, number][] = [];
    for (let i = 0; i < pointCount - 1; i += 1) edges.push([i, i + 1]);
    if (pointCount >= 5) edges.push([0, 3]);

    shapes.push({ points, edges });
  }

  return shapes;
}
