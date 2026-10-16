import { mkdirSync, writeFileSync } from 'node:fs';
import { runAssistant, type AssistantReply } from '../src/server/agent.js';
import { providerFromEnv } from '../src/server/providers/index.js';
import { isLongQuotaWait, isModelOutage, isNetworkError, retryableStatus, retryDelayMs } from '../src/server/providers/retry.js';
import { CASES, type EvalCase } from './cases.js';
import { FixtureLedger, ME, NOW } from './fixture.js';

if (process.env.ALLOW_LIVE_LLM_EVAL !== '1') {
  console.error(
    'Live LLM evals are opt-in (they consume API quota). Run:\n' +
      '  ALLOW_LIVE_LLM_EVAL=1 GEMINI_API_KEY=... npm run eval',
  );
  process.exit(1);
}

/**
 * Runs every case TRIALS times against the configured LLM and the fixture ledger.
 *   ALLOW_LIVE_LLM_EVAL=1 GEMINI_API_KEY=... npm run eval   (TRIALS=3 by default)
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval
 *   EVAL_CASE_IDS=balance,refuses-writes npm run eval   (subset)
 * Exits non-zero if the pass rate is below EVAL_MIN_PASS_RATE (default 0.9).
 * With EVAL_REQUIRE_COMPLETE=1, any skipped run (quota/outage) fails the process.
 */
const trials = Number(process.env.TRIALS ?? 3);
const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.9);
const requireComplete = process.env.EVAL_REQUIRE_COMPLETE === '1';

function casesToRun(): EvalCase[] {
  const raw = process.env.EVAL_CASE_IDS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!raw?.length) return CASES;
  const picked = CASES.filter((c) => raw.includes(c.id));
  const unknown = raw.filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown EVAL_CASE_IDS: ${unknown.join(', ')}`);
    process.exit(1);
  }
  console.log(`Running ${picked.length} case(s): ${picked.map((c) => c.id).join(', ')}`);
  return picked;
}

const evalCases = casesToRun();
const provider = providerFromEnv();
const ledger = new FixtureLedger();

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // One retry. Calls are already paced, and repeating a whole case many times
      // made a single stuck question run for more than ten minutes with no log line.
      const budget = isModelOutage(e) ? 1 : isNetworkError(e) ? 2 : attempts;
      if (isLongQuotaWait(e) || i >= budget || retryableStatus(e) === undefined) throw e;
      console.log(`  retry ${i}: ${(e as Error).message.slice(0, 180)}`);
      await new Promise((r) => setTimeout(r, retryDelayMs(e, i)));
    }
  }
}

const rows: { id: string; trial: number; pass: boolean; skipped: boolean; failures: string[]; tools: string[]; answer: string; ms: number }[] = [];
let dailyQuotaClosed = false;
for (const testCase of evalCases) {
  for (let trial = 1; trial <= trials; trial++) {
    const start = performance.now();
    if (dailyQuotaClosed) {
      rows.push({
        id: testCase.id, trial, pass: false, skipped: true,
        failures: ['Daily Gemini quota already exhausted'], tools: [], answer: '', ms: 0,
      });
      console.log(`SKIP  ${testCase.id}  daily quota already exhausted`);
      continue;
    }
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
      if (isLongQuotaWait(e)) dailyQuotaClosed = true;
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
for (const testCase of evalCases) {
  const mine = rows.filter((r) => r.id === testCase.id);
  const passed = mine.filter((r) => r.pass).length;
  const skipped = mine.length > 0 && mine.every((r) => r.skipped);
  const p50 = mine.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(mine.length / 2)];
  const label = skipped ? 'SKIP' : passed === mine.length ? 'PASS' : 'FAIL';
  console.log(`${label}  ${testCase.id.padEnd(18)} ${passed}/${mine.length}  p50 ${p50} ms`);
  for (const r of mine.filter((x) => !x.pass)) console.log(`      trial ${r.trial}: ${r.failures.join('; ')}\n      answer: ${r.answer.slice(0, 200)}`);
}

mkdirSync('evals/results', { recursive: true });
const skippedCount = rows.filter((r) => r.skipped).length;
const expectedRuns = evalCases.length * trials;
writeFileSync(`evals/results/${provider.name}-${provider.model}.json`,
  JSON.stringify({
    provider: provider.name, model: provider.model, trials, passRate, caseIds: evalCases.map((c) => c.id),
    skippedCount, expectedRuns, at: new Date().toISOString(), rows,
  }, null, 2));
if (graded.length === 0) console.log('No graded runs: the model was unavailable, so this is not a product failure.');
if (requireComplete && skippedCount > 0) {
  console.error(
    `\nEval incomplete: ${skippedCount}/${expectedRuns} run(s) skipped (quota or outage). ` +
    'Retry when quota resets, or run a smaller EVAL_CASE_IDS set locally.',
  );
  process.exit(1);
}
process.exit(passRate >= minPassRate ? 0 : 1);
