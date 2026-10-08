import { timedExecute, type AgentRequest, type AgentResult, type LlmProvider, type ToolCallRecord } from './types.js';

export interface ScriptStep {
  calls?: { tool: string; args: unknown }[];
  answer?: string;
}

/**
 * Deterministic stand-in for an LLM: replays a fixed script of tool calls and answers. Used by
 * unit tests to exercise the agent loop, tool scoping and the step limit without network calls.
 */
export class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted';
  lastRequest?: AgentRequest;

  constructor(private readonly script: ScriptStep[]) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    this.lastRequest = req;
    const calls: ToolCallRecord[] = [];
    for (let step = 0; step < req.maxSteps; step++) {
      const next = this.script[step];
      if (!next || next.answer !== undefined) {
        return { answer: next?.answer ?? '', toolCalls: calls, truncated: false };
      }
      for (const c of next.calls ?? []) await timedExecute(req, calls, c.tool, c.args);
    }
    return { answer: '', toolCalls: calls, truncated: true };
  }
}
