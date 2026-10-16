import { GoogleGenAI, type Content, type GenerateContentConfig } from '@google/genai';
import { geminiMinIntervalMs, isLongQuotaWait, paceDelayMs, retryableStatus, retryDelayMs } from './retry.js';
import { timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly ai: GoogleGenAI;
  private lastCallAt = 0;

  constructor(apiKey: string, readonly model = 'gemini-2.0-flash-lite') {
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 45_000 } });
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const contents: Content[] = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
    const config = {
      systemInstruction: req.system,
      temperature: 0,
      tools: [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name, description: t.description, parametersJsonSchema: t.parameters,
        })),
      }],
    };
    const calls: ToolCallRecord[] = [];

    for (let step = 0; step < req.maxSteps; step++) {
      const res = await this.generate(contents, config);
      const functionCalls = res.functionCalls ?? [];
      if (functionCalls.length === 0) {
        return { answer: res.text ?? '', toolCalls: calls, truncated: false };
      }
      // Echo the model turn back unchanged (it may carry thought signatures), then answer every call.
      const modelTurn = res.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);
      const results = await Promise.all(functionCalls.map(async (fc) => ({
        functionResponse: {
          id: fc.id,
          name: fc.name,
          response: { output: await timedExecute(req, calls, fc.name ?? '', fc.args ?? {}) },
        },
      })));
      contents.push({ role: 'user', parts: results });
    }
    return { answer: '', toolCalls: calls, truncated: true };
  }

  /**
   * One retry covers a brief free-tier 429. CI sets GEMINI_MIN_INTERVAL_MS so the
   * eval stays under the 5 requests/minute cap instead of tripping it.
   */
  private async generate(contents: Content[], config: GenerateContentConfig) {
    const minInterval = geminiMinIntervalMs();
    for (let attempt = 1; ; attempt++) {
      const gap = paceDelayMs(this.lastCallAt, Date.now(), minInterval);
      if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
      this.lastCallAt = Date.now();
      try {
        return await this.ai.models.generateContent({ model: this.model, contents, config });
      } catch (error) {
        const status = retryableStatus(error);
        // 429: fail fast so OpenRouter / ledger-fallback runs — retries burn free-tier quota.
        if (status === 429 || isLongQuotaWait(error)) throw error;
        const budget = status === 503 || status === 504 ? 4 : 2;
        if (attempt >= budget || status === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, attempt, 20_000)));
      }
    }
  }
}
