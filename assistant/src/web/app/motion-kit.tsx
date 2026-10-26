import { useEffect, useRef, type ReactNode } from 'react';
import { animate, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { money } from './format.js';

/** Strong ease-out used for every entrance in the app. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * A card that tilts toward the pointer with a moving specular highlight —
 * the Apple Wallet feel. Springs keep it physical; touch and reduced-motion
 * users get a flat card.
 */
export function TiltCard({ children, className, max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 150, damping: 18 });
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const sheen = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgb(255 255 255 / 0.16), transparent 55%)`;

  return (
    <motion.div
      className={`tilt${className ? ` ${className}` : ''}`}
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 1100 }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const box = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - box.left) / box.width);
        py.set((e.clientY - box.top) / box.height);
      }}
      onPointerLeave={() => { px.set(0.5); py.set(0.5); }}
    >
      {children}
      {reduce ? null : <motion.span className="tilt-sheen" aria-hidden="true" style={{ background: sheen }} />}
    </motion.div>
  );
}

/** Money that rolls up to its value once, then updates in place. */
export function CountUp({ minor, className }: { minor: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = money(minor);
      last.current = minor;
      return;
    }
    const controls = animate(last.current, minor, {
      duration: last.current === 0 ? 1.1 : 0.5,
      ease: EASE_OUT,
      onUpdate: (v) => { node.textContent = money(Math.round(v)); },
    });
    last.current = minor;
    return () => controls.stop();
  }, [minor, reduce]);

  return <span ref={ref} className={className}>{money(minor)}</span>;
}

/** Headline that rises word-by-word out of a blur. */
export function RevealWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="reveal-word" aria-hidden="true">
          <motion.span
            style={{ display: 'inline-block' }}
            initial={reduce ? false : { transform: 'translateY(105%)', opacity: 0, filter: 'blur(8px)' }}
            animate={{ transform: 'translateY(0%)', opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: delay + i * 0.06 }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </span>
  );
}

/** Fades a block up when it scrolls into view. */
export function InView({ children, className, delay = 0, as = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'section' | 'article' | 'li' }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, transform: 'translateY(24px)' }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </Tag>
  );
}
