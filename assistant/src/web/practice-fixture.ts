/** Practice network metadata — works without /api/bootstrap (Vercel cold start / outages). */
import { PERSONA_BY_OWNER } from '../server/personas.js';
import type { BootstrapResponse } from './api.js';

export const PRACTICE_ANTHONY_ID = '01111111-1111-7111-8111-111111111101';
export const PRACTICE_SAM_ID = '01111111-1111-7111-8111-111111111102';
export const PRACTICE_JORDAN_ID = '01111111-1111-7111-8111-111111111103';
export const PRACTICE_RENT_TRANSFER_ID = '01111111-1111-7111-8111-111111111201';

function practiceAccount(id: string, owner: string) {
  const p = PERSONA_BY_OWNER[owner] ?? { role: 'Wallet', blurb: '' };
  return { id, owner, role: p.role, blurb: p.blurb };
}

export const OFFLINE_BOOTSTRAP: BootstrapResponse = {
  live: false,
  ledger: {
    engine: 'ledger-service',
    apiVersion: 'v1',
    capabilities: [
      'append-only double-entry',
      'idempotent writes (Idempotency-Key)',
      'row-level balance locking',
      'fraud rules (velocity, limits, new-account)',
      'transactional outbox → SQS/Kafka',
    ],
  },
  practice: {
    mode: 'practice',
    accounts: [
      practiceAccount(PRACTICE_ANTHONY_ID, 'anthony'),
      practiceAccount(PRACTICE_SAM_ID, 'sam'),
      practiceAccount(PRACTICE_JORDAN_ID, 'jordan'),
    ],
    focusAccountId: PRACTICE_ANTHONY_ID,
    stoppedTransferId: PRACTICE_RENT_TRANSFER_ID,
    hint: 'Practice network — same fraud story as live seed; statement tab shows double-entry lines.',
  },
};
