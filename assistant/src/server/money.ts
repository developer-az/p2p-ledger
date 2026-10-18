/** Formats integer minor units (cents) as a currency string. All arithmetic stays in integers. */
export function formatMoney(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

/** Max UI entry: $999,000.00 (ledger single-tx rules may still decline below this). */
export const MAX_DOLLARS_UI = 999_000;
export const MAX_MINOR_UI = MAX_DOLLARS_UI * 100;

export function parseDollarsToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DOLLARS_UI) return null;
  return Math.round(n * 100);
}

/**
 * Splits a total into `parts` shares that always add back to the total.
 * The leftover cents go to the first shares, one each, so no money is created or lost.
 */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) throw new Error('total must be a non-negative integer');
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be at least 1');
  const base = Math.floor(totalMinor / parts);
  const extra = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
