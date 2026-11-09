import { isProviderUnavailable } from './retry.js';
import { deadlineError, type AgentRequest, type AgentResult, type LlmProvider } from './types.js';

async function withinDeadline(provider: LlmProvider, request: AgentRequest): Promise<AgentResult> {
  if (request.deadlineAt === undefined) return provider.run(request);
  const remaining = request.deadlineAt - Date.now();
  if (remaining <= 0) throw deadlineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.run(request),
      new Promise<AgentResult>((_resolve, reject) => {
        timer = setTimeout(() => reject(deadlineError()), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Tries primary; on outage (429/5xx) or an unusable model (404, retired slug, guardrail),
 * runs secondary (e.g. Gemini → OpenRouter).
 */
export class FallbackChainProvider implements LlmProvider {
  readonly name;
  readonly model;
  /** Set after each run so the BFF can label which side answered in the audit line. */
  lastUsed: 'primary' | 'secondary' = 'primary';

  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
  ) {
    this.name = `${primary.name}+${secondary.name}`;
    this.model = `${primary.model} → ${secondary.model}`;
  }

  /** Name of the provider that ran last. */
  get lastProviderName(): string {
    return this.lastUsed === 'secondary' ? this.secondary.name : this.primary.name;
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    const primaryRequest = request.deadlineAt === undefined ? request : {
      ...request,
      deadlineAt: Date.now() + Math.floor(Math.max(0, request.deadlineAt - Date.now()) * 0.45),
    };
    try {
      this.lastUsed = 'primary';
      return await withinDeadline(this.primary, primaryRequest);
    } catch (error) {
      if (!isProviderUnavailable(error)) throw error;
      this.lastUsed = 'secondary';
      return await withinDeadline(this.secondary, request);
    }
  }
}
