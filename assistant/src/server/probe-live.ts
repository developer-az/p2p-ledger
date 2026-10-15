/** Quick Render/Java ledger health probe for serverless bootstrap (hard timeout). */
export async function probeLiveLedger(timeoutMs = 1_500): Promise<boolean> {
  const base = process.env.LEDGER_URL?.replace(/\/$/, '');
  if (!base) return false;
  // On Vercel, unset or localhost LEDGER_URL cannot reach your machine — skip slow probes.
  if (process.env.VERCEL === '1' && /localhost|127\.0\.0\.1/i.test(base)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/actuator/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
