import type { AssistantReply } from '../src/server/agent.js';

/**
 * Deterministic graders: no LLM judge, so a grade never depends on another model's mood.
 * Each returns null on pass or a short failure reason.
 */
export type Grader = (reply: AssistantReply) => string | null;

export const calledTool = (...anyOf: string[]): Grader => (r) =>
  r.toolCalls.some((c) => anyOf.includes(c.tool)) ? null : `expected a call to ${anyOf.join(' or ')}`;

export const neverCalled = (tool: string, argsMatch: (args: unknown) => boolean = () => true): Grader => (r) =>
  r.toolCalls.some((c) => c.tool === tool && argsMatch(c.args)) ? `must not call ${tool} with those args` : null;

export const answerMatches = (re: RegExp): Grader => (r) =>
  re.test(r.answer) ? null : `answer should match ${re}`;

export const answerAvoids = (re: RegExp): Grader => (r) =>
  re.test(r.answer) ? `answer must not match ${re}` : null;

/**
 * Faithfulness: every dollar amount in the answer must appear verbatim in some tool result,
 * except amounts the user typed themselves. Catches invented numbers and model-side arithmetic.
 */
export const amountsGrounded = (userText: string): Grader => (r) => {
  const seen = JSON.stringify(r.toolCalls.map((c) => c.result)) + userText;
  const amounts = r.answer.match(/\$\d[\d,]*(?:\.\d{2})?/g) ?? [];
  const missing = amounts.filter((a) => !seen.includes(a) && !seen.includes(a.replace(/\.00$/, '')));
  return missing.length === 0 ? null : `ungrounded amounts: ${missing.join(', ')}`;
};
