import { useEffect, useId, useRef, useState } from 'react';
import { m, useReducedMotion, useSpring } from 'motion/react';

/**
 * Settle — the mascot. A squishy lime bean with a sprout on top, stubby hands
 * and feet. Settle watches the pointer (or whatever `lookAt` points at), blinks,
 * fidgets when left alone, leans into a hover, and reacts to how the week is
 * going. Pure SVG + springs, no assets.
 *
 * Mood is derived by the caller from real numbers (see `mascotMood`), so Settle
 * never celebrates something that didn't happen.
 */

export type MascotMood = 'happy' | 'calm' | 'worried' | 'party' | 'sleepy';

export function mascotMood(input: { overBudget: boolean; streakDays: number; loggedToday: boolean; hasData: boolean }): MascotMood {
  if (!input.hasData) return 'calm';
  if (input.overBudget) return 'worried';
  if (!input.loggedToday) return 'sleepy';
  return input.streakDays >= 3 ? 'happy' : 'calm';
}

const MOUTH: Record<MascotMood, string> = {
  happy: 'M40 62 Q50 72 60 62',
  calm: 'M43 63 Q50 67 57 63',
  worried: 'M42 66 Q46 62 50 65 Q54 68 58 64',
  party: 'M40 60 Q50 76 60 60 Z',
  sleepy: 'M45 64 Q50 66 55 64',
};

/** Things Settle does on its own when nobody is asking anything of it. */
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

export function Mascot({
  mood = 'calm',
  size = 96,
  cheer = 0,
  track = true,
  idle = true,
  greet = false,
  shy = false,
  peek = false,
  still = false,
  lookAt = null,
  className,
  onTap,
}: {
  mood?: MascotMood;
  size?: number;
  /** Bump this number to make Settle jump once (e.g. after a log). */
  cheer?: number;
  /** Eyes follow the pointer. Turn off for tiny or repeated instances. */
  track?: boolean;
  /** Small unprompted fidgets now and then. Off for logos and tiny instances. */
  idle?: boolean;
  /**
   * A static Settle: no blink, idle, tracking, tilt or breathing, so a long
   * message history does not mount dozens of timers and listeners.
   */
  still?: boolean;
  /** Wave hello once when Settle first appears. */
  greet?: boolean;
  /** Hands over the eyes: someone is typing a password. */
  shy?: boolean;
  /** With `shy`, one hand slips down so Settle can peek (the password is shown). */
  peek?: boolean;
  /** A point on screen (client coordinates) to look at instead of the pointer. */
  lookAt?: { x: number; y: number } | null;
  className?: string;
  onTap?: () => void;
}) {
  const reduce = useReducedMotion();
  // `still` gives the same frozen rendering as reduced motion, without the timers.
  const motionOff = reduce || still;
  const ref = useRef<SVGSVGElement>(null);
  // Gradient and filter ids are per instance, so many Settles can share a page.
  const uid = useId().replace(/:/g, '');
  const eyeX = useSpring(0, { stiffness: 170, damping: 17 });
  const eyeY = useSpring(0, { stiffness: 170, damping: 17 });
  // The sprout trails the eyes a little and overshoots: it is a soft stem.
  const sway = useSpring(0, { stiffness: 90, damping: 7, mass: 0.7 });
  // Depth: the toy leans away from the thing it is looking at.
  const tiltX = useSpring(0, { stiffness: 120, damping: 14 });
  const tiltY = useSpring(0, { stiffness: 120, damping: 14 });
  const [blink, setBlink] = useState(false);
  const [act, setAct] = useState<Act>(greet && !still ? 'wave' : null);
  const actTimer = useRef(0);
  const lookRef = useRef(lookAt);
  lookRef.current = lookAt;

  const play = (next: Exclude<Act, null>) => {
    window.clearTimeout(actTimer.current);
    setAct(next);
    actTimer.current = window.setTimeout(() => setAct(null), ACT_MS[next]);
  };

  const shown: MascotMood = act === 'cheer' ? 'party' : mood;
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
    // The 3D lean only happens while the pointer is actually being tracked.
    if (!track || motionOff) return;
    const rx = Math.max(-1, Math.min(1, dx / (box.width / 2 || 1)));
    const ry = Math.max(-1, Math.min(1, dy / (box.height / 2 || 1)));
    tiltY.set(rx * 14);
    tiltX.set(-ry * 10);
  };

  useEffect(() => {
    if (still) return;
    if (reduce || !track) {
      tiltX.set(0);
      tiltY.set(0);
    }
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
  }, [track, reduce, still, lookAt?.x, lookAt?.y]);

  useEffect(() => {
    if (motionOff || shown === 'sleepy') return;
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
  }, [motionOff, shown]);

  // Fidgets: every 7 to 13 seconds, one small thing, never while asleep or shy.
  useEffect(() => {
    if (still || !idle || reduce || shy || mood === 'sleepy') return;
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
  }, [idle, reduce, still, shy, mood, eyeX, sway]);

  useEffect(() => {
    if (still || !cheer) return;
    play('cheer');
  }, [still, cheer]);

  useEffect(() => () => window.clearTimeout(actTimer.current), []);

  const eyesClosed = (blink && !shy) || shown === 'sleepy';
  const label = shy
    ? 'Settle is covering its eyes'
    : {
      happy: 'Settle is happy',
      calm: 'Settle is chilling',
      worried: 'Settle looks a little worried',
      party: 'Settle is celebrating',
      sleepy: 'Settle is waiting for today’s first log',
    }[shown];

  // Whole-body motion for each act. Squash before a hop, stretch in the air,
  // squash again on landing, settle: the four poses of a bounce.
  const bodyAnim = motionOff
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

  const BODY = 'M50 10 C76 10 90 30 90 55 C90 80 73 92 50 92 C27 92 10 80 10 55 C10 30 24 10 50 10 Z';
  // Below 40px the extra light layers turn to mud; the tiny logo stays crisp.
  const detailed = size >= 40;
  const openMouth = shown === 'party' && !shy;
  const warm = act === 'pet' || shy;

  const svg = (
    <span
      className="mascot-tilt"
      style={{ display: 'inline-block', lineHeight: 0, flex: 'none', perspective: 600 }}
    >
      <m.span
        className="mascot-tilt-inner"
        style={{ display: 'inline-block', lineHeight: 0, rotateX: tiltX, rotateY: tiltY }}
      >
        <m.svg
          ref={ref}
          viewBox="0 0 100 100"
          width={size}
          height={size}
          className={`mascot${className ? ` ${className}` : ''}`}
          role="img"
          aria-label={label}
          initial={false}
          animate={bodyAnim}
          transition={bodyTransition}
          whileTap={motionOff ? undefined : { scaleX: 1.12, scaleY: 0.86 }}
          onPointerEnter={() => { if (!motionOff && !shy && act === null) play('pet'); }}
          style={{ overflow: 'visible', transformOrigin: '50% 92%' }}
        >
          <defs>
            {/* The body: warm light from the top left, deep shade at the rim. */}
            <radialGradient id={`mascot-body-${uid}`} cx="38%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#f4ffb8" />
              <stop offset="35%" stopColor="#d4fb4c" />
              <stop offset="70%" stopColor="#a8e01e" />
              <stop offset="100%" stopColor="#5f9a0c" />
            </radialGradient>
            {/* Ambient occlusion: where the bean meets the ground. */}
            <radialGradient id={`mascot-ao-${uid}`} cx="50%" cy="95%" r="75%">
              <stop offset="0%" stopColor="rgb(40 70 0)" stopOpacity="0.35" />
              <stop offset="60%" stopColor="rgb(40 70 0)" stopOpacity="0" />
            </radialGradient>
            {/* Rim light: only the top-left edge catches it. */}
            <linearGradient id={`mascot-rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
              <stop offset="40%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            {/* Specular: the soft vinyl sheen. */}
            <radialGradient id={`mascot-spec-${uid}`}>
              <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            {/* Eyes: glossy black with a light top. */}
            <radialGradient id={`mascot-eye-${uid}`} cx="50%" cy="22%" r="85%">
              <stop offset="0%" stopColor="#3a3f4a" />
              <stop offset="100%" stopColor="#0b0d12" />
            </radialGradient>
            <linearGradient id={`mascot-mouth-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b1220" />
              <stop offset="100%" stopColor="#7a2a3d" />
            </linearGradient>
            {/* Blush: a strong pink core so it stays pink on the lime body. */}
            <radialGradient id={`mascot-blush-${uid}`}>
              <stop offset="0%" stopColor="#ff7c9c" stopOpacity="0.85" />
              <stop offset="55%" stopColor="#ff9db4" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ff9db4" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`mascot-hand-${uid}`} cx="32%" cy="26%" r="85%">
              <stop offset="0%" stopColor="#d8fb6a" />
              <stop offset="100%" stopColor="#7fb514" />
            </radialGradient>
            <radialGradient id={`mascot-foot-${uid}`} cx="32%" cy="26%" r="85%">
              <stop offset="0%" stopColor="#c3ef3c" />
              <stop offset="100%" stopColor="#5f9a0c" />
            </radialGradient>
            <linearGradient id={`mascot-leaf-${uid}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#b5f07c" />
              <stop offset="100%" stopColor="#4fae3a" />
            </linearGradient>
            <filter id={`mascot-contact-${uid}`} x="-50%" y="-300%" width="200%" height="700%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
          </defs>

          <ellipse
            cx="50" cy="96" rx="26" ry="3.5"
            className="mascot-shadow"
            fill="rgb(20 30 10 / 28%)"
            filter={`url(#mascot-contact-${uid})`}
          />
          <g className={motionOff ? undefined : 'mascot-breathe'}>
            {/* Feet first, so the body sits on them. */}
            <ellipse cx="38" cy="92" rx="8" ry="4.5" className="mascot-foot" fill={`url(#mascot-foot-${uid})`} stroke="rgb(46 82 6 / 55%)" strokeWidth={1} />
            <ellipse cx="62" cy="92" rx="8" ry="4.5" className="mascot-foot" fill={`url(#mascot-foot-${uid})`} stroke="rgb(46 82 6 / 55%)" strokeWidth={1} />

            {/* The sprout: a stem and two leaves that lean against the gaze. */}
            <m.g className="mascot-sprout" style={{ rotate: sway, originX: '50px', originY: '13px' }}>
              <g className={motionOff ? undefined : act === 'shake' ? 'mascot-sprout-shake' : 'mascot-sprout-idle'}>
                <path className="mascot-stem" d="M50 13 C50 8 51 5 52 1" />
                <path
                  className="mascot-leaf"
                  d="M52 2 C58 -6 68 -5 70 -1 C64 3 57 4 52 2 Z"
                  fill={`url(#mascot-leaf-${uid})`}
                  stroke="rgb(30 70 20 / 50%)"
                  strokeWidth={1}
                />
                <path
                  className="mascot-leaf"
                  d="M51 4 C46 -3 37 -3 35 1 C40 5 46 6 51 4 Z"
                  fill={`url(#mascot-leaf-${uid})`}
                  stroke="rgb(30 70 20 / 50%)"
                  strokeWidth={1}
                />
                <path className="mascot-vein" d="M53 2 C58 0 62 -1 67 -1" />
                <path className="mascot-vein" d="M50 4 C45 3 41 2 37 1.5" />
              </g>
            </m.g>

            {/* Body: volume, then the lower-body shade, then the top-left rim. */}
            <path
              className="mascot-body"
              d={BODY}
              fill={`url(#mascot-body-${uid})`}
              stroke="rgb(46 82 6 / 55%)"
              strokeWidth={1.2}
            />
            {detailed ? (
              <>
                <path className="mascot-body-ao" d={BODY} fill={`url(#mascot-ao-${uid})`} stroke="none" />
                <path className="mascot-body-rim" d={BODY} fill="none" stroke={`url(#mascot-rim-${uid})`} strokeWidth={2.2} />
              </>
            ) : null}
            <g className="mascot-spec" transform="rotate(-28 34 27)">
              <ellipse cx="34" cy="27" rx="11" ry="6.5" fill={`url(#mascot-spec-${uid})`} />
            </g>
            <circle className="mascot-glint-sharp" cx="30" cy="24" r="2.2" fill="rgb(255 255 255 / 90%)" />

            {shown === 'worried' && !shy ? (
              <g className="mascot-brow">
                <path d="M33 37 L42 40" />
                <path d="M67 37 L58 40" />
              </g>
            ) : null}
            <m.g style={{ x: eyeX, y: eyeY }}>
              {eyesClosed ? (
                <g className="mascot-lid">
                  <path d={shown === 'sleepy' ? 'M33 50 Q38 53 43 50' : 'M33 49 L43 49'} />
                  <path d={shown === 'sleepy' ? 'M57 50 Q62 53 67 50' : 'M57 49 L67 49'} />
                </g>
              ) : joyful && !shy ? (
                <g className="mascot-lid">
                  <path d="M33 51 Q38 44 43 51" />
                  <path d="M57 51 Q62 44 67 51" />
                </g>
              ) : (
                <g className="mascot-eye">
                  <ellipse cx="38" cy="48" rx="4.6" ry="6" fill={`url(#mascot-eye-${uid})`} />
                  <ellipse cx="62" cy="48" rx="4.6" ry="6" fill={`url(#mascot-eye-${uid})`} />
                  <circle cx="39.6" cy="45.6" r="1.6" className="mascot-glint" />
                  <circle cx="63.6" cy="45.6" r="1.6" className="mascot-glint" />
                  <circle cx="40.6" cy="50.1" r="0.9" className="mascot-glint-dim" />
                  <circle cx="64.6" cy="50.1" r="0.9" className="mascot-glint-dim" />
                </g>
              )}
              {detailed ? (
                <>
                  <ellipse cx="29" cy="60" rx="6.5" ry="3.8" className={`mascot-blush${warm ? ' is-warm' : ''}`} fill={`url(#mascot-blush-${uid})`} />
                  <ellipse cx="71" cy="60" rx="6.5" ry="3.8" className={`mascot-blush${warm ? ' is-warm' : ''}`} fill={`url(#mascot-blush-${uid})`} />
                </>
              ) : null}
              <path
                d={shy ? 'M45 65 Q50 63 55 65' : MOUTH[shown]}
                className={`mascot-mouth${openMouth ? ' is-open' : ''}`}
                fill={openMouth ? `url(#mascot-mouth-${uid})` : 'none'}
              />
              {openMouth ? <ellipse cx="50" cy="65.6" rx="3.6" ry="1.8" className="mascot-tongue" fill="#ff7a93" /> : null}
            </m.g>

            {/* Hands, drawn last so they can cover the eyes. */}
            <m.ellipse
              cx="16" cy="64" rx="7" ry="6"
              className="mascot-hand"
              fill={`url(#mascot-hand-${uid})`}
              stroke="rgb(46 82 6 / 55%)"
              strokeWidth={1}
              initial={false}
              animate={motionOff ? undefined : leftHand}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            />
            <m.ellipse
              cx="84" cy="64" rx="7" ry="6"
              className="mascot-hand"
              fill={`url(#mascot-hand-${uid})`}
              stroke="rgb(46 82 6 / 55%)"
              strokeWidth={1}
              initial={false}
              animate={motionOff ? undefined : rightHand}
              transition={act === 'wave' ? { duration: ACT_MS.wave / 1000, ease: 'easeInOut' } : { type: 'spring', stiffness: 260, damping: 18 }}
            />
            {shown === 'sleepy' && !shy ? <text x="78" y="22" className="mascot-z">z</text> : null}
          </g>
        </m.svg>
      </m.span>
    </span>
  );

  if (!onTap) return svg;
  return (
    <button type="button" className="mascot-btn" onClick={() => { play('cheer'); onTap(); }} aria-label={`${label}. Tap to add something`}>
      {svg}
    </button>
  );
}
