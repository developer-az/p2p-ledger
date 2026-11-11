/**
 * Boot progress as a pure state machine.
 *
 * The boot screen shows five things that happen in order: reaching the app
 * server, waking the ledger service, checking the database, loading accounts,
 * and building insights. Each one can be pending, running, done or failed.
 *
 * No React, no DOM, no timers: every function here is pure and takes the
 * current time from the caller, so the UI can decide when to re-render and a
 * test can drive the clock by hand.
 */

export const BOOT_STEP_IDS = ['server', 'ledger', 'database', 'accounts', 'insights'] as const;

export type BootStepId = (typeof BOOT_STEP_IDS)[number];

export type BootStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BootStep {
  id: BootStepId;
  label: string;
  hint?: string;
  status: BootStepStatus;
  /** When the step started, in caller-supplied milliseconds. */
  startedAt?: number;
  /** When the step finished (done or failed), in caller-supplied milliseconds. */
  endedAt?: number;
  /** Retry counter, set by a retry event. */
  attempt?: number;
  /** Why a failed step failed. */
  reason?: string;
}

export interface BootState {
  steps: BootStep[];
  startedAt: number;
  /** Last time any step changed; the stall check measures from here. */
  lastProgressAt: number;
  stalled: boolean;
  complete: boolean;
}

export type BootEvent =
  | { type: 'start'; id: BootStepId; at: number }
  | { type: 'done'; id: BootStepId; at: number }
  | { type: 'fail'; id: BootStepId; at: number; reason: string }
  | { type: 'retry'; id: BootStepId; at: number; attempt: number }
  | { type: 'tick'; at: number };

/** No progress for this long while a step is running counts as a stall. */
export const STALL_MS = 20_000;

interface StepCopy {
  label: string;
  hint?: string;
}

const STEP_COPY: Record<BootStepId, StepCopy> = {
  server: { label: 'Connecting to Settle' },
  ledger: {
    label: 'Waking the ledger service',
    hint: 'Free hosting sleeps when idle; the first load can take up to a minute.',
  },
  database: { label: 'Checking the database' },
  accounts: { label: 'Loading your accounts' },
  insights: { label: 'Building your insights' },
};

const stepIndex = (id: BootStepId): number => BOOT_STEP_IDS.indexOf(id);

const cloneSteps = (steps: readonly BootStep[]): BootStep[] => steps.map((step) => ({ ...step }));

/** The last step is the finish line: once it is done, booting is over. */
function isComplete(steps: readonly BootStep[]): boolean {
  const last = steps[steps.length - 1];
  return last !== undefined && last.status === 'done';
}

/** Shared tail for every event that counts as forward motion. */
function progressed(state: BootState, steps: BootStep[], at: number): BootState {
  return {
    ...state,
    steps,
    lastProgressAt: at,
    stalled: false,
    complete: state.complete || isComplete(steps),
  };
}

/** Start the first step that has not begun yet, if there is one. */
function startNextPending(steps: BootStep[], from: number, at: number): void {
  for (let i = from; i < steps.length; i += 1) {
    const step = steps[i];
    if (step !== undefined && step.status === 'pending') {
      step.status = 'running';
      step.startedAt ??= at;
      step.endedAt = undefined;
      step.reason = undefined;
      return;
    }
  }
}

export function initialBoot(at: number): BootState {
  const steps: BootStep[] = BOOT_STEP_IDS.map((id, index) => {
    const copy = STEP_COPY[id];
    const step: BootStep = {
      id,
      label: copy.label,
      status: index === 0 ? 'running' : 'pending',
    };
    if (copy.hint !== undefined) step.hint = copy.hint;
    if (index === 0) step.startedAt = at;
    return step;
  });

  return {
    steps,
    startedAt: at,
    lastProgressAt: at,
    stalled: false,
    complete: isComplete(steps),
  };
}

/**
 * Apply one event and return the next state. The input state is never touched:
 * every changed step is a fresh object, so a caller can diff by identity.
 */
export function bootReducer(state: BootState, event: BootEvent): BootState {
  if (event.type === 'tick') {
    // A tick only re-evaluates the stall flag; it is not progress itself.
    const running = state.steps.some((step) => step.status === 'running');
    const stalled = running && event.at - state.lastProgressAt > STALL_MS;
    return stalled === state.stalled ? state : { ...state, stalled };
  }

  const target = stepIndex(event.id);
  const current = state.steps[target];
  if (current === undefined) return state;
  // Finished steps never move backwards: anything aimed at one is a late event.
  if (current.status === 'done') return state;

  const steps = cloneSteps(state.steps);
  const step = steps[target];
  if (step === undefined) return state;

  switch (event.type) {
    case 'start': {
      step.status = 'running';
      step.startedAt ??= event.at;
      step.endedAt = undefined;
      step.reason = undefined;
      return progressed(state, steps, event.at);
    }

    case 'retry': {
      // A retry keeps the step on screen as running, with a fresh attempt count.
      step.status = 'running';
      step.attempt = event.attempt;
      step.startedAt ??= event.at;
      step.endedAt = undefined;
      step.reason = undefined;
      return progressed(state, steps, event.at);
    }

    case 'fail': {
      step.status = 'failed';
      step.reason = event.reason;
      step.startedAt ??= event.at;
      step.endedAt = event.at;
      return progressed(state, steps, event.at);
    }

    case 'done': {
      // Everything up to and including this step is done, whether or not it was
      // ever announced as running (the server can answer late for all of them).
      for (let i = 0; i <= target; i += 1) {
        const earlier = steps[i];
        if (earlier === undefined || earlier.status === 'done') continue;
        earlier.status = 'done';
        earlier.startedAt ??= event.at;
        earlier.endedAt ??= event.at;
        earlier.reason = undefined;
      }
      startNextPending(steps, target + 1, event.at);
      return progressed(state, steps, event.at);
    }
  }
}

/** Whole seconds a step has taken so far, or its final duration once finished. */
export function stepElapsedSeconds(step: BootStep, now: number): number {
  if (step.startedAt === undefined) return 0;
  const end = step.endedAt ?? now;
  return Math.max(0, Math.floor((end - step.startedAt) / 1000));
}
