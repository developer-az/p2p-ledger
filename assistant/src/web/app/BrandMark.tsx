import { DIAL_LARGE, DIAL_SMALL, dialParts } from './brand-dial.js';

const round = (n: number) => n.toFixed(2);

const ticksPath = (ticks: { x1: number; y1: number; x2: number; y2: number }[]) =>
  ticks.map((t) => `M ${round(t.x1)} ${round(t.y1)} L ${round(t.x2)} ${round(t.y2)}`).join(' ');

/** Parts plus their tick paths, computed once per variant. */
function drawing(spec: typeof DIAL_LARGE) {
  const parts = dialParts(spec);
  return {
    ...parts,
    minorPath: ticksPath(parts.minorTicks),
    majorPath: ticksPath(parts.majorTicks),
  };
}

const LARGE = drawing(DIAL_LARGE);
const SMALL = drawing(DIAL_SMALL);

/**
 * Settle's emblem: an engine-turned (guilloché) watch dial. Static. Geometry
 * lives in brand-dial.ts (pure, tested).
 */
export function BrandMark({ size = 24, title, className }: { size?: number; title?: string; className?: string }) {
  const small = size <= 24;
  const spec = small ? DIAL_SMALL : DIAL_LARGE;
  const d = small ? SMALL : LARGE;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      className={['brand-mark', className].filter(Boolean).join(' ')}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle cx="32" cy="32" r={spec.bezelR} strokeWidth={spec.bezelWidth} />
      <path d={d.minorPath} strokeWidth={spec.tickWidth} />
      {d.majorPath && <path d={d.majorPath} strokeWidth={spec.majorWidth} />}
      <g strokeWidth={spec.roseWidth}>
        {d.rosette.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={spec.roseR} />
        ))}
      </g>
      {d.bossRing && <circle cx="32" cy="32" r={d.bossRing.r} strokeWidth={d.bossRing.width} />}
      <circle cx="32" cy="32" r={spec.bossR} fill="currentColor" stroke="none" />
    </svg>
  );
}
