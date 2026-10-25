import { useCallback, useEffect, useState } from 'react';
import {
  api,
  dollarsToMinor,
  SETTLE_RAILS,
  type AccountRef,
  type PaymentRequestView,
  type SettleRail,
} from '../api.js';
import { displayName, money } from './format.js';
import { Avatar, EmptyState, Icon, Sheet, useToast } from './ui.js';

/**
 * Settle Up — the middle layer between "just Venmo it" and a budgeting app.
 * One book for who owes what; settlement happens on any rail (in-app, Zelle,
 * Cash App, cash, crypto). The rail is recorded on the receipt, so a future
 * rail integration upgrades the same flow without changing the workflow.
 */

const RAIL_LABELS: Record<SettleRail, string> = {
  zelle: 'Zelle',
  cashapp: 'Cash App',
  venmo: 'Venmo',
  cash: 'Cash',
  crypto: 'Crypto',
  other: 'Other',
};

/** Same rule as the server: floor shares, leftover cents to the first shares. */
export function splitShares(totalMinor: number, parts: number): number[] {
  const base = Math.floor(totalMinor / parts);
  const extra = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

function useRequests(accountId: string) {
  const [rows, setRows] = useState<{ incoming: PaymentRequestView[]; outgoing: PaymentRequestView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await api.requests(accountId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [accountId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, error, reload };
}

function railBadge(rail: SettleRail | null) {
  if (!rail) return null;
  return <span className="rail-badge">{RAIL_LABELS[rail]}</span>;
}

/* ---------- The sheet: ask & split on one tab, settle on the other ---------- */

export function SettleUpSheet({
  open,
  onClose,
  me,
  onChanged,
  initialMode = 'ask',
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  onChanged: () => Promise<void>;
  initialMode?: 'ask' | 'settle';
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'ask' | 'settle'>(initialMode);
  const [peers, setPeers] = useState<AccountRef[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rows, error: rowsError, reload } = useRequests(me.id);
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    api.peers(me.id).then(setPeers).catch(() => setPeers([]));
  }, [open, initialMode, me.id]);

  const shares = minor !== null && picked.length > 0 ? splitShares(minor, picked.length) : [];
  const nameOf = (ref: AccountRef) => displayName(ref.owner);

  async function submitAsk() {
    if (minor === null || minor <= 0 || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const split = splitShares(minor, picked.length);
      await api.createRequests({
        requesterAccountId: me.id,
        memo: memo.trim() || undefined,
        payers: picked.map((accountId, i) => ({ accountId, amountMinor: split[i]! })),
      });
      await Promise.all([reload(), onChanged()]);
      toast(`Asked for ${money(minor)}`, { tone: 'good' });
      setPicked([]);
      setText('');
      setMemo('');
      setMode('settle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([reload(), onChanged()]);
      toast(done, { tone: 'good' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const incoming = (rows?.incoming ?? []).filter((r) => r.status === 'PENDING');
  const outgoing = (rows?.outgoing ?? []).filter((r) => r.status === 'PENDING');
  const history = [...(rows?.incoming ?? []), ...(rows?.outgoing ?? [])]
    .filter((r) => r.status !== 'PENDING')
    .slice(0, 4);

  return (
    <Sheet
      open={open}
      title="Settle up"
      subtitle="Ask, split, and settle — on any rail you already use."
      size="wide"
      onClose={onClose}
    >
      <div className="chips" role="tablist" aria-label="Settle up modes" style={{ marginBottom: 18 }}>
        <button type="button" className="chip" role="tab" aria-selected={mode === 'ask'} aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>
          Ask &amp; split
        </button>
        <button type="button" className="chip" role="tab" aria-selected={mode === 'settle'} aria-pressed={mode === 'settle'} onClick={() => setMode('settle')}>
          Settle{incoming.length + outgoing.length > 0 ? ` · ${incoming.length + outgoing.length}` : ''}
        </button>
      </div>

      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {mode === 'ask' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submitAsk(); }}>
          <div className="field">
            <span className="label" id="settle-who">Who are you asking?</span>
            {peers.length === 0 ? (
              <p className="hint">
                No one to ask yet. People you have paid (or who have paid you) show up here.
                In the demo, try the bank dock or the guided demo to create a peer.
              </p>
            ) : (
              <div className="chips" role="group" aria-labelledby="settle-who">
                {peers.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="chip chip-person"
                      aria-pressed={on}
                      onClick={() => setPicked((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
                    >
                      <Avatar owner={p.owner} small /> {nameOf(p)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="field">
            <label className="label" htmlFor="settle-amount">Total amount</label>
            <div className="amount-input">
              <span aria-hidden="true">$</span>
              <input id="settle-amount" className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            {shares.length > 1 && minor !== null ? (
              <p className="hint">Split evenly · {shares.map((s) => money(s)).join(' + ')}</p>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="settle-memo">What is it for? <span className="faint">(optional)</span></label>
            <input id="settle-memo" className="input" maxLength={140} placeholder="Dinner, tickets, ski house…" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>

          <p className="hint">They can pay in the app, or anywhere else — you record the rail when it lands.</p>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={minor === null || minor <= 0 || picked.length === 0 || busy}>
            {busy
              ? 'Sending…'
              : minor === null || picked.length === 0
                ? 'Ask'
                : `Ask ${picked.length === 1 ? nameOf(peers.find((p) => p.id === picked[0]) ?? { id: '', owner: picked[0]! }) : `${picked.length} people`} for ${money(minor)}`}
          </button>
        </form>
      ) : null}

      {mode === 'settle' ? (
        <div className="stack">
          {rowsError ? <p className="error-text" role="alert">{rowsError}</p> : null}

          {incoming.length === 0 && outgoing.length === 0 ? (
            <EmptyState title="Nothing to settle" action={<button type="button" className="btn btn-primary" onClick={() => setMode('ask')}>Ask &amp; split</button>}>
              Requests from people land here, with every rail on the receipt.
            </EmptyState>
          ) : null}

          {incoming.map((r) => (
            <div key={r.id} className="request-row">
              <div className="request-copy">
                <p className="eyebrow">You owe {nameOf(r.requester)}</p>
                <p className="request-amount num">{r.amount}</p>
                {r.memo ? <p className="muted">{r.memo}</p> : null}
              </div>
              <div className="request-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(() => api.payRequest(r.id, me.id), `Paid ${nameOf(r.requester)} ${r.amount}`)}>
                  Pay in app
                </button>
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void act(() => api.declineRequest(r.id, me.id), 'Declined')}>Decline</button>
              </div>
            </div>
          ))}

          {outgoing.map((r) => (
            <div key={r.id} className="request-row">
              <div className="request-copy">
                <p className="eyebrow">{nameOf(r.payer)} owes you</p>
                <p className="request-amount num">{r.amount}</p>
                {r.memo ? <p className="muted">{r.memo}</p> : null}
                <div className="chips" style={{ marginTop: 8 }}>
                  {SETTLE_RAILS.map((rail) => (
                    <button
                      key={rail}
                      type="button"
                      className="chip chip-sm"
                      disabled={busy}
                      title={`Record that ${nameOf(r.payer)} settled via ${RAIL_LABELS[rail]}`}
                      onClick={() => void act(() => api.settleRequest(r.id, me.id, rail), `Settled via ${RAIL_LABELS[rail]}`)}
                    >
                      {RAIL_LABELS[rail]}
                    </button>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>Tap the rail they paid you on.</p>
              </div>
              <div className="request-actions">
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void act(() => api.cancelRequest(r.id, me.id), 'Cancelled')}>Cancel</button>
              </div>
            </div>
          ))}

          {history.length > 0 ? (
            <div className="card-flat">
              <p className="eyebrow">Recently settled</p>
              <div className="stack-sm" style={{ marginTop: 8 }}>
                {history.map((r) => (
                  <div key={r.id} className="row between">
                    <span className="muted">
                      {r.status === 'PAID' ? (r.settledVia ? `Paid · ${RAIL_LABELS[r.settledVia]}` : 'Paid in app') : r.status.toLowerCase()} · {r.amount}
                      {r.memo ? ` · ${r.memo}` : ''}
                    </span>
                    {railBadge(r.settledVia)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------- Home card: what needs an answer, with the two obvious actions ---------- */

export function NeedsYouCard({ me, onOpen }: { me: AccountRef; onOpen: () => void }) {
  const toast = useToast();
  const { rows, reload } = useRequests(me.id);
  const [busy, setBusy] = useState(false);
  const incoming = (rows?.incoming ?? []).filter((r) => r.status === 'PENDING');
  const outgoing = (rows?.outgoing ?? []).filter((r) => r.status === 'PENDING');

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(done, { tone: 'good' });
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <section className="card" aria-labelledby="needs-you">
        <div className="card-head">
          <div>
            <h2 id="needs-you">Who owes what</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onOpen}><Icon name="split" size={16} /> Ask &amp; split</button>
        </div>
        <p className="muted">Request money or split a bill — settle in the app, on Zelle, Cash App, or cash. One book either way.</p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="needs-you">
      <div className="card-head">
        <div>
          <h2 id="needs-you">Settle up</h2>
        </div>
        <button type="button" className="link-btn" onClick={onOpen}>Open</button>
      </div>
      <div className="stack-sm">
        {incoming.slice(0, 3).map((r) => (
          <div key={r.id} className="request-row request-row-compact">
            <div className="request-copy">
              <p className="muted">You owe {displayName(r.requester.owner)}{r.memo ? ` · ${r.memo}` : ''}</p>
              <p className="request-amount num">{r.amount}</p>
            </div>
            <div className="request-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(() => api.payRequest(r.id, me.id), `Paid ${displayName(r.requester.owner)}`)}>Pay</button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void act(() => api.declineRequest(r.id, me.id), 'Declined')}>Decline</button>
            </div>
          </div>
        ))}
        {outgoing.slice(0, 3).map((r) => (
          <div key={r.id} className="request-row request-row-compact">
            <div className="request-copy">
              <p className="muted">{displayName(r.payer.owner)} owes you{r.memo ? ` · ${r.memo}` : ''}</p>
              <p className="request-amount num">{r.amount}</p>
            </div>
            <div className="request-actions">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={onOpen}>Record rail</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}