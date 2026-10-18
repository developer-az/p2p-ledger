import { useState } from 'react';
import { api, type PaymentRequestView } from '../api.js';
import { declineCopy } from './copy.js';
import { displayName } from './format.js';
import { Avatar, useToast } from './ui.js';

/** Requests addressed to this wallet. Paying one is a single idempotent ledger transfer. */
export function IncomingRequests({
  requests,
  me,
  onChanged,
}: {
  requests: PaymentRequestView[];
  me: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Record<string, { title: string; why: string; next: string }>>({});

  async function pay(r: PaymentRequestView) {
    setBusy(r.id);
    try {
      const result = await api.payRequest(r.id, me);
      if (result.transfer.status === 'COMPLETED') {
        setProblem((p) => { const { [r.id]: _drop, ...rest } = p; return rest; });
        toast(`Paid ${r.amount} to ${displayName(r.requester.owner)}`);
      } else {
        setProblem((p) => ({ ...p, [r.id]: declineCopy(result.transfer.rejectionReason, result.transfer.declineExplanation) }));
      }
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decline(r: PaymentRequestView) {
    setBusy(r.id);
    try {
      await api.declineRequest(r.id, me);
      toast('Request declined');
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {requests.map((r) => (
        <div key={r.id} className="request">
          <div className="row">
            <Avatar owner={r.requester.owner} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p><strong>{displayName(r.requester.owner)}</strong> asks for <strong className="num">{r.amount}</strong></p>
              {r.memo ? <p className="muted">{r.memo}</p> : null}
            </div>
          </div>
          {problem[r.id] ? (
            <div className="notice notice-bad" role="alert">
              <strong>{problem[r.id]!.title}.</strong> {problem[r.id]!.why} {problem[r.id]!.next}
            </div>
          ) : null}
          <div className="row">
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={busy === r.id} onClick={() => void pay(r)}>
              {busy === r.id ? 'Paying…' : `Pay ${r.amount}`}
            </button>
            <button type="button" className="btn" disabled={busy === r.id} onClick={() => void decline(r)}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function OutgoingRequests({
  requests,
  me,
  onChanged,
}: {
  requests: PaymentRequestView[];
  me: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(r: PaymentRequestView) {
    setBusy(r.id);
    try {
      await api.cancelRequest(r.id, me);
      toast('Request cancelled');
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="list">
      {requests.map((r) => (
        <li key={r.id}>
          <div className="item">
            <Avatar owner={r.payer.owner} />
            <div className="item-body">
              <p className="item-title">{displayName(r.payer.owner)} owes you {r.amount}</p>
              <p className="item-sub">{r.memo ?? 'No note'} · waiting</p>
            </div>
            <button type="button" className="btn btn-sm btn-quiet" disabled={busy === r.id} onClick={() => void cancel(r)}>Cancel</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
