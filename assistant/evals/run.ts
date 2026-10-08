import { mkdirSync, writeFileSync } from 'node:fs';
import { runAssistant, type AssistantReply } from '../src/server/agent.js';
import { providerFromEnv } from '../src/server/providers/index.js';
import { CASES } from './cases.js';
import { FixtureLedger, ME, NOW } from './fixture.js';

/**
 * Runs every case TRIALS times against the configured LLM and the fixture ledger.
 *   GEMINI_API_KEY=... npm run eval            (TRIALS=3 by default)
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval
 * Exits non-zero if the pass rate is below EVAL_MIN_PASS_RATE (default 0.9).
 */
const trials = Number(process.env.TRIALS ?? 3);
const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.9);
const provider = providerFromEnv();
const ledger = new FixtureLedger();

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (i >= attempts || (status !== 429 && (status ?? 0) < 500)) throw e;
      await new Promise((r) => setTimeout(r, 2 ** i * 1000)); // free tiers rate-limit hard
    }
  }
}

const rows: { id: string; trial: number; pass: boolean; failures: string[]; tools: string[]; answer: string; ms: number }[] = [];
for (const testCase of CASES) {
  for (let trial = 1; trial <= trials; trial++) {
    const start = performance.now();
    const reply: AssistantReply = await withRetry(() => runAssistant({
      provider, ledger, accountId: ME, now: () => NOW,
      messages: [{ role: 'user', text: testCase.question }],
    }));
    const failures = testCase.graders.map((g) => g(reply)).filter((f): f is string => f !== null);
    rows.push({ id: testCase.id, trial, pass: failures.length === 0, failures,
      tools: reply.toolCalls.map((t) => t.tool), answer: reply.answer, ms: Math.round(performance.now() - start) });
    process.stdout.write(failures.length === 0 ? '.' : 'F');
  }
}

const passRate = rows.filter((r) => r.pass).length / rows.length;
console.log(`\n\n${provider.name} / ${provider.model}: ${(passRate * 100).toFixed(1)}% of ${rows.length} runs passed\n`);
for (const testCase of CASES) {
  const mine = rows.filter((r) => r.id === testCase.id);
  const passed = mine.filter((r) => r.pass).length;
  const p50 = mine.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(mine.length / 2)];
  console.log(`${passed === mine.length ? 'PASS' : 'FAIL'}  ${testCase.id.padEnd(18)} ${passed}/${mine.length}  p50 ${p50} ms`);
  for (const r of mine.filter((x) => !x.pass)) console.log(`      trial ${r.trial}: ${r.failures.join('; ')}\n      answer: ${r.answer.slice(0, 200)}`);
}

mkdirSync('evals/results', { recursive: true });
writeFileSync(`evals/results/${provider.name}-${provider.model}.json`,
  JSON.stringify({ provider: provider.name, model: provider.model, trials, passRate, at: new Date().toISOString(), rows }, null, 2));
process.exit(passRate >= minPassRate ? 0 : 1);
