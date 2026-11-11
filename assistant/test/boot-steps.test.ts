import { describe, expect, it } from 'vitest';
import { BOOT_STEP_IDS, STALL_MS, bootReducer, initialBoot, stepElapsedSeconds, type BootState } from '../src/web/app/boot-steps.js';

const T0 = 1_000_000;
const status = (s: BootState) => Object.fromEntries(s.steps.map((x) => [x.id, x.status]));

describe('boot steps state machine', () => {
  it('starts with every step pending in a fixed order, and the first one running', () => {
    expect(BOOT_STEP_IDS).toEqual(['server', 'ledger', 'database', 'accounts', 'insights']);
    const s = initialBoot(T0);
    expect(s.steps.map((x) => x.id)).toEqual(BOOT_STEP_IDS);
    expect(status(s)).toEqual({ server: 'running', ledger: 'pending', database: 'pending', accounts: 'pending', insights: 'pending' });
    expect(s.steps.every((x) => x.label.length > 0)).toBe(true);
    expect(s.stalled).toBe(false);
  });

  it('done on the running step starts the next one', () => {
    const s = bootReducer(initialBoot(T0), { type: 'done', id: 'server', at: T0 + 300 });
    expect(status(s).server).toBe('done');
    expect(status(s).ledger).toBe('running');
    expect(s.steps.find((x) => x.id === 'ledger')?.startedAt).toBe(T0 + 300);
  });

  it('done on a later step marks every earlier step done and never moves backwards', () => {
    let s = bootReducer(initialBoot(T0), { type: 'done', id: 'database', at: T0 + 500 });
    expect(status(s)).toEqual({ server: 'done', ledger: 'done', database: 'done', accounts: 'running', insights: 'pending' });
    s = bootReducer(s, { type: 'start', id: 'ledger', at: T0 + 600 });
    expect(status(s).ledger).toBe('done');
  });

  it('fail marks the step failed with its reason; a fail after done is ignored', () => {
    let s = bootReducer(initialBoot(T0), { type: 'done', id: 'server', at: T0 + 10 });
    s = bootReducer(s, { type: 'fail', id: 'ledger', at: T0 + 20, reason: 'Ledger did not answer' });
    const ledger = s.steps.find((x) => x.id === 'ledger');
    expect(ledger?.status).toBe('failed');
    expect(ledger?.reason).toBe('Ledger did not answer');
    s = bootReducer(s, { type: 'fail', id: 'server', at: T0 + 30, reason: 'late' });
    expect(status(s).server).toBe('done');
  });

  it('a retry event keeps the step running and records the attempt number', () => {
    let s = bootReducer(initialBoot(T0), { type: 'done', id: 'server', at: T0 });
    s = bootReducer(s, { type: 'retry', id: 'ledger', at: T0 + 1_500, attempt: 2 });
    const ledger = s.steps.find((x) => x.id === 'ledger');
    expect(ledger?.status).toBe('running');
    expect(ledger?.attempt).toBe(2);
  });

  it('flags a stall when the running step has made no progress for STALL_MS, and clears it on progress', () => {
    let s = bootReducer(initialBoot(T0), { type: 'done', id: 'server', at: T0 });
    s = bootReducer(s, { type: 'tick', at: T0 + STALL_MS - 1 });
    expect(s.stalled).toBe(false);
    s = bootReducer(s, { type: 'tick', at: T0 + STALL_MS + 1 });
    expect(s.stalled).toBe(true);
    s = bootReducer(s, { type: 'retry', id: 'ledger', at: T0 + STALL_MS + 2, attempt: 3 });
    expect(s.stalled).toBe(false);
    s = bootReducer(s, { type: 'done', id: 'ledger', at: T0 + STALL_MS + 3 });
    expect(s.stalled).toBe(false);
  });

  it('is complete when the last step is done', () => {
    const s = bootReducer(initialBoot(T0), { type: 'done', id: 'insights', at: T0 + 9 });
    expect(s.complete).toBe(true);
    expect(s.steps.every((x) => x.status === 'done')).toBe(true);
  });

  it('reports whole elapsed seconds for running and finished steps', () => {
    let s = bootReducer(initialBoot(T0), { type: 'done', id: 'server', at: T0 + 2_400 });
    const server = s.steps.find((x) => x.id === 'server')!;
    expect(stepElapsedSeconds(server, T0 + 99_000)).toBe(2);
    const ledger = s.steps.find((x) => x.id === 'ledger')!;
    expect(stepElapsedSeconds(ledger, T0 + 2_400 + 12_900)).toBe(12);
    const pending = s.steps.find((x) => x.id === 'insights')!;
    expect(stepElapsedSeconds(pending, T0 + 50_000)).toBe(0);
    s = bootReducer(s, { type: 'tick', at: T0 + 3_000 });
    expect(s.steps.find((x) => x.id === 'server')!.endedAt).toBe(T0 + 2_400);
  });

  it('does not mutate the previous state', () => {
    const a = initialBoot(T0);
    const snapshot = JSON.stringify(a);
    bootReducer(a, { type: 'done', id: 'ledger', at: T0 + 5 });
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});
