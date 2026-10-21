import { describe, expect, it } from 'vitest';
import { swipeStep } from '../src/web/app/dock.js';
import { RAIL_ADAPTERS, RAIL_ORDER, inAppRails, startHandoff } from '../src/web/app/rails.js';

describe('swipeStep', () => {
  it('reads a leftward swipe as "next" and a rightward swipe as "previous"', () => {
    expect(swipeStep(-90, 4)).toBe(1);
    expect(swipeStep(90, 4)).toBe(-1);
  });

  it('ignores gestures below the travel threshold', () => {
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(20, 0)).toBe(0);
  });

  it('ignores a scroll that merely drifts sideways', () => {
    expect(swipeStep(-70, -140)).toBe(0);
    expect(swipeStep(-70, 140)).toBe(0);
  });
});

describe('rail adapters', () => {
  it('covers every rail the API accepts, in a stable display order', () => {
    expect(RAIL_ORDER).toHaveLength(Object.keys(RAIL_ADAPTERS).length);
    for (const rail of RAIL_ORDER) expect(RAIL_ADAPTERS[rail].id).toBe(rail);
  });

  it('records rails rather than moving money until an adapter implements handoff', async () => {
    // Today no rail settles inside the app's ledger and none has a hand-off.
    expect(inAppRails()).toHaveLength(0);
    await expect(startHandoff('zelle', {
      requestId: 'req-1', amountMinor: 1_800, currency: 'USD', payeeLabel: 'sam',
    })).resolves.toEqual({});
  });
});
