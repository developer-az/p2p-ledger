/** Plain-language versions of the ledger's decline codes, with something the person can do next. */
export interface DeclineCopy {
  title: string;
  why: string;
  next: string;
}

const COPY: Record<string, DeclineCopy> = {
  INSUFFICIENT_FUNDS: {
    title: 'Not enough in the wallet',
    why: 'The wallet did not have enough balance to cover this payment, so nothing was taken.',
    next: 'Add money, then try again.',
  },
  AMOUNT_OVER_SINGLE_LIMIT: {
    title: 'Over the single-payment limit',
    why: 'One payment can be at most $10,000.00. The limit exists so a mistake or a stolen wallet cannot move everything at once.',
    next: 'Send it as smaller payments.',
  },
  NEW_ACCOUNT_LARGE_TRANSFER: {
    title: 'New wallets have a lower limit',
    why: 'Wallets less than 24 hours old can send at most $1,000.00 in one payment. Fraud usually shows up on brand-new accounts.',
    next: 'Send a smaller amount now, or try again tomorrow.',
  },
  VELOCITY_LIMIT: {
    title: 'Too many payments too quickly',
    why: 'A wallet can send at most 5 payments in any 60 seconds. Rapid bursts are a common sign of automated abuse.',
    next: 'Wait a minute and try again.',
  },
  DAILY_OUTFLOW_LIMIT: {
    title: 'Daily sending limit reached',
    why: 'A wallet can send at most $25,000.00 in 24 hours.',
    next: 'Try again tomorrow, or send less.',
  },
};

export function declineCopy(code: string | null | undefined, fallbackWhy?: string | null): DeclineCopy {
  const known = code ? COPY[code] : undefined;
  if (known) return known;
  return {
    title: 'This payment was declined',
    why: fallbackWhy ?? 'The ledger declined this payment. No money moved.',
    next: 'Check the amount and try again.',
  };
}
