import { describe, expect, it } from 'vitest';
import {
  TOUR_KEY,
  TOUR_STEPS,
  initialTour,
  loadTour,
  saveTour,
  tourReducer,
  type TourState,
  type TourStep,
} from '../src/web/app/tour.js';

type TourStorage = Pick<Storage, 'getItem' | 'setItem'>;

function fakeStorage(initial: Record<string, string> = {}): TourStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string): string | null {
      return Object.hasOwn(data, key) ? (data[key] as string) : null;
    },
    setItem(key: string, value: string): void {
      data[key] = value;
    },
  };
}

const throwingStorage: TourStorage = {
  getItem(): string | null {
    throw new Error('storage blocked');
  },
  setItem(): void {
    throw new Error('storage blocked');
  },
};

const stepById = (id: string): TourStep | undefined =>
  TOUR_STEPS.find((step: TourStep) => step.id === id);

describe('TOUR_STEPS', () => {
  it('lists the five steps in order', () => {
    expect(TOUR_STEPS.map((step: TourStep) => step.id)).toEqual([
      'overview-figures',
      'transactions-list',
      'insights-charts',
      'palette',
      'settings',
    ]);
  });

  it('points each step at the expected app route', () => {
    expect(stepById('overview-figures')?.route).toEqual({ kind: 'app', section: 'overview' });
    expect(stepById('transactions-list')?.route).toEqual({ kind: 'app', section: 'transactions' });
    expect(stepById('insights-charts')?.route).toEqual({ kind: 'app', section: 'insights' });
    expect(stepById('palette')?.route).toEqual({ kind: 'app', section: 'overview' });
    expect(stepById('settings')?.route).toEqual({ kind: 'app', section: 'settings', tab: 'appearance' });
  });

  it('uses the search target for the palette and unique kebab-case targets', () => {
    expect(stepById('palette')?.target).toBe('search');
    for (const step of TOUR_STEPS as readonly TourStep[]) {
      expect(step.target).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(new Set(TOUR_STEPS.map((step: TourStep) => step.target)).size).toBe(TOUR_STEPS.length);
  });

  it('writes plain sentence-case copy without emoji, exclamation marks or unbuilt features', () => {
    const banned = /\b(import|forecast|subscription|lineage|confidence)\b/i;
    for (const step of TOUR_STEPS as readonly TourStep[]) {
      expect(step.title.trim()).toBe(step.title);
      expect(step.body.trim()).toBe(step.body);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);

      for (const text of [step.title, step.body]) {
        expect(text.charAt(0)).toMatch(/[A-Z]/);
        expect(text).not.toContain('!');
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(text).not.toMatch(banned);
      }
    }
  });
});

describe('initialTour and tourReducer', () => {
  it('starts inactive, at the first step, and not dismissed, and start resets to that state', () => {
    expect(initialTour()).toEqual({ active: false, index: 0, dismissed: false });

    const progressed: TourState = { active: false, index: 3, dismissed: true };
    expect(tourReducer(progressed, { type: 'start' })).toEqual({
      active: true,
      index: 0,
      dismissed: false,
    });
  });

  it('next advances one step at a time', () => {
    let state = tourReducer(initialTour(), { type: 'start' });
    for (const index of [1, 2, 3, 4]) {
      state = tourReducer(state, { type: 'next' });
      expect(state).toEqual({ active: true, index, dismissed: false });
    }
  });

  it('next past the last step ends and dismisses the tour', () => {
    const last: TourState = { active: true, index: TOUR_STEPS.length - 1, dismissed: false };
    const result = tourReducer(last, { type: 'next' });
    expect(result.active).toBe(false);
    expect(result.dismissed).toBe(true);
  });

  it('back moves one step and never goes below the first step', () => {
    const middle: TourState = { active: true, index: 2, dismissed: false };
    expect(tourReducer(middle, { type: 'back' })).toEqual({ active: true, index: 1, dismissed: false });

    const first: TourState = { active: true, index: 0, dismissed: false };
    expect(tourReducer(first, { type: 'back' })).toEqual({ active: true, index: 0, dismissed: false });
  });

  it('dismiss closes the tour without losing the current step', () => {
    const state: TourState = { active: true, index: 2, dismissed: false };
    expect(tourReducer(state, { type: 'dismiss' })).toEqual({ active: false, index: 2, dismissed: true });
  });

  it('reset returns to the initial state', () => {
    const state: TourState = { active: false, index: 3, dismissed: true };
    expect(tourReducer(state, { type: 'reset' })).toEqual(initialTour());
  });

  it('never mutates the input state', () => {
    const state: TourState = Object.freeze({ active: true, index: 1, dismissed: false });
    const actions = [{ type: 'start' }, { type: 'next' }, { type: 'back' }, { type: 'dismiss' }, { type: 'reset' }];

    for (const action of actions) {
      expect(() => tourReducer(state, action)).not.toThrow();
    }
    expect(state).toEqual({ active: true, index: 1, dismissed: false });
  });
});

describe('tour persistence', () => {
  it('uses the settle:tour session key', () => {
    expect(TOUR_KEY).toBe('settle:tour');
  });

  it('loads the initial state when nothing is stored', () => {
    expect(loadTour(fakeStorage())).toEqual(initialTour());
    expect(loadTour(fakeStorage({ 'other-key': 'value' }))).toEqual(initialTour());
  });

  it('saves under TOUR_KEY and round-trips the state', () => {
    const states: TourState[] = [
      { active: true, index: 2, dismissed: false },
      { active: false, index: TOUR_STEPS.length - 1, dismissed: true },
    ];

    for (const state of states) {
      const storage = fakeStorage();
      saveTour(state, storage);
      expect(JSON.parse(storage.data[TOUR_KEY] as string)).toEqual(state);
      expect(loadTour(storage)).toEqual(state);
    }
  });

  it('falls back to the initial state on invalid JSON or wrong shapes', () => {
    const badValues = [
      '{',
      'null',
      '[]',
      JSON.stringify({}),
      JSON.stringify({ active: true, index: 0 }),
      JSON.stringify({ active: 'yes', index: 0, dismissed: false }),
      JSON.stringify({ active: true, index: '0', dismissed: false }),
      JSON.stringify({ active: true, index: 0, dismissed: 'no' }),
    ];

    for (const value of badValues) {
      expect(loadTour(fakeStorage({ [TOUR_KEY]: value }))).toEqual(initialTour());
    }
  });

  it('falls back to the initial state for an out-of-range index', () => {
    const badIndexes = [-1, TOUR_STEPS.length, 99];

    for (const index of badIndexes) {
      const value = JSON.stringify({ active: true, index, dismissed: false });
      expect(loadTour(fakeStorage({ [TOUR_KEY]: value }))).toEqual(initialTour());
    }
  });

  it('falls back to the initial state when reading throws', () => {
    expect(loadTour(throwingStorage)).toEqual(initialTour());
  });

  it('swallows write errors', () => {
    expect(() => saveTour({ active: true, index: 0, dismissed: false }, throwingStorage)).not.toThrow();
  });
});
