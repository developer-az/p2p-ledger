/**
 * Settle's emblem: an engine-turned (guilloché) watch dial. Static. DIAL_SMALL
 * is the simplified cut for 24px and below.
 */
export interface DialSpec {
  bezelR: number;
  bezelWidth: number;
  ticks: number;
  tickIn: number;
  tickOut: number;
  tickWidth: number;
  majorEvery: number;
  majorIn: number;
  majorWidth: number;
  roseCount: number;
  roseR: number;
  roseOffset: number;
  roseWidth: number;
  bossR: number;
  bossRingR: number;
  bossRingWidth: number;
}

export interface DialTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DialParts {
  minorTicks: DialTick[];
  majorTicks: DialTick[];
  rosette: { cx: number; cy: number }[];
  bossRing: { r: number; width: number } | null;
}

export const DIAL_LARGE: DialSpec = {
  bezelR: 29.4,
  bezelWidth: 2,
  ticks: 60,
  tickIn: 23.6,
  tickOut: 26.4,
  tickWidth: 0.9,
  majorEvery: 5,
  majorIn: 22.6,
  majorWidth: 1.5,
  roseCount: 30,
  roseR: 12,
  roseOffset: 9,
  roseWidth: 0.55,
  bossR: 2.2,
  bossRingR: 3.4,
  bossRingWidth: 0.9,
};

export const DIAL_SMALL: DialSpec = {
  bezelR: 29,
  bezelWidth: 3.4,
  ticks: 12,
  tickIn: 21.5,
  tickOut: 25.5,
  tickWidth: 2.6,
  majorEvery: 0,
  majorIn: 0,
  majorWidth: 0,
  roseCount: 12,
  roseR: 11,
  roseOffset: 8.5,
  roseWidth: 1.5,
  bossR: 3.4,
  bossRingR: 0,
  bossRingWidth: 0,
};

const CENTRE = 32;

/** Point at radius `r` on the dial face, angle measured clockwise from 12 o'clock. */
function point(r: number, angle: number): { x: number; y: number } {
  return { x: CENTRE + r * Math.sin(angle), y: CENTRE - r * Math.cos(angle) };
}

export function dialParts(spec: DialSpec): DialParts {
  const minorTicks: DialTick[] = [];
  const majorTicks: DialTick[] = [];

  for (let i = 0; i < spec.ticks; i += 1) {
    const angle = (2 * Math.PI * i) / spec.ticks;
    const major = spec.majorEvery > 0 && i % spec.majorEvery === 0;
    const from = point(major ? spec.majorIn : spec.tickIn, angle);
    const to = point(spec.tickOut, angle);
    const tick = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    (major ? majorTicks : minorTicks).push(tick);
  }

  const rosette: { cx: number; cy: number }[] = [];
  for (let i = 0; i < spec.roseCount; i += 1) {
    const angle = (2 * Math.PI * i) / spec.roseCount;
    const c = point(spec.roseOffset, angle);
    rosette.push({ cx: c.x, cy: c.y });
  }

  return {
    minorTicks,
    majorTicks,
    rosette,
    bossRing: spec.bossRingR > 0 ? { r: spec.bossRingR, width: spec.bossRingWidth } : null,
  };
}
