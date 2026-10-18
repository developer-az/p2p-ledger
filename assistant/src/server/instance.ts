import { createApp } from './app.js';
import { HttpLedgerClient } from './ledger.js';
import { CompositeLedger, isLiveLedgerReachable, PracticeLedger } from './practice-ledger.js';
import { createSpendLogStore } from './spend-log.js';
import { createPersonalFinanceStore } from './personal-finance.js';

let spendLogs = createSpendLogStore();
let personalFinance = createPersonalFinanceStore();

/** Shared API app for Node server, Vercel, and Vite dev middleware. */
export function createAssistantApi() {
  const ledgerUrl = process.env.LEDGER_URL ?? 'http://localhost:8080';
  const timeoutMs = process.env.VERCEL === '1' ? 8_000 : 20_000;
  const liveLedger = new HttpLedgerClient(ledgerUrl, timeoutMs);
  const practice = new PracticeLedger();
  const isLiveLedgerUp = () => isLiveLedgerReachable(ledgerUrl);
  const ledger = new CompositeLedger(liveLedger, practice, isLiveLedgerUp);
  spendLogs = createSpendLogStore();
  personalFinance = createPersonalFinanceStore();
  return createApp({
    ledger,
    practice,
    liveLedger,
    isLiveLedgerUp,
    spendLogs,
    personalFinance,
  });
}
