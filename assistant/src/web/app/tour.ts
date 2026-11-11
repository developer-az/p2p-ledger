/**
 * First-run product tour: step definitions, state transitions and session
 * persistence. Pure module, so it is safe to import on the server.
 */

export const TOUR_KEY = 'settle:tour';

export type TourRoute =
  | { kind: 'app'; section: 'overview' | 'transactions' | 'insights' }
  | { kind: 'app'; section: 'settings'; tab: 'appearance' };

export interface TourStep {
  id: string;
  title: string;
  body: string;
  route: TourRoute;
  /** Anchor the overlay points at, e.g. a data-tour value. */
  target: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'overview-figures',
    title: 'Overview figures',
    body: 'Your net position, cash and card balances, and what is left of the weekly plan.',
    route: { kind: 'app', section: 'overview' },
    target: 'overview-figures',
  },
  {
    id: 'transactions-list',
    title: 'Transactions list',
    body: 'Every entry in date order. Filter by kind or search a name or note, then open a row for the detail view. Logged spends can be removed there.',
    route: { kind: 'app', section: 'transactions' },
    target: 'transactions-list',
  },
  {
    id: 'insights-charts',
    title: 'Insights charts',
    body: 'Charts built from the entries you log, so spending patterns and daily totals stay tied to real records.',
    route: { kind: 'app', section: 'insights' },
    target: 'insights-charts',
  },
  {
    id: 'palette',
    title: 'Command palette',
    body: 'Press Ctrl+K or Command+K to jump to a section, search entries, or start a new action.',
    route: { kind: 'app', section: 'overview' },
    target: 'search',
  },
  {
    id: 'settings',
    title: 'Appearance settings',
    body: 'Pick a light or dark theme and a comfortable or compact density. Changes apply right away.',
    route: { kind: 'app', section: 'settings', tab: 'appearance' },
    target: 'settings-appearance',
  },
];

export interface TourState {
  active: boolean;
  index: number;
  dismissed: boolean;
}

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'dismiss' }
  | { type: 'reset' };

/** A fresh tour, before it has been started. */
export function initialTour(): TourState {
  return { active: false, index: 0, dismissed: false };
}

const LAST_INDEX = TOUR_STEPS.length - 1;

/** Pure state machine for the tour. Never mutates the incoming state. */
export function tourReducer(state: TourState, action: TourAction | { type: string }): TourState {
  switch (action.type) {
    case 'start':
      return { active: true, index: 0, dismissed: false };
    case 'next':
      if (state.index >= LAST_INDEX) {
        return { active: false, index: state.index, dismissed: true };
      }
      return { active: state.active, index: state.index + 1, dismissed: state.dismissed };
    case 'back': {
      const index = state.index > 0 ? state.index - 1 : 0;
      if (index === state.index) {
        return state;
      }
      return { active: state.active, index, dismissed: state.dismissed };
    }
    case 'dismiss':
      return { active: false, index: state.index, dismissed: true };
    case 'reset':
      return initialTour();
    default:
      return state;
  }
}

type TourStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads the session store defensively: blocked storage must not break the app. */
function defaultStorage(): TourStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isTourState(value: unknown): value is TourState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.active === 'boolean'
    && typeof record.dismissed === 'boolean'
    && Number.isInteger(record.index)
    && (record.index as number) >= 0
    && (record.index as number) <= LAST_INDEX
  );
}

/** Loads the saved tour, falling back to the initial state on any bad input. */
export function loadTour(storage: TourStorage | null = defaultStorage()): TourState {
  if (!storage) return initialTour();
  try {
    const raw = storage.getItem(TOUR_KEY);
    if (raw === null) return initialTour();
    const parsed: unknown = JSON.parse(raw);
    return isTourState(parsed) ? { active: parsed.active, index: parsed.index, dismissed: parsed.dismissed } : initialTour();
  } catch {
    return initialTour();
  }
}

/** Saves the tour to session storage. Write failures are ignored. */
export function saveTour(state: TourState, storage: TourStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked or full: the tour still works for this page view */
  }
}
