import { formatMoney } from './money.js';
import type { LedgerEntry } from './ledger.js';
import type { loadAccountView } from './tools.js';

export function formatLedgerStatement(
  view: NonNullable<Awaited<ReturnType<typeof loadAccountView>>>,
  entries: LedgerEntry[],
  meta: { generatedAt: string; engine: string },
): string {
  const lines: string[] = [
    'P2P LEDGER SERVICE — ACCOUNT STATEMENT',
    '═'.repeat(56),
    `Generated: ${meta.generatedAt}`,
    `Engine:    ${meta.engine}`,
    `Account:   ${view.id}`,
    `Owner:     ${view.owner}`,
    `Currency:  ${view.currency}`,
    `Opened:    ${view.openedAt}`,
    `Balance:   ${view.balance}`,
    '',
    '30-DAY SUMMARY',
    `  Inflow:     ${view.summary.inflow}`,
    `  Deposits:   ${view.summary.deposited}`,
    `  Received:   ${view.summary.received}`,
    `  Sent:       ${view.summary.sent}`,
    `  Declined:   ${view.summary.stopped} (${view.summary.declinedCount} tx)`,
    '',
    'LEDGER ENTRIES (append-only, double-entry)',
    '─'.repeat(56),
    'Date (UTC)              Transfer    Amount        Balance',
  ];
  for (const e of entries) {
    const dt = e.createdAt.replace('T', ' ').slice(0, 19);
    const tid = e.transferId.slice(0, 8);
    const amt = formatMoney(e.amountMinor, view.currency);
    const bal = formatMoney(e.balanceAfterMinor, view.currency);
    lines.push(`${dt.padEnd(22)} ${tid.padEnd(10)} ${amt.padStart(12)} ${bal.padStart(12)}`);
  }
  lines.push('', '— End of statement —');
  return lines.join('\n');
}
