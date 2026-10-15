/** Formats integer minor units (cents) as a currency string. All arithmetic stays in integers. */
export function formatMoney(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

export function parseDollarsToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}
