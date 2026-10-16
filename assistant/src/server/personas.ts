/** Demo personas — practice network + copy for sign-in / portfolio storytelling. */
export interface AccountPersona {
  role: string;
  blurb: string;
}

export const PERSONA_BY_OWNER: Record<string, AccountPersona> = {
  alex: {
    role: 'Primary spender',
    blurb: 'High activity, declined $1,200 rent (new-account fraud rule).',
  },
  sam: {
    role: 'Roommate · splitter',
    blurb: 'Receives pizza/Uber splits; sends concert money back.',
  },
  jordan: {
    role: 'Landlord / creditor',
    blurb: 'Rent and groceries in; low cash balance, high inflow history.',
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
