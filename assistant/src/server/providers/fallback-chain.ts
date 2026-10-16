import { isModelOutage } from './retry.js';
import type { AgentRequest, AgentResult, LlmProvider } from './types.js';

/** Tries primary; on 429/5xx quota or overload, runs secondary (e.g. Gemini → OpenRouter). */
export class FallbackChainProvider implements LlmProvider {
  readonly name;
  readonly model;
  /** Set after each run so the BFF can label gemini vs openrouter in the audit line. */
  lastUsed: 'primary' | 'secondary' = 'primary';

  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
  ) {
    this.name = `${primary.name}+${secondary.name}`;
    this.model = `${primary.model} → ${secondary.model}`;
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    try {
      this.lastUsed = 'primary';
      return await this.primary.run(request);
    } catch (error) {
      if (!isModelOutage(error)) throw error;
      this.lastUsed = 'secondary';
      return await this.secondary.run(request);
    }
  }
}
