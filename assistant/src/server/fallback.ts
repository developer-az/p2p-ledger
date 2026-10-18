import type { AssistantReply } from './agent.js';
import type { LedgerReader } from './ledger.js';
import type { SpendLogStore } from './spend-log.js';
import { InMemorySpendLogStore } from './spend-log.js';
import type { ToolCallRecord } from './providers/types.js';
import { executeTool, type ToolContext } from './tools.js';

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
  if (/\b(send|transfer|pay)\b/.test(q) && (/\$\s?\d/.test(q) || /\b\d+(\.\d{1,2})?\b/.test(q))) {
    return finish("I can't send money from chat. Use CMD: pay sam 10 lunch (or :pay sam 10 lunch).");
  }
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

function moneyMinor(display: string): number {
  const n = Number(display.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
