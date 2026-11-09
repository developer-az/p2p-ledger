import { GoogleGenAI, type Content, type GenerateContentConfig } from '@google/genai';
import { geminiMinIntervalMs, isLongQuotaWait, isModelMissing, paceDelayMs, retryableStatus, retryDelayMs } from './retry.js';
import { attemptTimeoutMs, canRetryAfter, deadlineError, timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

const GEMINI_TIMEOUT_MS = 45_000;

/** Google keeps this alias pointed at a current flash-lite model, so retired ids can fall back to it. */
const GEMINI_LATEST_FLASH_LITE = 'gemini-flash-lite-latest';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  /** The configured model id; it does not change after an alias switch. */
  readonly model: string;
  /** The model id that produced the last answer. */
  lastModel: string;
  private activeModel: string;
  private readonly ai: GoogleGenAI;
  private lastCallAt = 0;

  constructor(apiKey: string, model = 'gemini-2.5-flash-lite') {
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: GEMINI_TIMEOUT_MS } });
    this.model = model;
    this.activeModel = model;
    this.lastModel = model;
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
      const res = await this.generate(contents, config, req.deadlineAt);
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
  private async generate(contents: Content[], config: GenerateContentConfig, deadlineAt?: number) {
    const minInterval = geminiMinIntervalMs();
    for (let attempt = 1; ; attempt++) {
      const gap = paceDelayMs(this.lastCallAt, Date.now(), minInterval);
      if (!canRetryAfter(deadlineAt, gap)) throw deadlineError();
      if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
      const timeoutMs = attemptTimeoutMs(deadlineAt, GEMINI_TIMEOUT_MS);
      this.lastCallAt = Date.now();
      try {
        const res = await this.ai.models.generateContent({
          model: this.activeModel, contents,
          config: { ...config, httpOptions: { timeout: timeoutMs }, abortSignal: AbortSignal.timeout(timeoutMs) },
        });
        if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw deadlineError();
        this.lastModel = this.activeModel;
        return res;
      } catch (error) {
        if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw deadlineError();
        if ((error as { name?: string }).name === 'AbortError' || (error as { name?: string }).name === 'TimeoutError') {
          throw Object.assign(new Error(`Gemini timeout after ${timeoutMs}ms`), { status: 504 });
        }
        // A retired model id answers 404/NOT_FOUND; the alias is the only slug Google keeps current.
        if (isModelMissing(error) && this.activeModel !== GEMINI_LATEST_FLASH_LITE) {
          if (!canRetryAfter(deadlineAt, 0)) throw error;
          this.activeModel = GEMINI_LATEST_FLASH_LITE;
          continue;
        }
        const status = retryableStatus(error);
        // 429: fail fast so OpenRouter / ledger-fallback runs — retries burn free-tier quota.
        if (status === 429 || isLongQuotaWait(error)) throw error;
        const budget = status === 503 || status === 504 ? 4 : 2;
        if (attempt >= budget || status === undefined) throw error;
        const delay = retryDelayMs(error, attempt, 20_000);
        if (!canRetryAfter(deadlineAt, delay)) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
