import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAlertDismissalStore } from '../src/server/alert-store.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { CompositeLedger, PRACTICE_ANTHONY, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter } from '../src/server/ledger.js';

const NOW = new Date('2026-11-15T12:00:00Z');

function setup() {
  const practice = new PracticeLedger();
  const unused = { getAccount: async () => null } as unknown as LedgerReader & LedgerWriter & LedgerAuditor;
  const dismissals = new InMemoryAlertDismissalStore();
  const app = createApp({
    ledger: new CompositeLedger(unused, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    alertDismissals: dismissals,
    now: () => NOW,
  });
  return { app, dismissals };
}

describe('risk routes', () => {
  it('serves a 90-day forecast for a practice wallet', async () => {
    const { app } = setup();
    const res = await app.request(`/api/accounts/${PRACTICE_ANTHONY}/forecast`);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      horizonDays: number;
      points: { day: number; balanceMinor: number }[];
      milestones: { day: number }[];
      assumptions: string[];
    };
    expect(body.horizonDays).toBe(90);
    expect(body.points).toHaveLength(91);
    expect(body.points[0]).toMatchObject({ day: 0 });
    expect(body.milestones.map((milestone) => milestone.day)).toEqual([30, 60, 90]);
    expect(body.assumptions.length).toBeGreaterThan(0);
  });

  it('serves a monthly report and CSV with the same totals', async () => {
    const { app } = setup();
    const report = await app.request(`/api/accounts/${PRACTICE_ANTHONY}/reports/monthly?month=2026-11`);
    expect(report.status).toBe(200);
    const body = await report.json() as { month: string; spendMinor: number; byCategory: unknown[] };
    expect(body.month).toBe('2026-11');
    expect(body.spendMinor).toBeGreaterThan(0);
    expect(body.byCategory.length).toBeGreaterThan(0);

    const csv = await app.request(`/api/accounts/${PRACTICE_ANTHONY}/reports/monthly.csv?month=2026-11`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain('Monthly report,November 2026');
    expect(text).toContain(`Spend,${(body.spendMinor / 100).toFixed(2)}`);
  });

  it('records a dismissal for the wallet in the injected store', async () => {
    const { app, dismissals } = setup();
    await app.request(`/api/accounts/${PRACTICE_ANTHONY}/forecast`);
    const res = await app.request(
      `/api/accounts/${PRACTICE_ANTHONY}/alerts/${encodeURIComponent('large-spend:test')}/dismiss`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );

    expect(res.status).toBe(200);
    expect([...(await dismissals.list(PRACTICE_ANTHONY))]).toEqual(['large-spend:test']);
  });
});
