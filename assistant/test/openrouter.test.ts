import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackChainProvider } from '../src/server/providers/fallback-chain.js';
import { OpenRouterProvider } from '../src/server/providers/openrouter.js';
import { openRouterModelCandidates } from '../src/server/providers/openrouter-models.js';
import { isModelOutage, isPolicyBlocked } from '../src/server/providers/retry.js';
import type { AgentRequest } from '../src/server/providers/types.js';

const req: AgentRequest = {
  system: 's',
  messages: [{ role: 'user', text: 'q' }],
  tools: [],
  execute: async () => ({}),
  maxSteps: 3,
};

const guardrailBody = JSON.stringify({
  error: {
    message:
      '0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy.',
  },
});

const modelNotFoundBody = JSON.stringify({
  error: { message: 'This model does not exist.' },
});

function jsonResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouterProvider model fallback', () => {
  it('stops at a guardrail 404: it is account-wide, so one fetch and a rejection', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return jsonResponse(guardrailBody, 404);
    });

    const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    const error = await provider.run(req).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404 });
    expect(isPolicyBlocked(error)).toBe(true);
    expect(calls).toBe(1);
  });

  it('lets the FallbackChain reach gemini after one OpenRouter guardrail fetch', async () => {
    let openRouterCalls = 0;
    vi.stubGlobal('fetch', async () => {
      openRouterCalls++;
      return jsonResponse(guardrailBody, 404);
    });
    const openrouter = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    const gemini = {
      name: 'gemini',
      model: 'flash',
      run: async () => ({ answer: 'from gemini', toolCalls: [], truncated: false }),
    };
    const chain = new FallbackChainProvider(openrouter, gemini);

    const result = await chain.run(req);

    expect(result.answer).toBe('from gemini');
    expect(chain.lastProviderName).toBe('gemini');
    expect(openRouterCalls).toBe(1);
  });

  it('walks to the next candidate on a plain model-not-found 404', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      models.push(body.model);
      if (models.length === 1) return jsonResponse(modelNotFoundBody, 404);
      return jsonResponse(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), 200);
    });

    const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    const result = await provider.run(req);

    const candidates = openRouterModelCandidates('google/gemini-2.5-flash-lite');
    expect(result.answer).toBe('ok');
    expect(models).toEqual([candidates[0], candidates[1]]);
    expect(provider.lastModel).toBe(candidates[1]);
    expect(provider.model).toBe('google/gemini-2.5-flash-lite');
  });

  it('throws the last error once every candidate is exhausted', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(modelNotFoundBody, 404));
    const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    await expect(provider.run(req)).rejects.toMatchObject({ status: 404 });
  });

  it('does not walk candidates on a plain 400', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return jsonResponse(JSON.stringify({ error: { message: 'invalid request' } }), 400);
    });
    const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    await expect(provider.run(req)).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });

  it('caps the candidate list at the configured slug plus two fallbacks', () => {
    const longEnv = {
      OPENROUTER_FALLBACK_MODELS: 'a/one,b/two,c/three,d/four,e/five,f/six',
    } as NodeJS.ProcessEnv;

    const candidates = openRouterModelCandidates('z/configured', longEnv);

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toBe('z/configured');
    expect(candidates).toEqual(['z/configured', 'a/one', 'b/two']);
  });

  it('surfaces a timeout as a 504 outage so the chain moves on', async () => {
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
    const error = await provider.run(req).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 504 });
    expect(isModelOutage(error)).toBe(true);
  });

  it('passes a 20s abort signal to the request', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return jsonResponse(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), 200);
    });

    await new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite').run(req);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('caps each attempt by the remaining deadline and skips an expired call', async () => {
    const timeouts: number[] = [];
    const originalTimeout = AbortSignal.timeout;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      return originalTimeout(ms);
    });
    let fetches = 0;
    vi.stubGlobal('fetch', async () => {
      fetches++;
      return jsonResponse(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), 200);
    });
    try {
      const provider = new OpenRouterProvider('key', 'google/gemini-2.5-flash-lite');
      expect((await provider.run({ ...req, deadlineAt: Date.now() + 6_000 })).answer).toBe('ok');
      expect(timeouts[0]).toBeGreaterThan(4_000);
      expect(timeouts[0]).toBeLessThanOrEqual(5_000);
      await expect(provider.run({ ...req, deadlineAt: Date.now() })).rejects.toMatchObject({ status: 504 });
      expect(fetches).toBe(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
