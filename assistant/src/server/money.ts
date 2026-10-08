/** Formats integer minor units (cents) as a currency string. All arithmetic stays in integers. */
export function formatMoney(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}
