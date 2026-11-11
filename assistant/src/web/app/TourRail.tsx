import { forwardRef, useEffect, useId, useImperativeHandle, useReducer, useRef } from 'react';
import './styles/tour.css';
import { navigate } from './router.js';
import { TOUR_STEPS, loadTour, saveTour, tourReducer } from './tour.js';
import { Icon } from './ui.js';

export interface TourRailHandle {
  /** Opens the tour at its first step. */
  start: () => void;
}

const TARGET_CLASS = 'tour-target';

function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

/** Anything modal on screen owns Escape; the tour steps back. */
function hasOpenModal(): boolean {
  return document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not(dialog)') !== null;
}

/**
 * Guided tour rail for the sample household. Follows the step routes in
 * `tour.ts`, outlines the matching `data-tour` anchor and keeps the step
 * state in session storage. It never traps focus or covers the page.
 */
export const TourRail = forwardRef<TourRailHandle>(function TourRail(_props, ref) {
  const [state, dispatch] = useReducer(tourReducer, undefined, loadTour);
  const titleId = useId();
  const marked = useRef<HTMLElement | null>(null);
  const autoStarted = useRef(false);
  const nextButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);

  useImperativeHandle(ref, () => ({ start: () => dispatch({ type: 'start' }) }), []);

  // The tour starts once when the sample household opens, unless it was
  // closed earlier in this browser session.
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (!state.dismissed && !state.active) dispatch({ type: 'start' });
  }, [state.active, state.dismissed]);

  useEffect(() => {
    saveTour(state);
  }, [state]);

  // Each step has its own page; the tour drives the route while it is open.
  useEffect(() => {
    if (!state.active) return;
    const step = TOUR_STEPS[state.index];
    if (step) navigate(step.route);
  }, [state.active, state.index]);

  // Outline the anchor for the current step. The target can render after the
  // route change (the wallet is still loading), so watch the page until the
  // tour moves on or closes. The class comes off on step change and close.
  useEffect(() => {
    const previous = marked.current;
    marked.current = null;
    previous?.classList.remove(TARGET_CLASS);

    if (!state.active) return undefined;
    const step = TOUR_STEPS[state.index];
    if (!step) return undefined;

    let cancelled = false;
    const mark = () => {
      if (cancelled) return;
      const current = marked.current;
      if (current?.isConnected) return;
      const element = findTarget(step.target);
      if (!element) return;
      if (current) current.classList.remove(TARGET_CLASS);
      element.classList.add(TARGET_CLASS);
      marked.current = element;
      element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      marked.current?.classList.remove(TARGET_CLASS);
      marked.current = null;
    };
  }, [state.active, state.index]);

  // Move focus into the rail on open and on every step change, then give it
  // back to whatever had it before the tour opened. There is no focus trap.
  useEffect(() => {
    if (state.active) {
      if (!wasActive.current) {
        const active = document.activeElement;
        returnFocus.current = active instanceof HTMLElement ? active : null;
        wasActive.current = true;
      }
      nextButton.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [state.active, state.index]);

  useEffect(() => {
    if (!state.active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || hasOpenModal()) return;
      event.preventDefault();
      dispatch({ type: 'dismiss' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.active]);

  if (!state.active) return null;
  const step = TOUR_STEPS[state.index];
  if (!step) return null;
  const position = state.index + 1;
  const last = state.index === TOUR_STEPS.length - 1;

  return (
    <aside className="tour-rail glass" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <button
        type="button"
        className="tour-close"
        aria-label="Close tour"
        onClick={() => dispatch({ type: 'dismiss' })}
      >
        <Icon name="x" size={18} />
      </button>
      <div className="tour-live" aria-live="polite">
        <p className="tour-eyebrow">
          <span className="tour-num" aria-hidden="true">{String(position).padStart(2, '0')}</span>
          <span className="tour-label">Guided tour · {position} of {TOUR_STEPS.length}</span>
        </p>
        <h2 id={titleId} className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
      </div>
      <div className="tour-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => dispatch({ type: 'back' })}
          disabled={state.index === 0}
        >
          Back
        </button>
        <button
          ref={nextButton}
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => dispatch({ type: 'next' })}
        >
          {last ? 'Finish' : 'Next'}
        </button>
      </div>
    </aside>
  );
});
