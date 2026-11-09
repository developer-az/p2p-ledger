import type { ToolSpec } from '../tools.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ToolCallRecord {
  tool: string;
  args: unknown;
  result: unknown;
  ms: number;
}

export interface AgentRequest {
  system: string;
  /** Prior turns as plain text, ending with the new user message. */
  messages: ChatTurn[];
  tools: ToolSpec[];
  execute: (name: string, args: unknown) => Promise<unknown>;
  maxSteps: number;
  /** Absolute deadline for the entire assistant call, including retries and tool turns. */
  deadlineAt?: number;
}

export interface AgentResult {
  answer: string;
  toolCalls: ToolCallRecord[];
  /** True when the step limit stopped the loop before the model finished. */
  truncated: boolean;
}

/**
 * One LLM vendor. Each provider owns its tool-calling loop, because the wire formats differ
 * (Anthropic must get its content blocks echoed back unchanged, Gemini wants functionResponse
 * parts), but all of them run the same tools through `execute` and return the same result.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  run(request: AgentRequest): Promise<AgentResult>;
}

export function deadlineError(): Error & { status: number } {
  return Object.assign(new Error('Assistant deadline exceeded'), { status: 504 });
}

/** Leave one second for the caller to handle the response or move to its fallback. */
export function attemptTimeoutMs(deadlineAt: number | undefined, normalMs: number): number {
  if (deadlineAt === undefined) return normalMs;
  const remaining = deadlineAt - Date.now() - 1_000;
  if (remaining <= 0) throw deadlineError();
  return Math.min(normalMs, remaining);
}

export function canRetryAfter(deadlineAt: number | undefined, delayMs: number): boolean {
  return deadlineAt === undefined || deadlineAt - Date.now() > delayMs + 2_000;
}

export async function timedExecute(req: AgentRequest, calls: ToolCallRecord[], tool: string, args: unknown) {
  const start = performance.now();
  let result: unknown;
  try {
    result = await req.execute(tool, args);
  } catch (e) {
    result = { error: `Tool failed: ${(e as Error).message}` };
  }
  calls.push({ tool, args, result, ms: Math.round(performance.now() - start) });
  return result;
}
