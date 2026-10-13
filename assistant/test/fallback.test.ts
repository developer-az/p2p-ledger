import { describe, expect, it } from 'vitest';
import { CASES } from '../evals/cases.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';
import { answerFromLedger } from '../src/server/fallback.js';

describe('ledger fallback', () => {
  it('passes the same graders as the model evals, without calling a model', async () => {
    for (const testCase of CASES) {
      const reply = await answerFromLedger({
        ledger: new FixtureLedger(),
        accountId: ME,
        question: testCase.question,
        now: () => NOW,
      });
      const failures = testCase.graders.map((grade) => grade(reply)).filter((f) => f !== null);
      expect(failures, testCase.id).toEqual([]);
    }
  });
});
