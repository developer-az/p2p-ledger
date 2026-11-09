import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel, openRouterModelCandidates } from './openrouter-models.js';
import { isModelMissing, isModelOutage, isPolicyBlocked, retryableStatus, retryDelayMs } from './retry.js';
import { attemptTimeoutMs, canRetryAfter, deadlineError, timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** A hung upstream must not hold the chat request open; the chain falls through to Gemini. */
const OPENROUTER_TIMEOUT_MS = 20_000;

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};

/**
 * OpenAI-compatible chat completions (OpenRouter gateway). Tool loop matches Anthropic/Gemini semantics.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';

  readonly model: string;

  /** The model slug that actually answered the last call (after fallback candidates). */
  lastModel: string;

  constructor(
    private readonly apiKey: string,
    model = DEFAULT_OPENROUTER_MODEL,
    private readonly siteUrl = process.env.OPENROUTER_HTTP_REFERER ?? 'https://p2p-ledger-pi.vercel.app',
    private readonly siteTitle = 'p2p-ledger assistant',
  ) {
    this.model = normalizeOpenRouterModel(model);
    this.lastModel = this.model;
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const tools = req.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    const messages: OpenAIChatMessage[] = [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.text })),
    ];
    const calls: ToolCallRecord[] = [];

    for (let step = 0; step < req.maxSteps; step++) {
      const data = await this.complete({ model: this.model, messages, tools, temperature: 0 }, req.deadlineAt);
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (!msg) {
        return { answer: '', toolCalls: calls, truncated: step > 0 };
      }
      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return { answer: (msg.content ?? '').trim(), toolCalls: calls, truncated: false };
      }
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });
      for (const tc of toolCalls) {
        let args: unknown = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        const output = await timedExecute(req, calls, tc.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(output),
        });
      }
    }
    return { answer: '', toolCalls: calls, truncated: true };
  }

  /**
   * Sends the request, walking the candidate models when a slug has no usable endpoint.
   * A guardrail / data-policy rejection applies to the whole account, so it stops the
   * walk immediately and lets the FallbackChain reach Gemini. A plain model-not-found
   * 404 is permanent for that slug only, so the next candidate is tried; transient
   * 429/5xx keep the usual single retry before the error escapes.
   */
  private async complete(body: Record<string, unknown>, deadlineAt?: number): Promise<{ choices?: { message?: OpenAIChatMessage }[] }> {
    const candidates = openRouterModelCandidates(String(body.model ?? this.model));
    let lastError: Error | undefined;
    for (const model of candidates) {
      try {
        const data = await this.request({ ...body, model }, deadlineAt);
        this.lastModel = model;
        return data;
      } catch (error) {
        // Account-level policy block: no other slug can succeed, so stop walking.
        if (isPolicyBlocked(error)) throw error;
        lastError = error as Error;
        if (!isModelMissing(error) || isModelOutage(error)) throw error;
      }
    }
    throw lastError ?? new Error(`OpenRouter: no usable model in ${candidates.join(', ')}`);
  }

  private async request(body: Record<string, unknown>, deadlineAt?: number): Promise<{ choices?: { message?: OpenAIChatMessage }[] }> {
    for (let attempt = 1; ; attempt++) {
      const timeoutMs = attemptTimeoutMs(deadlineAt, OPENROUTER_TIMEOUT_MS);
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await send(body, this.apiKey, this.siteUrl, this.siteTitle, signal, timeoutMs);
      const text = await readBody(res, timeoutMs);
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw deadlineError();
      if (res.ok) {
        return JSON.parse(text) as { choices?: { message?: OpenAIChatMessage }[] };
      }
      const err = new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`) as Error & { status?: number };
      err.status = res.status;
      const status = retryableStatus(err);
      if (attempt >= 2 || status === undefined || !isModelOutage(err)) throw err;
      const delay = retryDelayMs(err, attempt, 15_000);
      if (!canRetryAfter(deadlineAt, delay)) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * One fetch with a hard deadline. A timeout is reported as a 504 so `isModelOutage`
 * treats it like an upstream outage and the provider chain moves on.
 */
async function send(
  body: Record<string, unknown>,
  apiKey: string,
  siteUrl: string,
  siteTitle: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': siteUrl,
        'X-Title': siteTitle,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (!isAbortError(error)) throw error;
    throw timeoutError(timeoutMs);
  }
}

/** An abort mid-body also means the deadline passed, not a bad answer. */
async function readBody(res: Response, timeoutMs: number): Promise<string> {
  try {
    return await res.text();
  } catch (error) {
    if (!isAbortError(error)) throw error;
    throw timeoutError(timeoutMs);
  }
}

function timeoutError(timeoutMs: number): Error & { status?: number } {
  const err = new Error(`OpenRouter timeout after ${timeoutMs}ms`) as Error & { status?: number };
  err.status = 504;
  return err;
}

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
