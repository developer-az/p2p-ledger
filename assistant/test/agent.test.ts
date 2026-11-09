import { describe, expect, it } from 'vitest';
import { MAX_STEPS, runAssistant } from '../src/server/agent.js';
import { FallbackChainProvider } from '../src/server/providers/fallback-chain.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import type { AgentResult, LlmProvider } from '../src/server/providers/types.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';
import { amountsGrounded } from '../evals/graders.js';

const ledger = new FixtureLedger();
const ask = (provider: ScriptedProvider, text = 'hi') =>
  runAssistant({
    provider,
    ledger,
    spendLogs: fixtureSpendLogStore(),
    accountId: ME,
    now: () => NOW,
    messages: [{ role: 'user', text }],
  });

describe('runAssistant', () => {
  it('runs tool calls and returns the answer with a trace', async () => {
    const provider = new ScriptedProvider([
      { calls: [{ tool: 'get_account_overview', args: {} }] },
      { answer: 'Your balance is $3,750.51.' },
    ]);
    const reply = await ask(provider);
    expect(reply.answer).toBe('Your balance is $3,750.51.');
    expect(reply.toolCalls.map((c) => c.tool)).toEqual(['get_account_overview']);
    expect(provider.lastRequest!.system).toContain(ME);
    expect(provider.lastRequest!.system).toContain('2026-10-08');
  });

  it('falls back to a safe message when the step limit is hit', async () => {
    const loop = Array.from({ length: MAX_STEPS + 2 }, () => ({ calls: [{ tool: 'get_account_overview', args: {} }] }));
    const reply = await ask(new ScriptedProvider(loop));
    expect(reply.toolCalls).toHaveLength(MAX_STEPS);
    expect(reply.answer).toMatch(/couldn't finish/);
  });

  it('keeps a scripted injection attempt from reaching other accounts', async () => {
    const reply = await ask(new ScriptedProvider([
      { calls: [{ tool: 'get_transfer', args: { transferId: 't-secret' } }] },
      { answer: 'done' },
    ]));
    expect(reply.toolCalls[0]!.result).toEqual({ error: 'Transfer not found' });
  });
});

describe('graders', () => {
  it('flags dollar amounts that no tool returned', async () => {
    const reply = await ask(new ScriptedProvider([
      { calls: [{ tool: 'get_account_overview', args: {} }] },
      { answer: 'You have $3,750.51, about $3,800.' },
    ]));
    expect(amountsGrounded('')(reply)).toBe('ungrounded amounts: $3,800');
    expect(amountsGrounded('round to $3,800')(reply)).toBeNull();
  });
});

describe('runAssistant route', () => {
  it('reports gemini when the chain secondary answered', async () => {
    class StubProvider implements LlmProvider {
      constructor(
        readonly name: string,
        readonly model: string,
        private readonly fn: () => Promise<AgentResult>,
      ) {}

      run(): Promise<AgentResult> {
        return this.fn();
      }
    }
    const primary = new StubProvider('openrouter', 'or', async () => {
      const err = new Error('OpenRouter 404: no endpoints available matching your data policy') as Error & { status?: number };
      err.status = 404;
      throw err;
    });
    const secondary = new StubProvider('gemini', 'gemini-2.5-flash-lite', async () => ({
      answer: 'from gemini',
      toolCalls: [],
      truncated: false,
    }));
    const chain = new FallbackChainProvider(primary, secondary);
    const reply = await runAssistant({
      provider: chain,
      ledger,
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      now: () => NOW,
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(reply.answer).toBe('from gemini');
    expect(reply.route).toBe('gemini');
    expect(chain.lastProviderName).toBe('gemini');
  });
});
