import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SCENES } from '../src/web/GuidedLedgerStory.js';
import {
  balanceSeriesFromEntries,
  cashflowFromSummary,
  moneyStringToMinor,
  transferStatusCounts,
} from '../src/web/chart-data.js';
import { drawCharacter } from '../src/web/pixel/sprites.js';
import {
  clearStoryComplete,
  isStoryComplete,
  markStoryComplete,
} from '../src/web/tour-storage.js';

describe('tour-storage', () => {
  const memory: Record<string, string> = {};

  beforeEach(() => {
    for (const k of Object.keys(memory)) delete memory[k];
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory[k] ?? null,
      setItem: (k: string, v: string) => {
        memory[k] = v;
      },
      removeItem: (k: string) => {
        delete memory[k];
      },
    });
    clearStoryComplete();
  });

  afterEach(() => {
    clearStoryComplete();
    vi.unstubAllGlobals();
  });

  it('starts incomplete and marks complete', () => {
    expect(isStoryComplete()).toBe(false);
    markStoryComplete();
    expect(isStoryComplete()).toBe(true);
    clearStoryComplete();
    expect(isStoryComplete()).toBe(false);
  });
});

describe('GuidedLedgerStory scenes', () => {
  it('has handoff as last scene and retry storm beat', () => {
    expect(SCENES.length).toBeGreaterThanOrEqual(8);
    expect(SCENES.some((s) => s.id === 'retry')).toBe(true);
    expect(SCENES[SCENES.length - 1]?.id).toBe('handoff');
  });
});

describe('chart-data', () => {
  it('parses money strings to minor units', () => {
    expect(moneyStringToMinor('$1,234.56')).toBe(123_456);
    expect(moneyStringToMinor('bad')).toBe(0);
  });

  it('maps summary and entries', () => {
    const cash = cashflowFromSummary({
      sent: '$10.00',
      received: '$5.00',
      deposited: '$100.00',
      inflow: '$105.00',
      stopped: '$0.00',
      declinedCount: 1,
    });
    expect(cash.deposited).toBe(10_000);
    expect(cash.inflow).toBe(10_500);

    const series = balanceSeriesFromEntries([
      {
        id: 2,
        transferId: 'b',
        accountId: 'a',
        amountMinor: 100,
        balanceAfterMinor: 200,
        createdAt: '2026-01-02T00:00:00Z',
      },
      {
        id: 1,
        transferId: 'a',
        accountId: 'a',
        amountMinor: 100,
        balanceAfterMinor: 100,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(series).toHaveLength(2);
    expect(series[0]?.y).toBe(100);
    expect(series[1]?.y).toBe(200);

    const status = transferStatusCounts([
      {
        transferId: '1',
        direction: 'sent',
        counterparty: 'sam',
        amount: '$1',
        status: 'COMPLETED',
        declineReason: null,
        declineExplanation: null,
        memo: null,
        createdAt: '',
      },
      {
        transferId: '2',
        direction: 'sent',
        counterparty: 'jordan',
        amount: '$2',
        status: 'REJECTED',
        declineReason: 'X',
        declineExplanation: null,
        memo: null,
        createdAt: '',
      },
    ]);
    expect(status).toEqual({ completed: 1, rejected: 1 });
  });
});

describe('sprite drawCharacter', () => {
  it('draws without throwing when canvas is available', () => {
    if (typeof document === 'undefined') {
      expect(true).toBe(true);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    expect(ctx).toBeTruthy();
    drawCharacter(ctx!, 'alex', 'idle', 4, 4, 2);
    const data = ctx!.getImageData(8, 8, 1, 1).data;
    expect(data.some((v) => v > 0)).toBe(true);
  });
});
