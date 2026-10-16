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

/** Plain-language summary for the terminal audit panel. */
export function integrityPlainEnglish(integrity: Integrity): string[] {
  const balanced = integrity.balanced
    ? 'Every payment in the database still adds up — nothing was “lost” in the math.'
    : 'Something does not add up — an engineer would investigate before trusting balances.';
  const drift = integrity.accountsDrifted === 0
    ? 'Every wallet balance matches its transaction history (no drift).'
    : `${integrity.accountsDrifted} wallet(s) disagree with their history — that should be zero in production.`;
  const sum = integrity.entriesSum === '$0.00' || integrity.entriesSum === '0.00 USD'
    ? 'Company-wide, money in equals money out (double-entry bookkeeping).'
    : `Entry totals should net to zero company-wide; saw ${integrity.entriesSum}.`;
  return [
    balanced,
    drift,
    sum,
    `${integrity.entryCount} ledger lines recorded across all accounts (append-only — no deletes).`,
    `Background event queue: ${formatOutboxP95(integrity.outbox.p95DeliveryMs)}.`,
  ];
}

export function downloadStatementTxt(accountId: string): void {
  const a = document.createElement('a');
  a.href = `/api/accounts/${encodeURIComponent(accountId)}/statement.txt`;
  a.download = `statement-${accountId.slice(0, 8)}.txt`;
  a.rel = 'noopener';
  a.click();
}

/** Opens the system print dialog (user can choose “Save as PDF”). Avoids pop-up blockers. */
export async function printStatement(accountId: string): Promise<void> {
  const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/statement.txt`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Statement ${res.status}`);
  const text = await res.text();

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error('Print not available in this browser');
  }

  const safe = escapeHtml(text);
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ledger statement</title>
<style>
  body { font: 12px/1.45 ui-monospace, monospace; margin: 16px; color: #111; background: #fff; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
  @media print { body { margin: 0.5in; } }
</style></head><body><pre>${safe}</pre></body></html>`);
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };

  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
