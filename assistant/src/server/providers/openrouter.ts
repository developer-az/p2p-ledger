import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel, openRouterFallbackModel } from './openrouter-models.js';
import { isModelOutage, retryableStatus, retryDelayMs } from './retry.js';
import { timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

  constructor(
    private readonly apiKey: string,
    model = DEFAULT_OPENROUTER_MODEL,
    private readonly siteUrl = process.env.OPENROUTER_HTTP_REFERER ?? 'https://p2p-ledger-pi.vercel.app',
    private readonly siteTitle = 'p2p-ledger assistant',
  ) {
    this.model = normalizeOpenRouterModel(model);
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
      const data = await this.complete({ model: this.model, messages, tools, temperature: 0 });
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

  private async complete(body: Record<string, unknown>): Promise<{ choices?: { message?: OpenAIChatMessage }[] }> {
    let model = normalizeOpenRouterModel(String(body.model ?? this.model));
    let triedFallback = false;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.siteUrl,
          'X-Title': this.siteTitle,
        },
        body: JSON.stringify({ ...body, model }),
      });
      const text = await res.text();
      if (res.ok) {
        return JSON.parse(text) as { choices?: { message?: OpenAIChatMessage }[] };
      }
      if (res.status === 404 && !triedFallback) {
        const next = openRouterFallbackModel(model);
        if (next !== model) {
          model = next;
          triedFallback = true;
          continue;
        }
      }
      const err = new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`) as Error & { status?: number };
      err.status = res.status;
      const status = retryableStatus(err);
      if (attempt >= 2 || status === undefined || !isModelOutage(err)) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs(err, attempt, 15_000)));
    }
  }
}
