import { mkdirSync, writeFileSync } from 'node:fs';
import { runAssistant, type AssistantReply } from '../src/server/agent.js';
import { providerFromEnv } from '../src/server/providers/index.js';
import { isModelOutage, isNetworkError, retryableStatus, retryDelayMs } from '../src/server/providers/retry.js';
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // One retry. Calls are already paced, and repeating a whole case many times
      // made a single stuck question run for more than ten minutes with no log line.
      const budget = isModelOutage(e) ? 4 : isNetworkError(e) ? 2 : attempts;
      if (i >= budget || retryableStatus(e) === undefined) throw e;
      console.log(`  retry ${i}: ${(e as Error).message.slice(0, 180)}`);
      await new Promise((r) => setTimeout(r, retryDelayMs(e, i)));
    }
  }
}

const rows: { id: string; trial: number; pass: boolean; skipped: boolean; failures: string[]; tools: string[]; answer: string; ms: number }[] = [];
for (const testCase of CASES) {
  for (let trial = 1; trial <= trials; trial++) {
    const start = performance.now();
    console.log(`${testCase.id}: running`);
    let reply: AssistantReply;
    try {
      reply = await withRetry(() => runAssistant({
        provider, ledger, accountId: ME, now: () => NOW,
        messages: [{ role: 'user', text: testCase.question }],
      }));
    } catch (e) {
      const ms = Math.round(performance.now() - start);
      const message = (e as Error).message.split('\n')[0]?.slice(0, 300) ?? 'failed';
      const skipped = isModelOutage(e);
      rows.push({ id: testCase.id, trial, pass: false, skipped, failures: [message], tools: [], answer: '', ms });
      console.log(`${skipped ? 'SKIP' : 'FAIL'}  ${testCase.id}  ${ms} ms`);
      console.log(`      ${message}`);
      continue;
    }
    const failures = testCase.graders.map((g) => g(reply)).filter((f): f is string => f !== null);
    const ms = Math.round(performance.now() - start);
    rows.push({ id: testCase.id, trial, pass: failures.length === 0, skipped: false, failures,
      tools: reply.toolCalls.map((t) => t.tool), answer: reply.answer, ms });
    console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'}  ${testCase.id}  ${ms} ms`);
    if (failures.length > 0) console.log(`      ${failures.join('; ')}`);
  }
}

const graded = rows.filter((r) => !r.skipped);
const passRate = graded.length === 0 ? 1 : graded.filter((r) => r.pass).length / graded.length;
console.log(`\n\n${provider.name} / ${provider.model}: ${(passRate * 100).toFixed(1)}% of ${graded.length} graded runs passed\n`);
for (const testCase of CASES) {
  const mine = rows.filter((r) => r.id === testCase.id);
  const passed = mine.filter((r) => r.pass).length;
  const skipped = mine.length > 0 && mine.every((r) => r.skipped);
  const p50 = mine.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(mine.length / 2)];
  const label = skipped ? 'SKIP' : passed === mine.length ? 'PASS' : 'FAIL';
  console.log(`${label}  ${testCase.id.padEnd(18)} ${passed}/${mine.length}  p50 ${p50} ms`);
  for (const r of mine.filter((x) => !x.pass)) console.log(`      trial ${r.trial}: ${r.failures.join('; ')}\n      answer: ${r.answer.slice(0, 200)}`);
}

mkdirSync('evals/results', { recursive: true });
writeFileSync(`evals/results/${provider.name}-${provider.model}.json`,
  JSON.stringify({ provider: provider.name, model: provider.model, trials, passRate, at: new Date().toISOString(), rows }, null, 2));
if (graded.length === 0) console.log('No graded runs: the model was unavailable, so this is not a product failure.');
process.exit(passRate >= minPassRate ? 0 : 1);
