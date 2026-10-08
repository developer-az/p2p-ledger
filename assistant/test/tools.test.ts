import { describe, expect, it } from 'vitest';
import { executeTool, TOOL_SPECS } from '../src/server/tools.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

const ctx = { ledger: new FixtureLedger(), accountId: ME, now: () => NOW };

describe('tools', () => {
  it('exposes plain JSON Schemas both vendors accept', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.parameters.type).toBe('object');
      expect(spec.parameters).not.toHaveProperty('$schema');
    }
  });

  it('reports the balance formatted from integer cents', async () => {
    expect(await executeTool(ctx, 'get_account_overview', {})).toMatchObject({ owner: 'riley', balance: '$3,750.51' });
  });

  it('lists transfers newest first with direction and counterparty', async () => {
    const { transfers } = await executeTool(ctx, 'list_transfers', { limit: 3 }) as { transfers: Record<string, unknown>[] };
    expect(transfers.map((t) => [t.transferId, t.direction, t.counterparty, t.amount])).toEqual([
      ['t7', 'received', 'mallory', '$1.00'],
      ['t6', 'sent', 'sam', '$1,500.00'],
      ['t5', 'sent', 'jordan', '$25.99'],
    ]);
  });

  it('filters by status', async () => {
    const { transfers } = await executeTool(ctx, 'list_transfers', { status: 'REJECTED' }) as { transfers: { declineReason: string }[] };
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.declineReason).toBe('VELOCITY_LIMIT');
  });

  it("never returns a transfer the account isn't part of", async () => {
    expect(await executeTool(ctx, 'get_transfer', { transferId: 't-secret' })).toEqual({ error: 'Transfer not found' });
    expect(await executeTool(ctx, 'get_transfer', { transferId: 't3' })).toMatchObject({ counterparty: 'jordan' });
  });

  it('computes exact totals in cents, excluding declines and old activity', async () => {
    expect(await executeTool(ctx, 'summarize_activity', { days: 30 })).toEqual({
      windowDays: 30,
      totalSent: '$1,268.49',
      totalReceived: '$19.00',
      totalDeposited: '$0.00',
      declinedTransfers: 1,
      byCounterparty: expect.arrayContaining([
        { counterparty: 'sam', sent: '$42.50', received: '$18.00' },
        { counterparty: 'jordan', sent: '$1,225.99', received: '$0.00' },
        { counterparty: 'mallory', sent: '$0.00', received: '$1.00' },
      ]),
    });
    expect(await executeTool(ctx, 'summarize_activity', { days: 60 })).toMatchObject({ totalDeposited: '$5,000.00' });
  });

  it('returns validation errors to the model instead of throwing', async () => {
    expect(await executeTool(ctx, 'list_transfers', { limit: 999 })).toMatchObject({ error: 'Invalid arguments' });
    expect(await executeTool(ctx, 'get_account_overview', { accountId: 'someone-else' })).toMatchObject({ error: 'Invalid arguments' });
    expect(await executeTool(ctx, 'drop_tables', {})).toEqual({ error: 'Unknown tool: drop_tables' });
  });

  it('explains decline codes', async () => {
    expect(await executeTool(ctx, 'explain_decline_reason', { reasonCode: 'velocity_limit' }))
      .toMatchObject({ reasonCode: 'VELOCITY_LIMIT' });
    expect(await executeTool(ctx, 'explain_decline_reason', { reasonCode: 'NOPE' })).toHaveProperty('error');
  });
});
