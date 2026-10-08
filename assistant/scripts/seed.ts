import { seedDemo } from '../src/server/demo.js';
import { HttpLedgerClient } from '../src/server/ledger.js';

// Creates demo accounts and transfers in the ledger at LEDGER_URL and prints their ids.
const ledger = new HttpLedgerClient(process.env.LEDGER_URL ?? 'http://localhost:8080');
console.table((await seedDemo(ledger)).accounts);
