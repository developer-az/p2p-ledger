import { GoogleGenAI, type Content } from '@google/genai';
import { timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, readonly model = 'gemini-flash-latest') {
    this.ai = new GoogleGenAI({ apiKey });
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
      const res = await this.ai.models.generateContent({ model: this.model, contents, config });
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
}
