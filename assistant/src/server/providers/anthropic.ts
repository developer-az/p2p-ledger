import Anthropic from '@anthropic-ai/sdk';
import { timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly model = 'claude-opus-5-5') {
    this.client = new Anthropic({ apiKey });
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.text }));
    const calls: ToolCallRecord[] = [];

    for (let step = 0; step < req.maxSteps; step++) {
      const response = await this.client.beta.messages.create({
        model: this.model,
        // If a safety classifier declines, the API re-runs the turn on a fallback model it picks.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        max_tokens: 16000,
        system: req.system,
        tools,
        messages,
        output_config: { effort: 'low' },
      });
      if (response.stop_reason === 'refusal') {
        return { answer: "I can't help with that request.", toolCalls: calls, truncated: false };
      }
      // Append the full content (thinking blocks included) so the next request continues the same turn.
      messages.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'pause_turn') continue;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const answer = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return { answer, toolCalls: calls, truncated: false };
      }
      // Parallel tool calls: run them concurrently and return all results in one user message.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(toolUses.map(async (use) => ({
        type: 'tool_result' as const,
        tool_use_id: use.id,
        content: JSON.stringify(await timedExecute(req, calls, use.name, use.input)),
      })));
      messages.push({ role: 'user', content: results });
    }
    return { answer: '', toolCalls: calls, truncated: true };
  }
}
