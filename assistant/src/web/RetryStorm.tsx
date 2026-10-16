import { useState } from 'react';
import { api, type AccountRef, type RaceResult } from './api.js';
import { useTrace } from './activity-log.js';

function displayName(owner: string): string {
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function RetryStorm({
  accountId,
  peers,
  onDone,
}: {
  accountId: string;
  peers: AccountRef[];
  onDone?: () => void;
}) {
  const trace = useTrace();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<RaceResult | null>(null);
  const from = peers[0];
  if (!from) return null;

  async function run() {
    if (!from) return;
    setBusy(true);
    setErr('');
    setResult(null);
    trace('POST /api/race · 5 parallel POST /v1/transfers · same Idempotency-Key');
    try {
      const r = await api.race(accountId, from.id);
      setResult(r);
      trace(`race · distinctTransfers=${r.distinctTransfers} · admitted=1 · deduplicated=${r.copies - 1}`);
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
      trace(`race error · ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const ok = result?.distinctTransfers === 1;

  return (
    <section className="pane retry-pane">
      <div className="pane-hd"><strong>retry storm</strong> · idempotency under bad connectivity</div>
      <div className="pane-bd">
        <p className="story-blurb">
          Your phone fires the same {result?.amount ?? '$5.00'} payment from {displayName(from.owner)} five times while
          the tab spins. A fragile checkout warns you not to refresh — this ledger admits <strong>one</strong> write and
          returns the stored result for the rest, so millions of retries cannot multiply charges.
        </p>
        <button type="button" className="t-btn-inline" disabled={busy} onClick={() => void run()}>
          {busy ? '[ 5 requests in flight… ]' : '[ simulate retry storm ]'}
        </button>
        {err && <p className="err" role="alert">{err}</p>}
        {result && (
          <div className={`verdict ${ok ? 'ok' : 'bad'}`} role="status">
            {ok
              ? `✓ One transfer posted (${result.transferId?.slice(0, 8)}…). Four duplicates deduplicated — safe to close the tab.`
              : `✗ ${result.distinctTransfers} distinct transfers — idempotency broken`}
          </div>
        )}
        {result && (
          <table className="stmt" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>#</th><th>outcome</th><th>transfer</th><th>status</th><th className="num">ms</th></tr>
            </thead>
            <tbody>
              {result.attempts.map((a) => (
                <tr key={a.copy} className={a.outcome === 'admitted' ? 'row-admitted' : ''}>
                  <td>{a.copy}</td>
                  <td>{a.outcome}</td>
                  <td className="mono-id">{a.transferId.slice(0, 8)}…</td>
                  <td>{a.status}</td>
                  <td className="num">{a.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
