import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  dollarsToMinor,
  SETTLE_RAILS,
  type AccountRef,
  type PaymentRequestView,
  type SettleRail,
} from '../api.js';
import { displayName, money, plural } from './format.js';
import { applyResolvedOverlay, rememberResolved, type ResolvedMark } from './settle-overlay.js';
import { Avatar, Icon, Sheet, useToast } from './ui.js';

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

/** How long a resolved card takes to collapse out of the list. */
const EXIT_MS = 220;
const QUICK_AMOUNTS = [10, 20, 50];

/** Same rule as the server: floor shares, leftover cents to the first shares. */
export function splitShares(totalMinor: number, parts: number): number[] {
  const base = Math.floor(totalMinor / parts);
  const extra = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * The pay endpoint answers 200 even when the transfer was rejected. Only a request
 * that actually landed as PAID counts as success; a repeated tap on an already-paid
 * demo request comes back without a transfer, which is still a success.
 */
export function assertPaid(result: {
  request: { status: string };
  transfer?: { status: string; rejectionReason: string | null; declineExplanation: string | null };
}): void {
  if (result.request.status === 'PAID') return;
  throw new Error(
    result.transfer?.declineExplanation
      || result.transfer?.rejectionReason
      || 'That payment did not go through. Try again.',
  );
}

function useRequests(accountId: string) {
  const [rows, setRows] = useState<{ incoming: PaymentRequestView[]; outgoing: PaymentRequestView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      /* Another serverless instance may serve a resolved demo row as PENDING again;
         the session overlay keeps what this tab already settled. */
      setRows(applyResolvedOverlay(accountId, await api.requests(accountId)));
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

/** "2 days ago" — old requests should read as old at a glance. */
function ageLabel(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (days < 30) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ---------- One place for pay / decline / settle, shared by the sheet and the Today card ---------- */

const REQUESTS_CHANGED = 'settle:requests-changed';

function useRequestActions(me: AccountRef, refresh: () => Promise<void>, announce = false) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [recording, setRecording] = useState<{ id: string; rail: SettleRail } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setLeaving([]);
    setHidden([]);
    setRecording(null);
  }, []);

  const act = useCallback(
    async (
      id: string,
      fn: () => Promise<unknown>,
      done: string,
      resolved?: ResolvedMark & { id: string },
      rail?: SettleRail,
    ) => {
      setBusyId(id);
      setError(null);
      if (rail) setRecording({ id, rail });
      try {
        await fn();
        if (resolved) rememberResolved(me.id, resolved.id, { status: resolved.status, settledVia: resolved.settledVia });
        /* The card collapses once the request lands, then leaves the list. */
        setLeaving((prev) => (prev.includes(id) ? prev : [...prev, id]));
        await wait(prefersReducedMotion() ? 0 : EXIT_MS);
        setHidden((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setLeaving((prev) => prev.filter((x) => x !== id));
        await refresh();
        /* The Today card keeps its own copy of the list; tell it to catch up. */
        if (announce && typeof window !== 'undefined') window.dispatchEvent(new Event(REQUESTS_CHANGED));
        toast(done, { tone: 'good' });
      } catch (e) {
        const message = (e as Error).message || 'That did not go through. Try again.';
        setError(message);
        toast(message, { tone: 'bad' });
      } finally {
        setBusyId(null);
        setRecording(null);
      }
    },
    [me.id, refresh, toast, announce],
  );

  return { busyId, leaving, hidden, recording, error, setError, reset, act };
}

/* ---------- Balance summary: two tiles and a proportion bar ---------- */

function BalanceSummary({
  incoming,
  outgoing,
  idPrefix,
  compact = false,
}: {
  incoming: PaymentRequestView[];
  outgoing: PaymentRequestView[];
  idPrefix: string;
  compact?: boolean;
}) {
  const oweTotal = incoming.reduce((sum, r) => sum + r.amountMinor, 0);
  const owedTotal = outgoing.reduce((sum, r) => sum + r.amountMinor, 0);
  const headId = `${idPrefix}-balance`;
  const square = oweTotal === 0 && owedTotal === 0;

  if (square) {
    return (
      <div className={`settle-balance is-square${compact ? ' is-compact' : ''}`} role="status">
        <p className="settle-square-text">No open requests.</p>
      </div>
    );
  }

  const oweShare = Math.round((oweTotal / (oweTotal + owedTotal)) * 100);

  return (
    <section className={`settle-balance${compact ? ' is-compact' : ''}`} aria-labelledby={headId}>
      <h3 id={headId} className="settle-balance-head">
        Where you stand
      </h3>
      <div className="settle-stats">
        <div className="settle-stat is-owe">
          <span className="settle-stat-label">You owe</span>
          <strong className="settle-stat-amount">{money(oweTotal)}</strong>
          <span className="settle-stat-note">
            {incoming.length} {plural(incoming.length, 'request')}
          </span>
        </div>
        <div className="settle-stat is-owed">
          <span className="settle-stat-label">Owed to you</span>
          <strong className="settle-stat-amount">{money(owedTotal)}</strong>
          <span className="settle-stat-note">
            {outgoing.length} {plural(outgoing.length, 'request')}
          </span>
        </div>
      </div>
      <div className="settle-splitbar" aria-hidden="true">
        {oweShare > 0 ? <span className="settle-splitbar-owe" style={{ width: `${oweShare}%` }} /> : null}
        {oweShare < 100 ? <span className="settle-splitbar-owed" style={{ width: `${100 - oweShare}%` }} /> : null}
      </div>
    </section>
  );
}

/* ---------- One request, one person, one clear action ---------- */

type Confirmation = 'decline' | 'cancel';

function RequestCard({
  request,
  direction,
  me,
  busy,
  leaving,
  rail,
  onAct,
  compact = false,
}: {
  request: PaymentRequestView;
  direction: 'owe' | 'owed';
  me: AccountRef;
  busy: boolean;
  leaving: boolean;
  rail: SettleRail | null;
  onAct: (
    id: string,
    fn: () => Promise<unknown>,
    done: string,
    resolved?: ResolvedMark & { id: string },
    rail?: SettleRail,
  ) => Promise<void>;
  compact?: boolean;
}) {
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const person = direction === 'owe' ? request.requester : request.payer;
  const name = displayName(person.owner);
  const age = ageLabel(request.createdAt);
  const owes = direction === 'owe';

  function run(fn: () => Promise<unknown>, done: string, resolved: ResolvedMark & { id: string }, chosen?: SettleRail) {
    void onAct(request.id, fn, done, resolved, chosen);
  }

  const confirmText =
    confirm === 'cancel'
      ? `Cancel your request to ${name} for ${request.amount}?`
      : `Decline ${name}'s ${request.amount} request?`;

  return (
    <li
      className={`settle-card${leaving ? ' is-leaving' : ''}${busy ? ' is-busy' : ''}${compact ? ' is-compact' : ''}`}
      data-direction={direction}
      aria-busy={busy || undefined}
    >
      <div className="settle-card-head">
        <Avatar owner={person.owner} />
        <div className="settle-card-who">
          <h4 className="settle-card-name">{name}</h4>
          <p className="settle-card-memo">{request.memo ?? (owes ? 'Requested from you' : 'You asked for this')}</p>
          {age ? <p className="settle-card-age">{age}</p> : null}
        </div>
        <div className="settle-card-figures">
          <span className="settle-card-amount">{request.amount}</span>
          <span className={`settle-dir ${owes ? 'is-owe' : 'is-owed'}`}>{owes ? 'You owe' : 'Owes you'}</span>
        </div>
      </div>

      {confirm ? (
        <div className="settle-confirm" role="group" aria-label={confirmText}>
          <p className="settle-confirm-text">{confirmText}</p>
          <div className="settle-card-actions">
            {confirm === 'cancel' ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                aria-label={`Confirm cancelling your request to ${name} for ${request.amount}`}
                onClick={() =>
                  run(() => api.cancelRequest(request.id, me.id), 'Request cancelled', {
                    id: request.id,
                    status: 'CANCELLED',
                    settledVia: null,
                  })
                }
              >
                Confirm
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                aria-label={`Confirm declining ${name}'s ${request.amount} request`}
                onClick={() =>
                  run(() => api.declineRequest(request.id, me.id), `Declined ${name}'s request`, {
                    id: request.id,
                    status: 'DECLINED',
                    settledVia: null,
                  })
                }
              >
                Confirm
              </button>
            )}
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setConfirm(null)}>
              Keep
            </button>
          </div>
        </div>
      ) : owes ? (
        <div className="settle-card-actions">
          <button
            type="button"
            className="btn btn-primary settle-main-action"
            disabled={busy}
            aria-label={`Pay ${name} ${request.amount}`}
            onClick={() =>
              run(async () => assertPaid(await api.payRequest(request.id, me.id)), `Paid ${name} ${request.amount}`, {
                id: request.id,
                status: 'PAID',
                settledVia: null,
              })
            }
          >
            {busy ? (
              <>
                <span className="btn-spinner" aria-hidden="true" /> Paying…
              </>
            ) : (
              `Pay ${request.amount}`
            )}
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            aria-label={`Decline ${name}'s ${request.amount} request`}
            onClick={() => setConfirm('decline')}
          >
            Decline
          </button>
        </div>
      ) : railOpen ? (
        <div className="settle-rails" role="group" aria-label={`How did ${name} pay you ${request.amount}?`}>
          <p className="settle-confirm-text">How did {name} pay you {request.amount}?</p>
          <div className="settle-rail-grid">
            {SETTLE_RAILS.map((choice) => (
              <button
                key={choice}
                type="button"
                className="settle-rail-btn"
                disabled={busy}
                aria-label={`Record ${name}'s ${request.amount} as paid by ${RAIL_LABELS[choice]}`}
                onClick={() => {
                  setRailOpen(false);
                  run(
                    () => api.settleRequest(request.id, me.id, choice),
                    `Recorded ${name} paid ${request.amount} via ${RAIL_LABELS[choice]}`,
                    { id: request.id, status: 'PAID', settledVia: choice },
                    choice,
                  );
                }}
              >
                {RAIL_LABELS[choice]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setRailOpen(false)}>
            Keep waiting
          </button>
        </div>
      ) : (
        <div className="settle-card-actions">
          <button
            type="button"
            className="btn btn-primary settle-main-action"
            disabled={busy}
            aria-label={`Record payment from ${name} for ${request.amount}`}
            onClick={() => setRailOpen(true)}
          >
            {busy ? (
              <>
                <span className="btn-spinner" aria-hidden="true" /> Recording…
              </>
            ) : (
              <>
                <Icon name="check" size={16} /> Record payment
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            aria-label={`Cancel your request to ${name} for ${request.amount}`}
            onClick={() => setConfirm('cancel')}
          >
            Cancel
          </button>
        </div>
      )}

      {rail && (busy || leaving) ? (
        <p className="settle-recorded" aria-live="polite">
          Recorded {railBadge(rail)}
        </p>
      ) : null}
    </li>
  );
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
  const { rows, error: rowsError, reload } = useRequests(me.id);
  const pendingSplit = useRef<{ body: string; key: string } | null>(null);
  const { busyId, leaving, hidden, recording, error, setError, reset, act } = useRequestActions(
    me,
    useCallback(async () => {
      await Promise.all([reload(), onChanged()]);
    }, [reload, onChanged]),
    true,
  );
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    reset();
    api.peers(me.id).then(setPeers).catch(() => setPeers([]));
  }, [open, initialMode, me.id, reset, setError]);

  const shares = minor !== null && picked.length > 0 ? splitShares(minor, picked.length) : [];
  const nameOf = (ref: AccountRef) => displayName(ref.owner);
  const visible = (list: PaymentRequestView[] | undefined) =>
    (list ?? []).filter((r) => r.status === 'PENDING' && !hidden.includes(r.id));
  const incoming = visible(rows?.incoming);
  const outgoing = visible(rows?.outgoing);
  const history = [...(rows?.incoming ?? []), ...(rows?.outgoing ?? [])]
    .filter((r) => r.status !== 'PENDING')
    .slice(0, 4);
  const pendingCount = incoming.length + outgoing.length;

  async function submitAsk() {
    if (minor === null || minor <= 0 || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const split = splitShares(minor, picked.length);
      const body = {
        requesterAccountId: me.id,
        memo: memo.trim() || undefined,
        payers: picked.map((accountId, i) => ({ accountId, amountMinor: split[i]! })),
      };
      const serialized = JSON.stringify(body);
      if (pendingSplit.current?.body !== serialized)
        pendingSplit.current = { body: serialized, key: crypto.randomUUID() };
      await api.createRequests(body, pendingSplit.current.key);
      await Promise.all([reload(), onChanged()]);
      pendingSplit.current = null;
      toast(`Request sent · ${money(minor)}`, { tone: 'good' });
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

  const askLabel = (() => {
    if (busy) return 'Sending…';
    if (minor === null || minor <= 0 || picked.length === 0) return 'Ask';
    if (picked.length === 1) {
      const only = peers.find((p) => p.id === picked[0]);
      return `Ask ${only ? nameOf(only) : displayName(picked[0]!)} for ${money(minor)}`;
    }
    return `Split ${money(minor)} with ${picked.length} people`;
  })();

  return (
    <Sheet
      open={open}
      title="Settle up"
      subtitle="Ask, split, and settle — on any rail you already use."
      size="wide"
      onClose={onClose}
    >
      <div className="settle-tabs" role="tablist" aria-label="Settle up modes" data-active={mode}>
        <span className="settle-tabs-thumb" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          id="settle-tab-ask"
          aria-selected={mode === 'ask'}
          aria-controls="settle-panel-ask"
          className="settle-tab"
          onClick={() => setMode('ask')}
        >
          Ask &amp; split
        </button>
        <button
          type="button"
          role="tab"
          id="settle-tab-settle"
          aria-selected={mode === 'settle'}
          aria-controls="settle-panel-settle"
          className="settle-tab"
          onClick={() => setMode('settle')}
        >
          Settle
          {pendingCount > 0 ? <span className="settle-tab-count">{pendingCount}</span> : null}
        </button>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {mode === 'ask' ? (
        <div id="settle-panel-ask" role="tabpanel" aria-labelledby="settle-tab-ask">
        <form
          className="stack settle-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAsk();
          }}
        >
          <section className="settle-block">
            <h3 className="settle-label" id="settle-who">
              Who are you asking?
            </h3>
            {peers.length === 0 ? (
              <p className="hint">
                No one to ask yet. People you have paid (or who have paid you) show up here. In the demo, try the bank
                dock or the guided demo to create a peer.
              </p>
            ) : (
              <div className="settle-people" role="group" aria-labelledby="settle-who">
                {peers.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`settle-person${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      aria-label={`${on ? 'Remove' : 'Add'} ${nameOf(p)}`}
                      onClick={() => setPicked((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
                    >
                      <Avatar owner={p.owner} />
                      <span className="settle-person-name">{nameOf(p)}</span>
                      <span className="settle-person-check" aria-hidden="true">
                        {on ? <Icon name="check" size={14} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="settle-block">
            <label className="settle-label" htmlFor="settle-amount">
              Total amount
            </label>
            <div className="amount-input settle-amount">
              <span aria-hidden="true">$</span>
              <input
                id="settle-amount"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="chips settle-quick">
              {QUICK_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="chip chip-sm"
                  aria-pressed={minor === amount * 100}
                  onClick={() => setText(String(amount))}
                >
                  {money(amount * 100)}
                </button>
              ))}
            </div>
          </section>

          {shares.length > 0 && minor !== null ? (
            <section className="settle-preview" aria-labelledby="settle-preview-head" aria-live="polite">
              <div className="settle-preview-head">
                <h3 className="settle-label" id="settle-preview-head">
                  Each person pays
                </h3>
                <span className="settle-preview-total num">{money(minor)}</span>
              </div>
              <ul className="settle-preview-list">
                {picked.map((id, i) => {
                  const peer = peers.find((p) => p.id === id);
                  return (
                    <li key={id}>
                      <Avatar owner={peer?.owner ?? id} small />
                      <span className="settle-preview-name">{peer ? nameOf(peer) : displayName(id)}</span>
                      <span className="settle-preview-amount num">{money(shares[i] ?? 0)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="settle-block">
            <label className="settle-label" htmlFor="settle-memo">
              What is it for? <span className="faint">(optional)</span>
            </label>
            <input
              id="settle-memo"
              className="input"
              maxLength={140}
              placeholder="Dinner, tickets, ski house…"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </section>

          <p className="hint">They can pay in the app, or anywhere else — you record the rail when it lands.</p>
          <button
            className="btn btn-primary btn-block btn-lg settle-ask-btn"
            type="submit"
            disabled={minor === null || minor <= 0 || picked.length === 0 || busy}
          >
            {askLabel}
          </button>
        </form>
        </div>
      ) : null}

      {mode === 'settle' ? (
        <div className="settle-panel" id="settle-panel-settle" role="tabpanel" aria-labelledby="settle-tab-settle">
          {rowsError ? (
            <p className="error-text" role="alert">
              {rowsError}
            </p>
          ) : null}

          <BalanceSummary incoming={incoming} outgoing={outgoing} idPrefix="sheet" />

          {pendingCount === 0 ? (
            <p className="settle-empty-hint">
              Requests from people land here, with every rail on the receipt.{' '}
              <button type="button" className="link-btn" onClick={() => setMode('ask')}>
                Ask for something
              </button>
            </p>
          ) : null}

          {incoming.length > 0 ? (
            <section className="settle-section" aria-labelledby="settle-owe">
              <div className="settle-section-head">
                <h3 className="settle-section-title" id="settle-owe">
                  You owe <span className="settle-count">{incoming.length}</span>
                </h3>
                <span className="settle-section-total">{money(incoming.reduce((s, r) => s + r.amountMinor, 0))}</span>
              </div>
              <ul className="settle-list">
                {incoming.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    direction="owe"
                    me={me}
                    busy={busyId === r.id}
                    leaving={leaving.includes(r.id)}
                    rail={recording?.id === r.id ? recording.rail : null}
                    onAct={act}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {outgoing.length > 0 ? (
            <section className="settle-section" aria-labelledby="settle-owed">
              <div className="settle-section-head">
                <h3 className="settle-section-title" id="settle-owed">
                  Owed to you <span className="settle-count">{outgoing.length}</span>
                </h3>
                <span className="settle-section-total">{money(outgoing.reduce((s, r) => s + r.amountMinor, 0))}</span>
              </div>
              <ul className="settle-list">
                {outgoing.map((r) => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    direction="owed"
                    me={me}
                    busy={busyId === r.id}
                    leaving={leaving.includes(r.id)}
                    rail={recording?.id === r.id ? recording.rail : null}
                    onAct={act}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="settle-history" aria-labelledby="settle-history-head">
              <h3 className="settle-section-title" id="settle-history-head">
                Recently settled
              </h3>
              <div className="stack-sm" style={{ marginTop: 8 }}>
                {history.map((r) => (
                  <div key={r.id} className="row between">
                    <span className="muted">
                      {r.status === 'PAID'
                        ? r.settledVia
                          ? `Paid · ${RAIL_LABELS[r.settledVia]}`
                          : 'Paid in app'
                        : r.status.toLowerCase()}{' '}
                      · {r.amount}
                      {r.memo ? ` · ${r.memo}` : ''}
                    </span>
                    {railBadge(r.settledVia)}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------- Home card: the balance at a glance, then the two things waiting on you ---------- */

export function NeedsYouCard({ me, onOpen }: { me: AccountRef; onOpen: () => void }) {
  const { rows, error: rowsError, reload } = useRequests(me.id);
  const { busyId, leaving, hidden, recording, error, act } = useRequestActions(me, reload);

  /* Paying inside the sheet changes the same list this card shows. */
  useEffect(() => {
    const sync = () => void reload();
    window.addEventListener(REQUESTS_CHANGED, sync);
    return () => window.removeEventListener(REQUESTS_CHANGED, sync);
  }, [reload]);
  const visible = (list: PaymentRequestView[] | undefined) =>
    (list ?? []).filter((r) => r.status === 'PENDING' && !hidden.includes(r.id));
  const incoming = visible(rows?.incoming);
  const outgoing = visible(rows?.outgoing);
  const top = [...incoming, ...outgoing].slice(0, 2);
  const empty = rows !== null && incoming.length === 0 && outgoing.length === 0;
  const message = error ?? rowsError;

  return (
    <section className="card settle-home" aria-labelledby="needs-you">
      <div className="card-head">
        <div>
          <p className="eyebrow">{empty ? 'Settle up' : 'Needs you'}</p>
          <h2 id="needs-you">Who owes what</h2>
        </div>
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          <Icon name="split" size={16} /> Open Settle Up
        </button>
      </div>

      <BalanceSummary incoming={incoming} outgoing={outgoing} idPrefix="home" compact />

      {message ? (
        <p className="error-text" role="alert">
          {message}
        </p>
      ) : null}

      {empty ? (
        <p className="muted settle-home-lede">
          Request money or split a bill — settle in the app, on Zelle, Cash App, or cash. One book either way.
        </p>
      ) : (
        <ul className="settle-list">
          {top.map((r) => {
            const direction = incoming.some((i) => i.id === r.id) ? 'owe' : 'owed';
            return (
              <RequestCard
                key={r.id}
                request={r}
                direction={direction}
                me={me}
                busy={busyId === r.id}
                leaving={leaving.includes(r.id)}
                rail={recording?.id === r.id ? recording.rail : null}
                onAct={act}
                compact
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
