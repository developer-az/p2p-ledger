import { createApp } from './app.js';
import { HttpLedgerClient } from './ledger.js';
import { CompositeLedger, isLiveLedgerReachable, PracticeLedger } from './practice-ledger.js';
/** Shared API app for Node server, Vercel, and Vite dev middleware. */
export function createAssistantApi() {
  const ledgerUrl = process.env.LEDGER_URL ?? 'http://localhost:8080';
  const liveLedger = new HttpLedgerClient(ledgerUrl);
  const practice = new PracticeLedger();
  const isLiveLedgerUp = () => isLiveLedgerReachable(ledgerUrl);
  const ledger = new CompositeLedger(liveLedger, practice, isLiveLedgerUp);
  return createApp({
    ledger,
    practice,
    liveLedger,
    isLiveLedgerUp,
  });
}
