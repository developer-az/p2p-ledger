import { useEffect, useState } from 'react';
import { api, type PaymentTrail } from '../api.js';
import { categoryLabel } from './categories.js';
import { declineCopy } from './copy.js';
import { displayName, dateTimeLabel, money, shortId } from './format.js';
import { isLedgerItem, type FeedItem } from './feed.js';
import { Sheet, Skeleton, useToast } from './ui.js';

/** Everything about one payment, including the two ledger lines that prove it. */
export function ActivitySheet({
  item,
  accountId,
  onClose,
  onChanged,
}: {
  item: FeedItem | null;
  accountId: string;
  onClose: () => void;
  onChanged?: () => Promise<void>;
}) {
  const toast = useToast();
  const [trail, setTrail] = useState<PaymentTrail | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setTrail(null);
    setTrailError(null);
    setShowProof(false);
  }, [item?.id]);

  useEffect(() => {
    if (!item?.transferId || !showProof || trail) return;
    let cancelled = false;
    api.trail(accountId, item.transferId)
      .then((t) => { if (!cancelled) setTrail(t); })
      .catch((e: Error) => { if (!cancelled) setTrailError(e.message); });
    return () => { cancelled = true; };
  }, [item?.transferId, showProof, trail, accountId]);

  const ledger = item ? isLedgerItem(item) : false;
  const declined = item?.kind === 'declined';
  const copy = declined ? declineCopy(item?.declineReason, item?.declineExplanation) : null;
  const sign = item && item.signedMinor > 0 ? '+' : item && item.signedMinor < 0 ? '−' : '';

  async function removeLog() {
    if (!item?.spendId) return;
    setRemoving(true);
    try {
      await api.deleteSpend(accountId, item.spendId);
      await onChanged?.();
      toast('Log removed', { tone: 'good' });
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Sheet open={item !== null} title={item?.title ?? ''} onClose={onClose}>
      {item ? (
        <div className="stack">
          <div>
            <p className="num" style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.1, textDecoration: declined ? 'line-through' : undefined }}>
              {sign}{money(Math.abs(item.signedMinor))}
            </p>
            <p style={{ marginTop: 6 }}>
              {declined ? <span className="pill pill-bad">Declined, no money moved</span>
                : ledger ? <span className="pill pill-good">Completed</span>
                : <span className="pill">Logged by you</span>}
            </p>
          </div>

          <dl className="kv">
            <dt>When</dt><dd>{dateTimeLabel(item.occurredAt)}</dd>
            {item.counterparty ? (<><dt>{item.kind === 'received' ? 'From' : 'With'}</dt><dd>{displayName(item.counterparty)}</dd></>) : null}
            {item.memo ? (<><dt>Note</dt><dd>{item.memo}</dd></>) : null}
            {item.category ? (<><dt>Category</dt><dd>{categoryLabel(item.category)}</dd></>) : null}
          </dl>

          {copy ? (
            <div className="notice notice-bad stack-sm">
              <p><strong>{copy.title}.</strong></p>
              <p>{copy.why}</p>
              <p><strong>What you can do:</strong> {copy.next}</p>
            </div>
          ) : null}

          {!ledger ? (
            <div className="stack-sm">
              <p className="muted">
                You added this yourself. It is kept separate from the ledger, so it never changes your wallet balance.
              </p>
              {item.spendId ? (
                <button type="button" className="btn btn-sm btn-danger" style={{ justifySelf: 'start' }} onClick={() => void removeLog()} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove this log'}
                </button>
              ) : null}
            </div>
          ) : (
            <details open={showProof} onToggle={(e) => setShowProof((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>Show the proof</summary>
              <div className="stack-sm" style={{ marginTop: 12 }}>
                {trailError ? <p className="error-text" role="alert">{trailError}</p> : null}
                {!trail && !trailError ? <Skeleton height={90} /> : null}
                {trail ? <Proof trail={trail} /> : null}
              </div>
            </details>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function Proof({ trail }: { trail: PaymentTrail }) {
  return (
    <>
      {trail.legs.length === 0 ? (
        <p className="muted">
          A declined payment writes no ledger lines, because no money moved. The decline itself is stored, so asking again gives the same answer.
        </p>
      ) : (
        <>
          <p className="muted">
            Every payment is stored as two lines that cancel out: one takes money from a wallet, one gives the same amount to another.
          </p>
          <table className="legs">
            <thead>
              <tr><th>Wallet</th><th>Line</th><th className="r">Amount</th><th className="r">Balance after</th></tr>
            </thead>
            <tbody>
              {trail.legs.map((l) => (
                <tr key={l.entryId}>
                  <td>{displayName(l.account)}</td>
                  <td>{l.side === 'debit' ? 'Takes' : 'Gives'}</td>
                  <td className="r">{l.side === 'debit' ? '−' : '+'}{l.amount}</td>
                  <td className="r">{l.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Lines add up to</td><td className="r">{trail.legsSum}</td><td /></tr>
            </tfoot>
          </table>
          <p className="notice notice-good" style={{ fontSize: '0.92rem' }}>
            The lines add up to {trail.legsSum}. If they ever did not, the database would refuse to save the payment.
          </p>
        </>
      )}
      <dl className="kv">
        <dt>Request id</dt><dd><code>{shortId(trail.request.idempotencyKey)}</code></dd>
        <dt>Why it matters</dt><dd>Sending the same request id again returns this result instead of paying twice.</dd>
      </dl>
    </>
  );
}
