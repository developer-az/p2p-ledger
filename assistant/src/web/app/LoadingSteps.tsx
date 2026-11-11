import { stepElapsedSeconds, type BootState, type BootStep, type BootStepStatus } from './boot-steps.js';

export interface LoadingStepsProps {
  state: BootState;
  /** Current time in the same clock as the state, so elapsed seconds re-render. */
  now: number;
  /** Offered next to a stalled step, e.g. to open the practice wallet. */
  onFallback?: () => void;
  /** Offered next to a failed step. Without it, no retry button is shown. */
  onRetry?: () => void;
}

const STATUS_WORD: Record<BootStepStatus, string> = {
  pending: 'Waiting',
  running: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

function StepMarker({ status }: { status: BootStepStatus }) {
  if (status === 'running') {
    return <span className="boot-step-spinner" aria-hidden="true" />;
  }
  if (status === 'pending') {
    return <span className="boot-step-dot" aria-hidden="true" />;
  }
  const failed = status === 'failed';
  return (
    <span className={`boot-step-icon${failed ? ' is-failed' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {failed ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M3.5 8.5l3 3 6-6" />}
      </svg>
    </span>
  );
}

function StepRow({ step, now, onRetry }: { step: BootStep; now: number; onRetry?: () => void }) {
  const running = step.status === 'running';
  const done = step.status === 'done';
  const failed = step.status === 'failed';
  const attempt = step.attempt !== undefined && step.attempt > 1 ? step.attempt : null;

  return (
    <li className={`boot-step is-${step.status}`}>
      <span className="boot-step-marker">
        <StepMarker status={step.status} />
      </span>
      <div className="boot-step-body">
        <p className="boot-step-label">{step.label}</p>
        <span className="boot-step-status">{STATUS_WORD[step.status]}</span>
        {running && step.hint ? <p className="boot-step-hint">{step.hint}</p> : null}
        {failed && step.reason ? <p className="boot-step-reason">{step.reason}</p> : null}
        {failed && onRetry ? (
          <button type="button" className="boot-steps-action" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
      <div className="boot-step-meta">
        {running || done ? (
          <span className="boot-step-time">{stepElapsedSeconds(step, now)}s</span>
        ) : null}
        {attempt !== null ? <span className="boot-step-attempt">attempt {attempt}</span> : null}
      </div>
    </li>
  );
}

export function LoadingSteps({ state, now, onFallback, onRetry }: LoadingStepsProps) {
  const running = state.steps.find((step) => step.status === 'running');

  return (
    <div className="boot-steps-root" role="status" aria-live="polite" aria-label="Loading progress">
      <ol className="boot-steps">
        {state.steps.map((step) => (
          <StepRow key={step.id} step={step} now={now} onRetry={onRetry} />
        ))}
      </ol>
      {state.stalled && running !== undefined ? (
        <p className="boot-stall">
          Still waiting on {running.label.toLowerCase()}. This is normal after the app has been idle.
        </p>
      ) : null}
      {state.stalled && onFallback ? (
        <button type="button" className="boot-steps-action" onClick={onFallback}>
          Open the sample instead
        </button>
      ) : null}
    </div>
  );
}
