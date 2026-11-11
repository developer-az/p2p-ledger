import { createApp } from './app.js';
import { createDataKeyStore } from './envelope.js';
import { HttpLedgerClient } from './ledger.js';
import { createImportStore } from './imports-store.js';
import { CompositeLedger, isLiveLedgerReachable, PracticeLedger } from './practice-ledger.js';
import { createSpendLogStore } from './spend-log.js';
import { createPersonalFinanceStore } from './personal-finance.js';
import { createPaymentRequestStore } from './payment-requests.js';
import { createAuthStore } from './auth.js';
import { createRateLimitStore } from './rate-limit-store.js';
import { JavaWorkflows, RoutedSpendLogStore } from './java-workflows.js';

let spendLogs = createSpendLogStore();
let personalFinance = createPersonalFinanceStore();
let paymentRequests = createPaymentRequestStore();

/** Shared API app for Node server, Vercel, and Vite dev middleware. */
export function createAssistantApi() {
  const ledgerUrl = process.env.LEDGER_URL?.trim() || 'http://localhost:8080';
  const timeoutMs = process.env.VERCEL === '1' ? 8_000 : 20_000;
  const liveLedger = new HttpLedgerClient(ledgerUrl, timeoutMs);
  const practice = new PracticeLedger();
  const isLiveLedgerUp = () => isLiveLedgerReachable(ledgerUrl);
  const ledger = new CompositeLedger(liveLedger, practice, isLiveLedgerUp);
  const javaWorkflows = new JavaWorkflows(ledgerUrl, process.env.LEDGER_API_KEY ?? '', timeoutMs);
  const dataKeys = createDataKeyStore();
  const imports = createImportStore(process.env, dataKeys);
  spendLogs = new RoutedSpendLogStore(createSpendLogStore(dataKeys), javaWorkflows, id => ledger.isPracticeAccount(id));
  personalFinance = createPersonalFinanceStore(process.env, dataKeys);
  paymentRequests = createPaymentRequestStore();
  return createApp({
    ledger,
    practice,
    liveLedger,
    isLiveLedgerUp,
    spendLogs,
    personalFinance,
    imports,
    paymentRequests,
    javaWorkflows,
    dataKeys,
    auth: createAuthStore(),
    rateLimitStore: createRateLimitStore(),
  });
}
