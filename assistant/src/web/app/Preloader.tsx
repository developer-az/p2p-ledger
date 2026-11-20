import { useEffect, useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { BrandMark } from './BrandMark.js';
import { useBootProgress } from './boot-progress.js';
import { LoadingSteps } from './LoadingSteps.js';
import './styles/boot.css';

export function AppPreloader({ visible }: { visible: boolean }) {
  const { state, now } = useBootProgress();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const id = window.setTimeout(() => setMounted(false), 440);
    return () => window.clearTimeout(id);
  }, [visible, mounted]);

  if (!mounted) return null;

  const runningStep = state.steps.find((s) => s.status === 'running');
  // The ring is decoration: boot can end before the steps do, so no percent.
  return (
    <div className={`app-preloader${exiting ? ' is-out' : ''}`}>
      <div className="loader-aura" aria-hidden="true" />
      <m.div
        className="loader-card glass"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduce ? 0.12 : 0.42, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="loader-emblem" aria-hidden="true">
          <svg className="loader-ring" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke="var(--accent)"
              strokeWidth="2.5"
              fill="none"
              strokeDasharray="28 262"
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <BrandMark size={64} />
        </div>
        <h1 className="loader-title">Settle is getting ready</h1>
        <p className="loader-subline">{runningStep?.label ?? 'Preparing your workspace'}</p>
        {runningStep?.id === 'ledger' && runningStep.hint ? (
          <p className="loader-hint">{runningStep.hint}</p>
        ) : null}
        <LoadingSteps state={state} now={now} />
      </m.div>
    </div>
  );
}
