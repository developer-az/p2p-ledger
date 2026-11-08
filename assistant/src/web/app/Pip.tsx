import { useEffect, useRef, useState } from 'react';
import { m, useReducedMotion, useSpring } from 'motion/react';

/**
 * Pip — Settle's mascot. A squishy lime bean with a sprout on top, stubby
 * hands and feet. Pip watches the pointer (or whatever `lookAt` points at),
 * blinks, fidgets when left alone, leans into a hover, and reacts to how the
 * week is going. Pure SVG + springs, no assets.
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

/** Things Pip does on its own when nobody is asking anything of it. */
type Act = null | 'hop' | 'glance' | 'shake' | 'wave' | 'pet' | 'cheer';
const IDLE_ACTS: Act[] = ['hop', 'glance', 'shake', 'glance', 'wave'];

/** How long each act holds the stage, in ms. */
const ACT_MS: Record<Exclude<Act, null>, number> = {
  hop: 760,
  glance: 1500,
  shake: 900,
  wave: 1300,
  pet: 900,
  cheer: 1400,
};

export function Pip({
  mood = 'calm',
  size = 96,
  cheer = 0,
  track = true,
  idle = true,
  greet = false,
  shy = false,
  peek = false,
  lookAt = null,
  className,
  onTap,
}: {
  mood?: PipMood;
  size?: number;
  /** Bump this number to make Pip jump once (e.g. after a log). */
  cheer?: number;
  /** Eyes follow the pointer. Turn off for tiny or repeated instances. */
  track?: boolean;
  /** Small unprompted fidgets now and then. Off for logos and tiny Pips. */
  idle?: boolean;
  /** Wave hello once when Pip first appears. */
  greet?: boolean;
  /** Hands over the eyes: someone is typing a password. */
  shy?: boolean;
  /** With `shy`, one hand slips down so Pip can peek (the password is shown). */
  peek?: boolean;
  /** A point on screen (client coordinates) to look at instead of the pointer. */
  lookAt?: { x: number; y: number } | null;
  className?: string;
  onTap?: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const eyeX = useSpring(0, { stiffness: 170, damping: 17 });
  const eyeY = useSpring(0, { stiffness: 170, damping: 17 });
  // The sprout trails the eyes a little and overshoots: it is a soft stem.
  const sway = useSpring(0, { stiffness: 90, damping: 7, mass: 0.7 });
  const [blink, setBlink] = useState(false);
  const [act, setAct] = useState<Act>(greet ? 'wave' : null);
  const actTimer = useRef(0);
  const lookRef = useRef(lookAt);
  lookRef.current = lookAt;

  const play = (next: Exclude<Act, null>) => {
    window.clearTimeout(actTimer.current);
    setAct(next);
    actTimer.current = window.setTimeout(() => setAct(null), ACT_MS[next]);
  };

  const shown: PipMood = act === 'cheer' ? 'party' : mood;
  const joyful = act === 'pet' || shown === 'party' || shown === 'happy';

  // Aim the eyes at a screen point, with a sprout that leans the other way.
  const aim = (x: number, y: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, dist / 260);
    eyeX.set((dx / dist) * 4.5 * reach);
    eyeY.set((dy / dist) * 3.5 * reach);
    sway.set(Math.max(-14, Math.min(14, (-dx / dist) * 10 * reach)));
  };

  useEffect(() => {
    if (reduce) return;
    if (lookAt) {
      aim(lookAt.x, lookAt.y);
      return;
    }
    if (!track) return;
    const onMove = (e: PointerEvent) => {
      if (lookRef.current) return;
      aim(e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [track, reduce, lookAt?.x, lookAt?.y]);

  useEffect(() => {
    if (reduce || shown === 'sleepy') return;
    let id = 0;
    const loop = () => {
      id = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 130);
        // Now and then a double blink, the way people actually blink.
        if (Math.random() < 0.25) window.setTimeout(() => { setBlink(true); window.setTimeout(() => setBlink(false), 110); }, 260);
        loop();
      }, 2200 + Math.random() * 3000);
    };
    loop();
    return () => window.clearTimeout(id);
  }, [reduce, shown]);

  // Fidgets: every 7 to 13 seconds, one small thing, never while asleep or shy.
  useEffect(() => {
    if (!idle || reduce || shy || mood === 'sleepy') return;
    let id = 0;
    const loop = () => {
      id = window.setTimeout(() => {
        const next = IDLE_ACTS[Math.floor(Math.random() * IDLE_ACTS.length)]!;
        if (next === 'glance' && !lookRef.current) {
          // Look off to one side, then the other, then back to the pointer.
          eyeX.set(-4.5); sway.set(9);
          window.setTimeout(() => { eyeX.set(4.5); sway.set(-9); }, 520);
          window.setTimeout(() => { eyeX.set(0); sway.set(0); }, 1100);
        }
        play(next ?? 'hop');
        loop();
      }, 7000 + Math.random() * 6000);
    };
    loop();
    return () => window.clearTimeout(id);
  }, [idle, reduce, shy, mood, eyeX, sway]);

  useEffect(() => {
    if (!cheer) return;
    play('cheer');
  }, [cheer]);

  useEffect(() => () => window.clearTimeout(actTimer.current), []);

  const eyesClosed = (blink && !shy) || shown === 'sleepy';
  const label = shy
    ? 'Pip is covering its eyes'
    : {
      happy: 'Pip is happy',
      calm: 'Pip is chilling',
      worried: 'Pip looks a little worried',
      party: 'Pip is celebrating',
      sleepy: 'Pip is waiting for today’s first log',
    }[shown];

  // Whole-body motion for each act. Squash before a hop, stretch in the air,
  // squash again on landing, settle: the four poses of a bounce.
  const bodyAnim = reduce
    ? undefined
    : act === 'cheer' || shown === 'party'
      ? { y: [0, 2, -16, 0, -6, 0], scaleX: [1, 1.1, 0.9, 1.08, 0.97, 1], scaleY: [1, 0.88, 1.12, 0.9, 1.04, 1], rotate: [0, 0, -6, 4, -2, 0] }
      : act === 'hop'
        ? { y: [0, 1.5, -9, 0, 0], scaleX: [1, 1.08, 0.94, 1.06, 1], scaleY: [1, 0.9, 1.08, 0.93, 1] }
        : act === 'pet'
          ? { rotate: [0, -5, 4, -2, 0], scaleX: [1, 1.05, 0.98, 1], scaleY: [1, 0.95, 1.02, 1] }
          : shown === 'worried'
            ? { rotate: [0, -2, 2, 0] }
            : { y: 0, rotate: 0, scaleX: 1, scaleY: 1 };
  const bodyTransition = act === 'cheer' || shown === 'party'
    ? { duration: 1.1, ease: [0.23, 1, 0.32, 1] as const }
    : act === 'hop'
      ? { duration: 0.7, times: [0, 0.18, 0.5, 0.78, 1] }
      : act === 'pet'
        ? { duration: 0.8 }
        : { duration: 2.4, repeat: shown === 'worried' ? Infinity : 0 };

  // Hands rest at the sides; they rise to cover the eyes when shy (the eyes
  // sit at 38,48 and 62,48; the hands rest at 16,64 and 84,64), and the
  // right one comes up and wiggles on a greeting. Position only: a rotation
  // on an SVG ellipse turns about its own box and throws the hand off target.
  const leftHand = act === 'cheer'
    ? { x: -2, y: -18 }
    : shy ? { x: 22, y: -16 } : { x: 0, y: 0 };
  const rightHand = shy
    ? peek ? { x: -14, y: -4 } : { x: -22, y: -16 }
    : act === 'wave'
      ? { x: [0, 3, 7, 1, 7, 1, 3], y: [0, -20, -20, -20, -20, -20, 0] }
      : act === 'cheer'
        ? { x: 2, y: -18 }
        : { x: 0, y: 0 };

  const svg = (
    <m.svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`pip${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      initial={false}
      animate={bodyAnim}
      transition={bodyTransition}
      whileTap={reduce ? undefined : { scaleX: 1.12, scaleY: 0.86 }}
      onPointerEnter={() => { if (!reduce && !shy && act === null) play('pet'); }}
      style={{ overflow: 'visible', transformOrigin: '50% 92%' }}
    >
      <ellipse cx="50" cy="96" rx="26" ry="3.5" className="pip-shadow" />
      <g className={reduce ? undefined : 'pip-breathe'}>
        {/* Feet first, so the body sits on them. */}
        <ellipse cx="38" cy="92" rx="8" ry="4.5" className="pip-foot" />
        <ellipse cx="62" cy="92" rx="8" ry="4.5" className="pip-foot" />

        {/* The sprout: a stem and two leaves that lean against the gaze. */}
        <m.g className="pip-sprout" style={{ rotate: sway, originX: '50px', originY: '13px' }}>
          <g className={reduce ? undefined : act === 'shake' ? 'pip-sprout-shake' : 'pip-sprout-idle'}>
            <path className="pip-stem" d="M50 13 C50 8 51 5 52 1" />
            <path className="pip-leaf" d="M52 2 C58 -6 68 -5 70 -1 C64 3 57 4 52 2 Z" />
            <path className="pip-leaf pip-leaf-b" d="M51 4 C46 -3 37 -3 35 1 C40 5 46 6 51 4 Z" />
          </g>
        </m.g>

        <path
          className="pip-body"
          d="M50 10 C76 10 90 30 90 55 C90 80 73 92 50 92 C27 92 10 80 10 55 C10 30 24 10 50 10 Z"
        />
        <path className="pip-shine" d="M28 26 C33 19 41 16 48 16" />
        {shown === 'worried' && !shy ? (
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
          ) : joyful && !shy ? (
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
          <ellipse cx="29" cy="60" rx="5" ry="3" className={`pip-blush${act === 'pet' || shy ? ' is-warm' : ''}`} />
          <ellipse cx="71" cy="60" rx="5" ry="3" className={`pip-blush${act === 'pet' || shy ? ' is-warm' : ''}`} />
          <path d={shy ? 'M45 65 Q50 63 55 65' : MOUTH[shown]} className={`pip-mouth${shown === 'party' && !shy ? ' is-open' : ''}`} />
        </m.g>

        {/* Hands, drawn last so they can cover the eyes. */}
        <m.ellipse
          cx="16" cy="64" rx="7" ry="6"
          className="pip-hand"
          initial={false}
          animate={reduce ? undefined : leftHand}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        />
        <m.ellipse
          cx="84" cy="64" rx="7" ry="6"
          className="pip-hand"
          initial={false}
          animate={reduce ? undefined : rightHand}
          transition={act === 'wave' ? { duration: ACT_MS.wave / 1000, ease: 'easeInOut' } : { type: 'spring', stiffness: 260, damping: 18 }}
        />
        {shown === 'sleepy' && !shy ? <text x="78" y="22" className="pip-z">z</text> : null}
      </g>
    </m.svg>
  );

  if (!onTap) return svg;
  return (
    <button type="button" className="pip-btn" onClick={() => { play('cheer'); onTap(); }} aria-label={`${label}. Tap to add something`}>
      {svg}
    </button>
  );
}
