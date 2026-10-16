/** One-screen “research poster” for hiring managers — no click-through. */
export function CorporateBrief({ live }: { live: boolean }) {
  return (
    <section className="pane corp-brief" aria-label="Platform overview">
      <div className="pane-hd">
        <strong>corporate treasury platform</strong> · ledger-service on PostgreSQL
      </div>
      <div className="pane-bd">
        <p className="corp-headline">
          Built for real money at volume — not a UI that pretends to hold balances.
        </p>
        <p className="corp-lede">
          Every dollar you see below is backed by double-entry rows in Postgres, enforced by triggers, idempotent HTTP
          writes, and fraud rules. That is how you ship payroll, vendor payouts, and consumer P2P without “do not refresh
          or you may be charged twice” warnings.
        </p>
        <dl className="corp-metrics">
          <div><dt>load tested</dt><dd>1,000 req/s</dd><span className="corp-note">native JVM · p99 &lt; 520 ms at peak</span></div>
          <div><dt>idempotency</dt><dd>5 → 1</dd><span className="corp-note">parallel retries · one settlement</span></div>
          <div><dt>reconciliation</dt><dd>$0 drift</dd><span className="corp-note">entries sum to zero · live integrity API</span></div>
          <div><dt>deployment</dt><dd>Render + Vercel</dd><span className="corp-note">Java ledger · React ops console</span></div>
        </dl>
        <p className="dim corp-foot">
          {live
            ? 'PostgreSQL is online — seed the demo household or open a corporate wallet below.'
            : 'Waiting for the live ledger to wake on Render — refresh in a few seconds.'}
        </p>
      </div>
    </section>
  );
}
