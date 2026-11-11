import { useId, useMemo, type CSSProperties } from 'react';
import { constellations, starField, type Constellation, type Star } from './starfield.js';

/**
 * A restrained star-atlas sky: faint nebula haze, a field of ink-or-white
 * stars, a handful of constellation sketches and a few celestial coordinate
 * arcs. One SVG per instance, decorative only. Colours come from custom
 * properties set in app.css, so the light paper atlas and the dark night sky
 * both work without a second markup path.
 */

const STAR_SEED = 1729;
const STAR_COUNT = 220;
const CONSTELLATION_SEED = 4021;

const HAZE: { cx: string; cy: string; r: string; tone: 'a' | 'b' | 'c' }[] = [
  { cx: '24%', cy: '22%', r: '62%', tone: 'a' },
  { cx: '78%', cy: '38%', r: '54%', tone: 'b' },
  { cx: '56%', cy: '84%', r: '58%', tone: 'c' },
];

const GRATICULE_RADII = [16, 28, 42, 58];

function constellationPath(shape: Constellation): string {
  const parts: string[] = [];
  for (const [a, b] of shape.edges) {
    const from = shape.points[a];
    const to = shape.points[b];
    if (!from || !to) continue;
    parts.push(`M${from[0].toFixed(2)} ${from[1].toFixed(2)}L${to[0].toFixed(2)} ${to[1].toFixed(2)}`);
  }
  return parts.join('');
}

function StarDot({ star, index }: { star: Star; index: number }) {
  if (!star.twinkle) {
    return <circle cx={star.x} cy={star.y} r={star.r} fill="currentColor" opacity={star.opacity} />;
  }
  const duration = 4 + (index % 7) * 0.5;
  const delay = (index % 11) * 0.63;
  const style = {
    '--star-base': star.opacity,
    '--star-dur': `${duration}s`,
    '--star-delay': `-${delay}s`,
  } as CSSProperties;
  return <circle className="star-twinkle" style={style} cx={star.x} cy={star.y} r={star.r} fill="currentColor" />;
}

export function StarSky({ variant }: { variant: 'backdrop' | 'scene' }) {
  const stars = useMemo(() => starField(STAR_SEED, STAR_COUNT), []);
  const shapes = useMemo(() => constellations(CONSTELLATION_SEED), []);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <svg
      className={`star-sky star-sky-${variant}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {HAZE.map((haze, i) => (
          <radialGradient key={haze.tone} id={`${uid}-haze-${i}`} cx={haze.cx} cy={haze.cy} r={haze.r}>
            <stop offset="0%" className={`star-haze-${haze.tone}`} stopOpacity="0.1" />
            <stop offset="100%" className={`star-haze-${haze.tone}`} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>

      {HAZE.map((haze, i) => (
        <rect key={haze.tone} width="100" height="100" fill={`url(#${uid}-haze-${i})`} />
      ))}

      <g className="star-graticule">
        {GRATICULE_RADII.map((r) => (
          <circle key={r} cx="50" cy="50" r={r} />
        ))}
      </g>

      {shapes.map((shape, i) => (
        <g key={i} className="star-constellation">
          <path d={constellationPath(shape)} />
          {shape.points.map(([x, y], j) => (
            <circle key={j} cx={x} cy={y} r="0.22" />
          ))}
        </g>
      ))}

      <g>
        {stars.map((star, i) => (
          <StarDot key={i} star={star} index={i} />
        ))}
      </g>
    </svg>
  );
}
