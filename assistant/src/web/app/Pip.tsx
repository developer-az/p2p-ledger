import { useEffect, useRef, useState } from 'react';
import { m, useReducedMotion, useSpring } from 'motion/react';

/**
 * Pip — Settle's mascot. A squishy lime bean that watches your cursor, blinks,
 * and reacts to how the week is going. Pure SVG + springs, no assets.
 *
 * Mood is derived by the caller from real numbers (see `pipMood`), so Pip never
 * celebrates something that didn't happen.
 */

export type PipMood = 'happy' | 'calm' | 'worried' | 'party' | 'sleepy';

export function pipMood(input: { overBudget: boolean; streakDays: number; loggedToday: boolean; hasData: boolean }): PipMood {
  if (!input.hasData) return 'calm';
  if (input.overBudget) return 'worried';
  if (!input.loggedToday) return 'sleepy';
  return input.streakDays >= 3 ? 'happy' : 'calm';
}

const MOUTH: Record<PipMood, string> = {
  happy: 'M40 62 Q50 72 60 62',
  calm: 'M43 63 Q50 67 57 63',
  worried: 'M42 66 Q46 62 50 65 Q54 68 58 64',
  party: 'M40 60 Q50 76 60 60 Z',
  sleepy: 'M45 64 Q50 66 55 64',
};

export function Pip({
  mood = 'calm',
  size = 96,
  cheer = 0,
  track = true,
  className,
  onTap,
}: {
  mood?: PipMood;
  size?: number;
  /** Bump this number to make Pip jump once (e.g. after a log). */
  cheer?: number;
  /** Eyes follow the pointer. Turn off for tiny or repeated instances. */
  track?: boolean;
  className?: string;
  onTap?: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const eyeX = useSpring(0, { stiffness: 160, damping: 18 });
  const eyeY = useSpring(0, { stiffness: 160, damping: 18 });
  const [blink, setBlink] = useState(false);
  const [jump, setJump] = useState(0);
  const shown: PipMood = jump > 0 ? 'party' : mood;

  useEffect(() => {
    if (!track || reduce) return;
    const onMove = (e: PointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 260);
      eyeX.set((dx / dist) * 4.5 * reach);
      eyeY.set((dy / dist) * 3.5 * reach);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [track, reduce, eyeX, eyeY]);

  useEffect(() => {
    if (reduce || shown === 'sleepy') return;
    let id = 0;
    const loop = () => {
      id = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 130);
        loop();
      }, 2400 + Math.random() * 2800);
    };
    loop();
    return () => window.clearTimeout(id);
  }, [reduce, shown]);

  useEffect(() => {
    if (!cheer) return;
    setJump((j) => j + 1);
    const id = window.setTimeout(() => setJump(0), 1400);
    return () => window.clearTimeout(id);
  }, [cheer]);

  const eyesClosed = blink || shown === 'sleepy';
  const label = {
    happy: 'Pip is happy',
    calm: 'Pip is chilling',
    worried: 'Pip looks a little worried',
    party: 'Pip is celebrating',
    sleepy: 'Pip is waiting for today’s first log',
  }[shown];

  const body = (
    <m.svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`pip${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      initial={false}
      animate={
        reduce
          ? undefined
          : shown === 'party'
            ? { y: [0, -14, 0, -6, 0], rotate: [0, -6, 6, -3, 0] }
            : shown === 'worried'
              ? { rotate: [0, -2, 2, 0] }
              : { y: 0, rotate: 0 }
      }
      transition={shown === 'party' ? { duration: 0.9, ease: [0.23, 1, 0.32, 1] } : { duration: 2.4, repeat: shown === 'worried' ? Infinity : 0 }}
      whileTap={reduce ? undefined : { scaleX: 1.12, scaleY: 0.86 }}
      style={{ overflow: 'visible', transformOrigin: '50% 90%' }}
    >
      <ellipse cx="50" cy="95" rx="26" ry="3.5" className="pip-shadow" />
      <g className={reduce ? undefined : 'pip-breathe'}>
        <path
          className="pip-body"
          d="M50 10 C76 10 90 30 90 55 C90 80 73 92 50 92 C27 92 10 80 10 55 C10 30 24 10 50 10 Z"
        />
        <path className="pip-shine" d="M28 26 C33 19 41 16 48 16" />
        {shown === 'worried' ? (
          <g className="pip-brow">
            <path d="M33 37 L42 40" />
            <path d="M67 37 L58 40" />
          </g>
        ) : null}
        <m.g style={{ x: eyeX, y: eyeY }}>
          {eyesClosed ? (
            <g className="pip-lid">
              <path d={shown === 'sleepy' ? 'M33 50 Q38 53 43 50' : 'M33 49 L43 49'} />
              <path d={shown === 'sleepy' ? 'M57 50 Q62 53 67 50' : 'M57 49 L67 49'} />
            </g>
          ) : shown === 'party' || shown === 'happy' ? (
            <g className="pip-lid">
              <path d="M33 51 Q38 44 43 51" />
              <path d="M57 51 Q62 44 67 51" />
            </g>
          ) : (
            <g className="pip-eye">
              <ellipse cx="38" cy="48" rx="4.6" ry="6" />
              <ellipse cx="62" cy="48" rx="4.6" ry="6" />
              <circle cx="39.6" cy="45.6" r="1.6" className="pip-glint" />
              <circle cx="63.6" cy="45.6" r="1.6" className="pip-glint" />
            </g>
          )}
          <ellipse cx="29" cy="60" rx="5" ry="3" className="pip-blush" />
          <ellipse cx="71" cy="60" rx="5" ry="3" className="pip-blush" />
          <path d={MOUTH[shown]} className={`pip-mouth${shown === 'party' ? ' is-open' : ''}`} />
        </m.g>
        {shown === 'sleepy' ? <text x="78" y="22" className="pip-z">z</text> : null}
      </g>
    </m.svg>
  );

  if (!onTap) return body;
  return (
    <button type="button" className="pip-btn" onClick={() => { setJump((j) => j + 1); window.setTimeout(() => setJump(0), 1000); onTap(); }} aria-label={`${label}. Tap to log a spend`}>
      {body}
    </button>
  );
}
