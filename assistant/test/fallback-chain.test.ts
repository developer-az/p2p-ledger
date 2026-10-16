import { describe, expect, it } from 'vitest';
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

  it('rethrows non-outage errors', async () => {
    const primary = new StubProvider('gemini', 'flash', async () => {
      throw new Error('bad prompt');
    });
    const secondary = new StubProvider('openrouter', 'or', async () => ok);
    const chain = new FallbackChainProvider(primary, secondary);
    await expect(chain.run(req)).rejects.toThrow('bad prompt');
  });
});
