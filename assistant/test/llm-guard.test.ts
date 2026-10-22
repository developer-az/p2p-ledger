import { describe, expect, it } from 'vitest';
import type { AssistantReply } from '../src/server/agent.js';
import { conversationKey, LlmGuard, normalizeQuestion, trimHistory } from '../src/server/llm-guard.js';

const reply = (answer: string): AssistantReply => ({ answer, toolCalls: [], provider: 'test', model: 'test' });
const question = (text: string) => [{ role: 'user' as const, text }];

describe('normalizeQuestion', () => {
  it('folds case, punctuation and spacing so repeats match', () => {
    expect(normalizeQuestion("What's my balance?")).toBe(normalizeQuestion('whats   my balance'));
    expect(normalizeQuestion('  Pay Sam $12.50!  ')).toBe('pay sam 12 50');
  });
});

describe('trimHistory', () => {
  it('keeps only the newest messages and starts on a user turn', () => {
    const turns = [
      { role: 'user' as const, text: 'one' },
      { role: 'assistant' as const, text: 'two' },
      { role: 'user' as const, text: 'three' },
      { role: 'assistant' as const, text: 'four' },
      { role: 'user' as const, text: 'five' },
    ];
    const trimmed = trimHistory(turns, 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0]!.role).toBe('user');
    expect(trimmed.at(-1)!.text).toBe('five');
  });

  it('caps the payload sent to the model', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, text: `q${i}` }));
    expect(trimHistory(many).length).toBeLessThanOrEqual(10);
  });
});

describe('conversationKey', () => {
  it('is stable for the same conversation tail and different across accounts', () => {
    const a = conversationKey('acct-1', question('What did I spend?'));
    const b = conversationKey('acct-1', question('what did I SPEND?'));
    const c = conversationKey('acct-2', question('What did I spend?'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('LlmGuard', () => {
  it('answers from cache without calling the model again', async () => {
    const guard = new LlmGuard({ now: () => 1_000_000 });
    let produced = 0;
    const opts = {
      accountId: 'acct-1',
      messages: question('whats my balance'),
      produce: async () => { produced += 1; return reply('You have $50.'); },
      degrade: async (reason: string) => reply(reason),
    };
    const first = await guard.answer(opts);
    const second = await guard.answer(opts);
    expect(produced).toBe(1);
    expect(first.cache).toBe('fresh');
    expect(second.cache).toBe('hit');
    expect(second.reply.cached).toBe(true);
    expect(second.reply.answer).toBe('You have $50.');
  });

  it('expires cached answers after the ttl', async () => {
    let clock = 0;
    const guard = new LlmGuard({ ttlMs: 100, now: () => clock });
    let produced = 0;
    const opts = {
      accountId: 'acct-1',
      messages: question('balance'),
      produce: async () => { produced += 1; return reply(`answer ${produced}`); },
      degrade: async (reason: string) => reply(reason),
    };
    await guard.answer(opts);
    clock = 500;
    const again = await guard.answer(opts);
    expect(produced).toBe(2);
    expect(again.cache).toBe('fresh');
  });

  it('shares one model call between identical concurrent questions', async () => {
    const guard = new LlmGuard();
    let produced = 0;
    let release: (value: AssistantReply) => void = () => {};
    const gate = new Promise<AssistantReply>((resolve) => { release = resolve; });
    const opts = {
      accountId: 'acct-1',
      messages: question('same question'),
      produce: async () => { produced += 1; return gate; },
      degrade: async (reason: string) => reply(reason),
    };
    const first = guard.answer(opts);
    const second = guard.answer(opts);
    release(reply('one answer'));
    const [a, b] = await Promise.all([first, second]);
    expect(produced).toBe(1);
    expect([a.cache, b.cache].sort()).toEqual(['fresh', 'shared']);
  });

  it('sends an over-budget account to the degrade path instead of the model', async () => {
    const guard = new LlmGuard({ accountDailyLimit: 1 });
    let produced = 0;
    const make = (text: string) => ({
      accountId: 'acct-1',
      messages: question(text),
      produce: async () => { produced += 1; return reply('from model'); },
      degrade: async (reason: string): Promise<AssistantReply> => ({
        ...reply(reason),
        route: 'ledger-fallback',
        fallbackReason: reason,
      }),
    });
    await guard.answer(make('first'));
    const over = await guard.answer(make('second'));
    expect(produced).toBe(1);
    expect(over.cache).toBe('budget');
    expect(over.reply.route).toBe('ledger-fallback');
    expect(over.reply.fallbackReason).toMatch(/budget/i);
  });

  it('enforces the app-wide daily limit across accounts', async () => {
    const guard = new LlmGuard({ dailyLimit: 2, accountDailyLimit: 100 });
    const make = (accountId: string) => ({
      accountId,
      messages: question('hello'),
      produce: async () => reply('from model'),
      degrade: async (reason: string) => reply(reason),
    });
    await guard.answer(make('a'));
    await guard.answer(make('b'));
    const third = await guard.answer(make('c'));
    expect(third.cache).toBe('budget');
  });

  it('does not cache producer failures, so the next ask retries', async () => {
    const guard = new LlmGuard();
    let attempts = 0;
    const opts = {
      accountId: 'acct-1',
      messages: question('flaky'),
      produce: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('model down');
        return reply('recovered');
      },
      degrade: async (reason: string) => reply(reason),
    };
    await expect(guard.answer(opts)).rejects.toThrow('model down');
    const retry = await guard.answer(opts);
    expect(attempts).toBe(2);
    expect(retry.reply.answer).toBe('recovered');
    expect(retry.cache).toBe('fresh');
  });
});