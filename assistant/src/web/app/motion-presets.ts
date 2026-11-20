/** One entrance language for the two public pages: a short, soft settle. */
export const SOFT_EASE = [0.32, 0.72, 0, 1] as const;

/** Reduced motion keeps the fade but drops travel, scale and delay. */
export function enter(reduce: boolean | null, delay = 0) {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.12, ease: SOFT_EASE },
    };
  }
  return {
    initial: { opacity: 0, y: 12, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.36, ease: SOFT_EASE, delay },
  };
}

/** Up to five steps of 60ms; nothing is staggered when motion is reduced. */
export function staggerDelay(index: number, reduce: boolean | null) {
  return reduce ? 0 : Math.min(index, 5) * 0.06;
}
