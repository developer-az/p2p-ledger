import { describe, expect, it } from 'vitest';
import { CASES } from '../evals/cases.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';
import { answerFromLedger } from '../src/server/fallback.js';

describe('ledger fallback', () => {
  it('passes the same graders as the model evals, without calling a model', async () => {
    for (const testCase of CASES) {
      const reply = await answerFromLedger({
        ledger: new FixtureLedger(),
        spendLogs: fixtureSpendLogStore(),
        accountId: ME,
        question: testCase.question,
        now: () => NOW,
      });
      const failures = testCase.graders.map((grade) => grade(reply)).filter((f) => f !== null);
      expect(failures, testCase.id).toEqual([]);
    }
  });

  it("answers an afford question against the pace without calling the P2P balance cash", async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: null, spentMinor: 0 }),
    });
    expect(reply.answer).toContain("You haven't set a weekly pace");
    expect(reply.answer).toContain('covers $60.00');
    expect(reply.answer).toContain('$3,750.51');
    expect(reply.toolCalls.map((c) => c.tool)).toEqual(
      expect.arrayContaining(['get_account_overview', 'weekly_spending_story']),
    );
  });

  it('says the amount fits when it is inside the remaining weekly pace', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 40_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain('fits');
    expect(reply.answer).toContain('$170.00 left of your $400.00 weekly pace');
    expect(reply.answer).toContain('$3,750.51');
  });

  it('flags an amount above the remaining pace even when the balance covers it', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      // $500 balance, $250 pace, $230 logged: $20 left this week.
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 25_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain('over your weekly pace');
    expect(reply.answer).toContain('$20.00 left of $250.00 this week');
    expect(reply.answer).toContain('$3,750.51');
  });

  it('says the pace is already blown when the remaining amount is zero or less', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 20_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain('already over your weekly pace by $30.00');
  });

  it('keeps the spendable cash check ahead of the weekly pace', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $5,000 night out this week?',
      now: () => NOW,
      // A generous pace does not make money appear in the wallet.
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 1_000_000, spentMinor: 0 }),
    });
    expect(reply.answer).toContain('Your spendable cash is $3,750.51, less than $5,000.00');
  });

  it('uses profile cash when the P2P ledger balance is zero', async () => {
    class EmptyWalletLedger extends FixtureLedger {
      override async getAccount(id: string) {
        const account = await super.getAccount(id);
        return account && id === ME ? { ...account, balanceMinor: 0 } : account;
      }
    }
    const reply = await answerFromLedger({
      ledger: new EmptyWalletLedger(),
      spendLogs: fixtureSpendLogStore(), accountId: ME,
      question: 'Can I afford a $60 night out this week?', now: () => NOW,
      finance: async () => ({ spendableMinor: 50_000, budgetMinor: 40_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain('Yes, $60.00 fits');
    expect(reply.answer).toContain('spendable cash is $500.00');
  });

  it('says cash is unknown, not the P2P balance, when the user has entered no cash', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: null, budgetMinor: null, spentMinor: 0 }),
    });
    expect(reply.answer).toContain("You haven't entered your cash yet");
    expect(reply.answer).not.toContain('Yes, $60.00 fits');
    expect(reply.answer).not.toContain('covers');
    expect(reply.answer).toContain("Your friend-payments balance is $3,750.51, but that isn't your spending cash.");
    expect(reply.answer).toContain('Edit money snapshot');
  });

  it('says cash is unknown when there is no finance context at all', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
    });
    expect(reply.answer).toContain("You haven't entered your cash yet");
    expect(reply.answer).not.toContain('Yes, $60.00 fits');
  });

  it('still reports the weekly pace when cash is unknown', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford a $60 night out this week?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: null, budgetMinor: 40_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain("You haven't entered your cash yet");
    expect(reply.answer).toContain('You have $170.00 left of your $400.00 weekly pace');
    expect(reply.answer).toContain("isn't your spending cash");
  });

  it('asks for a dollar amount without cash knowing nothing about affordability', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford this?',
      now: () => NOW,
    });
    expect(reply.answer).toContain("You haven't entered your cash yet, so I can't tell if that fits.");
  });

  it('still refuses to send money even when the question reads like a purchase', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'send sam $60',
      now: () => NOW,
    });
    expect(reply.answer).toContain("I can't send money from chat");
    expect(reply.toolCalls).toEqual([]);
  });

  it('refuses a pay command that names an amount, not an afford question', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'pay jordan 20 for lunch',
      now: () => NOW,
    });
    expect(reply.answer).toContain("I can't send money from chat");
    expect(reply.toolCalls).toEqual([]);
  });

  it('answers "afford to pay" as an afford question, not a transfer command', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford to pay $60 for dinner?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: null, budgetMinor: null, spentMinor: 0 }),
    });
    expect(reply.answer).toContain("haven't entered your cash");
    expect(reply.answer).not.toContain("I can't send money from chat");
    expect(reply.answer).not.toContain("Can't send");
    expect(reply.toolCalls.map((c) => c.tool)).toEqual(
      expect.arrayContaining(['get_account_overview', 'weekly_spending_story']),
    );
  });

  it('answers "afford ... after my paycheck" as cash, not as income totals', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Can I afford $60 after my paycheck?',
      now: () => NOW,
      finance: async () => ({ spendableMinor: null, budgetMinor: null, spentMinor: 0 }),
    });
    expect(reply.answer).toContain("haven't entered your cash");
    expect(reply.answer).not.toContain('in deposits');
    expect(reply.toolCalls.map((c) => c.tool)).toContain('weekly_spending_story');
    expect(reply.toolCalls.map((c) => c.tool)).not.toContain('summarize_activity');
  });

  it('refuses an imperative transfer that mentions affordability', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'Pay Jordan $20 so he can afford lunch',
      now: () => NOW,
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 40_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain("I can't send money from chat");
    expect(reply.answer).not.toContain('fits');
    expect(reply.answer).not.toContain('covers');
    expect(reply.toolCalls).toEqual([]);
  });

  it('refuses a politely phrased transfer that mentions affordability', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'please send sam $60 so I can afford rent',
      now: () => NOW,
      finance: async () => ({ spendableMinor: 375_051, budgetMinor: 40_000, spentMinor: 23_000 }),
    });
    expect(reply.answer).toContain("I can't send money from chat");
    expect(reply.answer).not.toContain('fits');
    expect(reply.toolCalls).toEqual([]);
  });

  /* The verb does not have to open the sentence for the request to be a command,
     even when an "afford" clause follows it. */
  for (const question of [
    'Can you pay Jordan $20 so he can afford lunch?',
    'could you please send sam $60',
    'I want to pay jordan $20 so he can afford lunch',
    'go ahead and transfer $50 to sam',
    'I need you to pay Jordan $20 so he can afford lunch',
    'Pay Jordan $20 so he can afford lunch',
  ]) {
    it(`refuses a transfer phrased inside a request: ${question}`, async () => {
      const reply = await answerFromLedger({
        ledger: new FixtureLedger(),
        spendLogs: fixtureSpendLogStore(),
        accountId: ME,
        question,
        now: () => NOW,
        finance: async () => ({ spendableMinor: 375_051, budgetMinor: 40_000, spentMinor: 23_000 }),
      });
      expect(reply.answer).toContain("I can't send money from chat");
      expect(reply.answer).not.toContain('fits');
      expect(reply.toolCalls).toEqual([]);
    });
  }

  /* "send me" asks for information, and "afford to pay" asks whether the money
     is there: neither is a transfer, so both get the affordability answer. */
  for (const question of [
    'Can you send me a breakdown of whether I can afford $60?',
    'Can I afford to pay $60 for dinner?',
  ]) {
    it(`answers an information request instead of refusing it: ${question}`, async () => {
      const reply = await answerFromLedger({
        ledger: new FixtureLedger(),
        spendLogs: fixtureSpendLogStore(),
        accountId: ME,
        question,
        now: () => NOW,
        finance: async () => ({ spendableMinor: 375_051, budgetMinor: 40_000, spentMinor: 23_000 }),
      });
      expect(reply.answer).not.toContain("I can't send money from chat");
      expect(reply.answer).toContain('$60.00 fits');
    });
  }

  it('still sends income questions to the income branch', async () => {
    const reply = await answerFromLedger({
      ledger: new FixtureLedger(),
      spendLogs: fixtureSpendLogStore(),
      accountId: ME,
      question: 'How much income came in this month?',
      now: () => NOW,
    });
    expect(reply.answer).toContain('in deposits');
    expect(reply.toolCalls.map((c) => c.tool)).toContain('summarize_activity');
    expect(reply.toolCalls.map((c) => c.tool)).not.toContain('weekly_spending_story');
  });
});
