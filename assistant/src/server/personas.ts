/** Demo personas — practice network + copy for sign-in / portfolio storytelling. */
export interface AccountPersona {
  role: string;
  blurb: string;
}

export const PERSONA_BY_OWNER: Record<string, AccountPersona> = {
  anthony: {
    role: 'Director of Finance (AP)',
    blurb: 'Spend analytics demo — declined $12k vendor prepay (new-account rule). Ask about cashflow.',
  },
  sam: {
    role: 'Engineering manager',
    blurb: 'Team reimbursements & velocity — declined $1,500 concert (5 transfers / 60s).',
  },
  jordan: {
    role: 'Treasury / vendor payouts',
    blurb: 'Utilities, rent, and corporate reimbursements in; creditor balance profile.',
  },
};

export function personaForOwner(ownerId: string): AccountPersona {
  const key = ownerId.split('-')[0]?.toLowerCase() ?? ownerId;
  return PERSONA_BY_OWNER[key] ?? {
    role: 'Wallet',
    blurb: 'Standard USER account on ledger-service.',
  };
}

export const LEDGER_CAPABILITIES = [
  'append-only double-entry',
  'idempotent writes (Idempotency-Key)',
  'row-level balance locking',
  'fraud rules (velocity, limits, new-account)',
  'transactional outbox → SQS/Kafka',
] as const;
