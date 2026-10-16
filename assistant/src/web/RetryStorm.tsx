import { useState } from 'react';
import { api, type AccountRef, type RaceResult } from './api.js';

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
    try {
      const r = await api.race(accountId, from.id);
      setResult(r);
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pane retry-pane">
      <div className="pane-hd"><strong>retry storm</strong> · idempotency under load</div>
      <div className="pane-bd">
        <p className="story-blurb">
          Five identical $5.00 transfers from {displayName(from.owner)} hit the API at once — same key, one outcome.
        </p>
        <button type="button" className="t-btn-inline" disabled={busy} onClick={() => void run()}>
          {busy ? '[ firing 5×… ]' : '[ run retry storm ]'}
        </button>
        {err && <p className="err" role="alert">{err}</p>}
        {result && (
          <table className="stmt" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>#</th><th>transfer</th><th>status</th><th className="num">ms</th></tr>
            </thead>
            <tbody>
              {result.attempts.map((a, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="mono-id">{a.transferId.slice(0, 8)}…</td>
                  <td>{a.status}</td>
                  <td className="num">{a.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result && (
          <p className="dim" style={{ marginTop: 10, fontSize: 11 }}>
            {result.copies} requests → <strong style={{ color: 'var(--action)' }}>{result.distinctTransfers}</strong> payment
            {result.distinctTransfers === 1 ? ' (idempotent)' : 's — unexpected'} · wall {result.wallMs} ms
          </p>
        )}
      </div>
    </section>
  );
}
