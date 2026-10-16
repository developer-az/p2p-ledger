import type { Integrity } from './api.js';

/** Outbox p95 can spike when few events published — hide absurd values. */
export function formatOutboxP95(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms > 86_400_000) return '— (relay idle / sparse samples)';
  if (ms < 1000) return `${ms} ms p95`;
  return `${(ms / 1000).toFixed(1)} s p95`;
}

export function integrityLegend(integrity: Integrity): string[] {
  return [
    `BALANCED  ${integrity.balanced}  — every transfer’s entries net to zero`,
    `ENTRIES   ${integrity.entryCount}  — append-only ledger lines company-wide`,
    `SUM       ${integrity.entriesSum}  — must be $0.00 (double-entry)`,
    `DRIFT     ${integrity.accountsDrifted}  — wallets vs entry sums (want 0)`,
    `OUTBOX    ${formatOutboxP95(integrity.outbox.p95DeliveryMs)}  — event relay latency`,
  ];
}

export function downloadStatementTxt(accountId: string): void {
  const a = document.createElement('a');
  a.href = `/api/accounts/${encodeURIComponent(accountId)}/statement.txt`;
  a.download = `statement-${accountId.slice(0, 8)}.txt`;
  a.rel = 'noopener';
  a.click();
}

export async function printStatementPdf(accountId: string): Promise<void> {
  const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/statement.txt`);
  if (!res.ok) throw new Error(`Statement ${res.status}`);
  const text = await res.text();
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) throw new Error('Allow pop-ups to print PDF');
  win.document.title = 'Ledger statement';
  win.document.body.innerHTML = `<pre style="font:12px monospace;padding:1rem">${escapeHtml(text)}</pre>`;
  win.document.close();
  win.focus();
  win.print();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
