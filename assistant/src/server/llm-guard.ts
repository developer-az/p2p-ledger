import type { AssistantReply } from './agent.js';
import type { ChatTurn } from './providers/types.js';

/**
 * LlmGuard keeps the paid LLM quota for questions that actually need it.
 *
 * Three layers, cheapest first:
 *   1. Answer cache — the same question about the same data is answered from memory
 *      (double clicks, refreshes, "what's my balance" asked three times).
 *   2. In-flight coalescing — identical concurrent questions share one model call
 *      (StrictMode double effects, two tabs, impatient retypes).
 *   3. Daily budget — per-account and global caps. Over budget, the deterministic
 *      ledger fallback answers instead of burning quota or hitting 429s.
 *
 * State is per-process. That is enough on a single Node server, and still useful on
 * serverless (each warm instance sheds its own repeats). For multi-instance fleets,
 * swap the maps for Redis/KV with the same interface — see docs/AI-SCALE.md.
 */

export interface GuardOptions {
  /** How long a cached answer stays fresh. Default 10 minutes. */
  ttlMs?: number;
  /** Cache size cap; oldest entries are evicted. Default 400. */
  maxEntries?: number;
  /** LLM calls allowed per calendar day across all accounts. Default 300. */
  dailyLimit?: number;
  /** LLM calls allowed per account per calendar day. Default 40. */
  accountDailyLimit?: number;
  now?: () => number;
}

export interface GuardResult {
  reply: AssistantReply;
  /** How the answer was produced (UI badge + debugging). */
  cache: 'hit' | 'shared' | 'fresh' | 'budget';
}

const DEFAULTS = { ttlMs: 600_000, maxEntries: 400, dailyLimit: 300, accountDailyLimit: 40 };

/** Lowercase, drop apostrophes, strip punctuation, collapse whitespace — "What's my balance?" === "whats my balance". */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/['\u2018\u2019`\u02bc]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 240);
}

/**
 * Caps what goes to the model: the newest question matters, old turns are context.
 * Keeps at most `maxMessages` messages and always starts on a user turn.
 */
export function trimHistory(messages: ChatTurn[], maxMessages = 10): ChatTurn[] {
  const kept = messages.slice(-maxMessages);
  while (kept.length > 1 && kept[0]!.role !== 'user') kept.shift();
  return kept;
}

/** Stable key: same account + same conversation tail = the same question. */
export function conversationKey(accountId: string, messages: ChatTurn[]): string {
  const tail = messages
    .slice(-4)
    .map((m) => `${m.role}:${normalizeQuestion(m.text)}`)
    .join('|');
  return `${accountId}|${tail}`;
}

interface CacheEntry {
  reply: AssistantReply;
  expiresAt: number;
}

export class LlmGuard {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<AssistantReply>>();
  private readonly daily = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly dailyLimit: number;
  private readonly accountDailyLimit: number;
  private readonly now: () => number;

  constructor(options: GuardOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULTS.ttlMs;
    this.maxEntries = options.maxEntries ?? DEFAULTS.maxEntries;
    this.dailyLimit = options.dailyLimit ?? DEFAULTS.dailyLimit;
    this.accountDailyLimit = options.accountDailyLimit ?? DEFAULTS.accountDailyLimit;
    this.now = options.now ?? Date.now;
  }

  /** Answers without repeating work: cache → shared in-flight call → fresh call (if budget allows). */
  async answer(opts: {
    accountId: string;
    messages: ChatTurn[];
    /** Runs the LLM. Only called on a real miss and only while budget remains. */
    produce: () => Promise<AssistantReply>;
    /** Deterministic fallback when the budget is spent. */
    degrade: (reason: string) => Promise<AssistantReply>;
  }): Promise<GuardResult> {
    const key = conversationKey(opts.accountId, opts.messages);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return { reply: { ...cached.reply, cached: true }, cache: 'hit' };
    }

    const pending = this.inflight.get(key);
    if (pending) {
      const reply = await pending;
      return { reply: { ...reply, cached: true }, cache: 'shared' };
    }

    const budgetReason = this.reserveBudget(opts.accountId);
    if (budgetReason) {
      const reply = await opts.degrade(budgetReason);
      return { reply, cache: 'budget' };
    }

    const run = opts
      .produce()
      .then((reply) => {
        this.cache.set(key, { reply, expiresAt: this.now() + this.ttlMs });
        this.evict();
        return reply;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return { reply: await run, cache: 'fresh' };
  }

  /** The reason string when the budget is spent, null when a call may proceed. */
  private reserveBudget(accountId: string): string | null {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const appKey = `app:${day}`;
    const accountKey = `acct:${accountId}:${day}`;
    const appUsed = this.daily.get(appKey) ?? 0;
    const accountUsed = this.daily.get(accountKey) ?? 0;
    if (appUsed >= this.dailyLimit) {
      return 'Daily assistant budget is used up. Answers come from your ledger until tomorrow.';
    }
    if (accountUsed >= this.accountDailyLimit) {
      return 'Your assistant budget for today is used up. Answers come from your ledger until tomorrow.';
    }
    this.daily.set(appKey, appUsed + 1);
    this.daily.set(accountKey, accountUsed + 1);
    this.pruneDaily(day);
    return null;
  }

  /** Drop counters from previous days so the map cannot grow forever. */
  private pruneDaily(today: string): void {
    for (const key of this.daily.keys()) {
      if (!key.includes(today)) this.daily.delete(key);
    }
  }

  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }

  /** Test/debug helper. */
  stats(): { cached: number; inflight: number; counters: number } {
    return { cached: this.cache.size, inflight: this.inflight.size, counters: this.daily.size };
  }
}