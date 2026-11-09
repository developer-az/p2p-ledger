import { describe, expect, it, vi } from 'vitest';
import { FallbackChainProvider } from '../src/server/providers/fallback-chain.js';
import type { AgentRequest, AgentResult, LlmProvider } from '../src/server/providers/types.js';

class StubProvider implements LlmProvider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly fn: (req: AgentRequest) => Promise<AgentResult>,
  ) {}

  run(req: AgentRequest): Promise<AgentResult> {
    return this.fn(req);
  }
}

const ok: AgentResult = { answer: 'hi', toolCalls: [], truncated: false };
const req: AgentRequest = {
  system: 's',
  messages: [{ role: 'user', text: 'q' }],
  tools: [],
  execute: async () => ({}),
  maxSteps: 3,
};

describe('FallbackChainProvider', () => {
  it('uses primary when it succeeds', async () => {
    const primary = new StubProvider('gemini', 'flash', async () => ok);
    const secondary = new StubProvider('openrouter', 'or', async () => ({ answer: 'no', toolCalls: [], truncated: false }));
    const chain = new FallbackChainProvider(primary, secondary);
    const result = await chain.run(req);
    expect(result.answer).toBe('hi');
    expect(chain.lastUsed).toBe('primary');
  });

  it('falls back on 429 from primary', async () => {
    const primary = new StubProvider('gemini', 'flash', async () => {
      const err = new Error('{"error":{"code":429,"message":"quota"}}') as Error & { status?: number };
      err.status = 429;
      throw err;
    });
    const secondary = new StubProvider('openrouter', 'or', async () => ({ answer: 'backup', toolCalls: [], truncated: false }));
    const chain = new FallbackChainProvider(primary, secondary);
    const result = await chain.run(req);
    expect(result.answer).toBe('backup');
    expect(chain.lastUsed).toBe('secondary');
  });

  it.each([500, 502])('falls back on HTTP %i from primary', async (status) => {
    const primary = new StubProvider('openrouter', 'or', async () => {
      throw Object.assign(new Error(`OpenRouter ${status}`), { status });
    });
    const secondary = new StubProvider('gemini', 'flash', async () => ({ ...ok, answer: 'backup' }));
    const chain = new FallbackChainProvider(primary, secondary);
    expect((await chain.run(req)).answer).toBe('backup');
    expect(chain.lastUsed).toBe('secondary');
  });

  it('reserves the rest of the deadline for secondary when primary hangs', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      let primaryDeadline = 0;
      let secondaryDeadline = 0;
      const primary = new StubProvider('openrouter', 'or', async (request) => {
        primaryDeadline = request.deadlineAt ?? 0;
        return new Promise<AgentResult>(() => {});
      });
      const secondary = new StubProvider('gemini', 'flash', async (request) => {
        secondaryDeadline = request.deadlineAt ?? 0;
        return { ...ok, answer: 'backup' };
      });
      const answer = new FallbackChainProvider(primary, secondary).run({ ...req, deadlineAt: start + 50_000 });
      await vi.advanceTimersByTimeAsync(22_500);
      expect((await answer).answer).toBe('backup');
      expect(primaryDeadline).toBe(start + 22_500);
      expect(secondaryDeadline).toBe(start + 50_000);
      expect(secondaryDeadline - Date.now()).toBe(27_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back when the primary model has no usable endpoint (404 guardrail)', async () => {
    const primary = new StubProvider('openrouter', 'or', async () => {
      const err = new Error(
        'OpenRouter 404: {"error":{"message":"0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy."}}',
      ) as Error & { status?: number };
      err.status = 404;
      throw err;
    });
    const secondary = new StubProvider('gemini', 'flash', async () => ({ answer: 'from gemini', toolCalls: [], truncated: false }));
    const chain = new FallbackChainProvider(primary, secondary);
    const result = await chain.run(req);
    expect(result.answer).toBe('from gemini');
    expect(chain.lastProviderName).toBe(secondary.name);
    expect(chain.lastUsed).toBe('secondary');
  });

  it('reports the primary provider name when it answered', async () => {
    const primary = new StubProvider('gemini', 'flash', async () => ok);
    const secondary = new StubProvider('openrouter', 'or', async () => ok);
    const chain = new FallbackChainProvider(primary, secondary);
    await chain.run(req);
    expect(chain.lastProviderName).toBe('gemini');
  });

  it('rethrows non-outage errors', async () => {
    const primary = new StubProvider('gemini', 'flash', async () => {
      throw new Error('bad prompt');
    });
    const secondary = new StubProvider('openrouter', 'or', async () => ok);
    const chain = new FallbackChainProvider(primary, secondary);
    await expect(chain.run(req)).rejects.toThrow('bad prompt');
  });
});
