/** Practice network metadata — works without /api/bootstrap (Vercel cold start / outages). */
import type { BootstrapResponse } from './api.js';

export const PRACTICE_ALEX_ID = '01111111-1111-7111-8111-111111111101';
export const PRACTICE_SAM_ID = '01111111-1111-7111-8111-111111111102';
export const PRACTICE_JORDAN_ID = '01111111-1111-7111-8111-111111111103';
export const PRACTICE_RENT_TRANSFER_ID = '01111111-1111-7111-8111-111111111201';

export const OFFLINE_BOOTSTRAP: BootstrapResponse = {
  live: false,
  practice: {
    mode: 'practice',
    accounts: [
      { id: PRACTICE_ALEX_ID, owner: 'alex' },
      { id: PRACTICE_SAM_ID, owner: 'sam' },
      { id: PRACTICE_JORDAN_ID, owner: 'jordan' },
    ],
    focusAccountId: PRACTICE_ALEX_ID,
    stoppedTransferId: PRACTICE_RENT_TRANSFER_ID,
    hint: 'Practice network — send, deposit, and query like production.',
  },
};
