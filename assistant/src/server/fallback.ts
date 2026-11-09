import type { AssistantReply } from './agent.js';
import type { LedgerReader } from './ledger.js';
import type { SpendLogStore } from './spend-log.js';
import { InMemorySpendLogStore } from './spend-log.js';
import type { ToolCallRecord } from './providers/types.js';
import { executeTool, type ToolContext, type WeeklyFinance } from './tools.js';

/**
 * Answers from the ledger tools when the model is out of quota. Amounts are copied
 * from tool results. This is the same read-only boundary the evals grade.
 */
export async function answerFromLedger(opts: {
  ledger: LedgerReader;
  spendLogs?: SpendLogStore;
  accountId: string;
  question: string;
  now?: () => Date;
  /** Profile cash and pace. Without it, cash is unknown — the P2P balance is not the user's cash. */
  finance?: () => Promise<WeeklyFinance>;
}): Promise<AssistantReply> {
  const ctx: ToolContext = {
    ledger: opts.ledger,
    spendLogs: opts.spendLogs ?? new InMemorySpendLogStore(),
    accountId: opts.accountId,
    now: opts.now ?? (() => new Date()),
  };
  const calls: ToolCallRecord[] = [];
  const call = async (tool: string, args: unknown) => {
    const start = performance.now();
    const result = await executeTool(ctx, tool, args);
    calls.push({ tool, args, result, ms: Math.round(performance.now() - start) });
    return result as Record<string, unknown>;
  };
  const finish = (answer: string): AssistantReply => ({
    answer, toolCalls: calls, provider: 'ledger', model: 'statement',
  });

  const q = opts.question.toLowerCase();
  /* An afford question can contain "pay" ("afford to pay $60") and "paycheck"
     ("afford $60 after my paycheck"), so it is answered before the income totals. */
  const isAfford = /\bafford\b|can i (spend|buy|go)|is it ok to spend|do i have enough/.test(q);
  const hasAmount = /\$\s?\d/.test(q) || /\b\d+(\.\d{1,2})?\b/.test(q);
  /* A request to move money is refused however it is phrased: "Pay Jordan $20 so
     he can afford lunch", "I need you to pay Jordan $20", "can you send sam $60".
     Rather than listing phrasings, look at each send/transfer/pay verb and ignore
     only the two uses that are not a transfer:
       - "afford to pay $60" asks whether the money is there;
       - "send me / send us" asks for information ("send me a breakdown").
     Any other transfer verb plus an amount is a request to move money. */
  const isTransferCommand = hasAmount && [...q.matchAll(/\b(send|transfer|pay)\b/g)].some((match) => {
    const at = match.index ?? 0;
    const before = q.slice(0, at);
    const after = q.slice(at + match[0].length);
    if (/afford to\s+$/.test(before)) return false;
    if (/^\s+(me|us)\b/.test(after)) return false;
    return true;
  });
  const refuseTransfer = (): AssistantReply =>
    finish("I can't send money from chat. Use CMD: pay sam 10 lunch (or :pay sam 10 lunch).");

  /** Afford questions are questions, not commands: answer them before the refusal. */
  const answerAfford = async (): Promise<AssistantReply> => {
    const overview = await call('get_account_overview', {});
    const story = await call('weekly_spending_story', {});
    const balance = String(overview.balance);
    const finance = opts.finance ? await opts.finance() : null;
    // null means the user has not entered cash; the P2P balance settles with friends, it is not cash.
    const spendableMinor = finance?.spendableMinor ?? null;
    const thisWeek = String(story.totalThisWeek);
    const lastWeek = String(story.totalLastWeek);
    const asked = amountIn(q);
    if (spendableMinor === null) {
      const target = asked === undefined ? 'that' : money(Math.round(asked * 100));
      const pace = paceLine(finance?.budgetMinor ?? null, finance?.spentMinor ?? 0);
      return finish(
        `You haven't entered your cash yet, so I can't tell if ${target} fits. ` +
        (pace ? `${pace} ` : '') +
        `Your friend-payments balance is ${balance}, but that isn't your spending cash. ` +
        'Add your cash in Edit money snapshot to get a real answer.',
      );
    }
    const spendable = money(spendableMinor);
    if (asked === undefined) {
      return finish(`Your spendable cash is ${spendable}. This week you've logged ${thisWeek} (last week ${lastWeek}).`);
    }
    const amountMinor = Math.round(asked * 100);
    const amount = money(amountMinor);
    if (amountMinor > spendableMinor) {
      return finish(
        `Your spendable cash is ${spendable}, less than ${amount}. ` +
        `This week you've logged ${thisWeek} (last week ${lastWeek}).`,
      );
    }
    const budgetMinor = finance?.budgetMinor ?? null;
    if (budgetMinor === null) {
      return finish(
        `You haven't set a weekly pace, so I can only check your spendable cash: ${spendable} covers ${amount}. ` +
        `This week you've logged ${thisWeek} (last week ${lastWeek}).`,
      );
    }
    const spentMinor = finance?.spentMinor ?? 0;
    const remainingMinor = budgetMinor - spentMinor;
    const budget = money(budgetMinor);
    const remaining = money(Math.max(0, remainingMinor));
    if (amountMinor > remainingMinor) {
      if (remainingMinor <= 0) {
        return finish(
          `You're already over your weekly pace by ${money(-remainingMinor)}: you have ${money(0)} left of ` +
          `${budget} this week (spendable cash ${spendable}).`,
        );
      }
      return finish(
        `That would put you over your weekly pace: you have ${remaining} left of ${budget} this week ` +
        `(spendable cash ${spendable}).`,
      );
    }
    return finish(
      `Yes, ${amount} fits: you have ${remaining} left of your ${budget} weekly pace, and your spendable cash is ${spendable}.`,
    );
  };

  if (isTransferCommand) return refuseTransfer();
  if (isAfford) return answerAfford();
  if (/credit score|social security|password/.test(q)) {
    return finish("I don't have access to that. I can only read this account's payments.");
  }

  if (/declin|rejected|why was/.test(q)) {
    const listed = await call('list_transfers', { status: 'REJECTED', limit: 20 });
    const transfers = asTransfers(listed.transfers);
    const hit = transfers.find((t) => memoMatches(q, t.memo)) ?? transfers[0];
    if (!hit) return finish("I don't see a declined payment on this account.");
    const explained = hit.declineReason
      ? await call('explain_decline_reason', { reasonCode: hit.declineReason })
      : null;
    const why = typeof explained?.explanation === 'string' ? explained.explanation : 'It was declined.';
    const what = safeMemo(hit.memo) ?? 'That payment';
    return finish(`${what} for ${hit.amount} was declined. ${why}`);
  }

  if (/who has paid|paid me/.test(q)) {
    const overview = await call('get_account_overview', {});
    const listed = await call('list_transfers', { limit: 20 });
    const received = asTransfers(listed.transfers).filter((t) => t.direction === 'received' && t.status === 'COMPLETED');
    const who = received.slice(0, 3).map((t) => `${t.counterparty} paid ${t.amount}`).join(', ');
    const balance = typeof overview.balance === 'string' ? overview.balance : '';
    return finish(who
      ? `Your balance is ${balance}. Recently, ${who}.`
      : `Your balance is ${balance}. I don't see a recent payment from someone else.`);
  }

  if (/income|money in|earned|paycheck|inflow|how much.*(made|brought)|deposited/.test(q)) {
    const days = /month/.test(q) ? 30 : daysIn(q);
    const sum = await call('summarize_activity', { days });
    const dep = String(sum.totalDeposited);
    const recv = String(sum.totalReceived);
    const sent = String(sum.totalSent);
    return finish(
      `In the last ${String(sum.windowDays)} days you received ${dep} in deposits and ${recv} from people (${sent} sent out).`,
    );
  }

  if (/habit|logged|my spend|spending this week|category|groceries|dining/.test(q) && !/sent to|peer|pay sam/.test(q)) {
    if (/week|this week|last week/.test(q)) {
      const story = await call('weekly_spending_story', {});
      return finish(
        `This week you logged ${String(story.totalThisWeek)} (${String(story.weekOverWeek)}). Last week was ${String(story.totalLastWeek)}.`,
      );
    }
    const days = /month/.test(q) ? 30 : daysIn(q);
    const sum = await call('summarize_spending', { days });
    const top = asCategoryRows(sum.byCategory).slice(0, 3).map((r) => `${r.category} ${r.total}`).join(', ');
    return finish(top
      ? `In the last ${String(sum.windowDays)} days you logged ${String(sum.totalSpent)}. Top: ${top}.`
      : `In the last ${String(sum.windowDays)} days you logged ${String(sum.totalSpent)}.`);
  }

  if (/given out|give out|how much have i (given|sent|paid)|total.*sent|spent the most|spend.*money|better spend|what should i do/.test(q)) {
    const days = /month/.test(q) ? 30 : daysIn(q);
    const sum = await call('summarize_activity', { days });
    const rows = asRows(sum.byCounterparty).filter((r) => r.sent !== '$0.00');
    const top = rows.sort((a, b) => moneyMinor(b.sent) - moneyMinor(a.sent))[0];
    const lines = rows.slice(0, 4).map((r) => `${r.counterparty} ${r.sent}`);
    const advice = top
      ? `Largest outflow to ${top.counterparty} (${top.sent}). In a real treasury run you'd set per-vendor limits and review memos weekly — here, try PEERS + ACTIVITY to inspect each line.`
      : 'No outbound P2P in this window — deposits and inbound corridors dominate.';
    return finish(
      `You sent ${String(sum.totalSent)} in the last ${String(sum.windowDays)} days. ${lines.length ? `By counterparty: ${lines.join(', ')}. ` : ''}${advice}`,
    );
  }

  if (/each person|sent to [a-z]|total amount|how much .*sent|\bi sent\b/.test(q)) {
    const days = /month/.test(q) ? 30 : daysIn(q);
    const sum = await call('summarize_activity', { days });
    const rows = asRows(sum.byCounterparty);
    const name = /sent to ([a-z]+)/.exec(q)?.[1];
    const row = name ? rows.find((r) => r.counterparty.toLowerCase() === name) : undefined;
    if (row) return finish(`You sent ${row.sent} to ${row.counterparty} in the last ${String(sum.windowDays)} days.`);
    if (/each person/.test(q)) {
      const lines = rows.filter((r) => r.sent !== '$0.00').map((r) => `${r.counterparty} ${r.sent}`);
      return finish(`In the last ${String(sum.windowDays)} days you sent ${String(sum.totalSent)}. ${lines.join(', ')}.`);
    }
    return finish(`You sent ${String(sum.totalSent)} in the last ${String(sum.windowDays)} days.`);
  }

  if (/list|most recent/.test(q)) {
    const limit = numberIn(q) ?? 3;
    const listed = await call('list_transfers', { limit });
    const lines = asTransfers(listed.transfers).map((t) => {
      const memo = safeMemo(t.memo);
      return `${memo ? `${memo} ` : ''}${t.amount} (${t.status === 'REJECTED' ? 'declined' : t.direction})`;
    });
    return finish(lines.join('. ') + (lines.length ? '.' : "I don't see any payments."));
  }

  if (/balance/.test(q)) {
    const overview = await call('get_account_overview', {});
    return finish(`Your balance is ${String(overview.balance)}.`);
  }

  const days = 30;
  const sum = await call('summarize_activity', { days });
  const overview = await call('get_account_overview', {});
  return finish(
    `Balance ${String(overview.balance)}. Last ${days}d: ${String(sum.totalDeposited)} deposited, ` +
    `${String(sum.totalReceived)} received, ${String(sum.totalSent)} sent. ` +
    `Ask about income, spending, declines, or a specific payment.`,
  );
}

function daysIn(q: string): number {
  const n = /(\d+)\s*days/.exec(q);
  return n ? Number(n[1]) : 30;
}

function numberIn(q: string): number | undefined {
  const n = /\b(\d+)\b/.exec(q);
  return n ? Number(n[1]) : undefined;
}

/** First dollar amount in the question, else the first bare number, as a plain dollar figure. */
function amountIn(q: string): number | undefined {
  // "$5,000" and "1,200" read as one number, not as 5 or 1.
  const s = q.replace(/(\d),(?=\d{3})/g, '$1');
  const dollars = /\$\s?(\d+(?:\.\d{1,2})?)/.exec(s);
  if (dollars) return Number(dollars[1]);
  const bare = /\b(\d+(?:\.\d{1,2})?)\b/.exec(s);
  return bare ? Number(bare[1]) : undefined;
}

function memoMatches(question: string, memo: string | null): boolean {
  if (!memo) return false;
  const words = memo.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return words.some((w) => question.includes(w));
}

function safeMemo(memo: string | null): string | null {
  if (!memo || memo.length > 80 || /\$|ignore|instruction/i.test(memo)) return null;
  return memo;
}

interface Listed {
  direction: string;
  counterparty: string;
  amount: string;
  status: string;
  declineReason: string | null;
  memo: string | null;
}

function asTransfers(value: unknown): Listed[] {
  return Array.isArray(value) ? value as Listed[] : [];
}

function asRows(value: unknown): { counterparty: string; sent: string }[] {
  return Array.isArray(value) ? value as { counterparty: string; sent: string }[] : [];
}

function asCategoryRows(value: unknown): { category: string; total: string }[] {
  return Array.isArray(value) ? value as { category: string; total: string }[] : [];
}

function money(minor: number): string {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pace facts for answers where cash is unknown: what is left of the weekly pace, or how far over it is. */
function paceLine(budgetMinor: number | null, spentMinor: number): string | null {
  if (budgetMinor === null) return null;
  const remainingMinor = budgetMinor - spentMinor;
  const budget = money(budgetMinor);
  if (remainingMinor <= 0) {
    return `You're already over your weekly pace by ${money(-remainingMinor)}: ` +
      `you have ${money(0)} left of ${budget} this week.`;
  }
  return `You have ${money(remainingMinor)} left of your ${budget} weekly pace.`;
}

function moneyMinor(display: string): number {
  const n = Number(display.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
