import { useEffect, useMemo, useState } from 'react';
import { api, dollarsToMinor, type AccountRef } from '../api.js';
import { splitEvenly } from '../../server/money.js';
import { displayName, money } from './format.js';
import { Avatar, Sheet, useToast } from './ui.js';

type Mode = 'split' | 'ask';

/** Ask one friend for money, or split a bill you already paid. Money only moves when they accept. */
export function RequestSheet({
  open,
  onClose,
  me,
  peers,
  initialMode = 'split',
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  peers: AccountRef[];
  initialMode?: Mode;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [totalText, setTotalText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [includeMe, setIncludeMe] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setTotalText('');
    setPicked([]);
    setIncludeMe(true);
    setNote('');
    setError(null);
    setBusy(false);
  }, [open, initialMode]);

  const totalMinor = useMemo(() => dollarsToMinor(totalText), [totalText]);

  const plan = useMemo(() => {
    if (totalMinor === null || picked.length === 0) return null;
    if (mode === 'ask') {
      return picked.length === 1 ? { mine: 0, shares: [totalMinor] } : null;
    }
    const people = picked.length + (includeMe ? 1 : 0);
    if (totalMinor < people) return null;
    const all = splitEvenly(totalMinor, people);
    return includeMe ? { mine: all[0] ?? 0, shares: all.slice(1) } : { mine: 0, shares: all };
  }, [totalMinor, picked, includeMe, mode]);

  function toggle(id: string) {
    setPicked((prev) => {
      if (mode === 'ask') return prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 8 ? [...prev, id] : prev;
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPicked((prev) => (next === 'ask' ? prev.slice(0, 1) : prev));
  }

  async function submit() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await api.createRequests({
        requesterAccountId: me.id,
        memo: note.trim() || undefined,
        payers: picked.map((accountId, i) => ({ accountId, amountMinor: plan.shares[i]! })),
      });
      onChanged();
      toast(picked.length === 1 ? 'Request sent' : `Asked ${picked.length} people`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={mode === 'split' ? 'Split a bill' : 'Ask for money'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="seg" role="group" aria-label="What do you want to do">
          <button type="button" aria-pressed={mode === 'split'} onClick={() => switchMode('split')}>Split a bill</button>
          <button type="button" aria-pressed={mode === 'ask'} onClick={() => switchMode('ask')}>Ask one person</button>
        </div>

        <div className="field">
          <label className="label" htmlFor="req-total">
            {mode === 'split' ? 'Total bill' : 'Amount'}
          </label>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input
              id="req-total"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
            />
          </div>
          <p className="hint">
            {mode === 'split'
              ? 'The full amount you paid. Everyone you pick is asked for an equal share.'
              : 'They get a request and decide whether to pay.'}
          </p>
        </div>

        <div className="field">
          <span className="label" id="req-who">{mode === 'split' ? 'Who was in?' : 'Who owes you?'}</span>
          {peers.length === 0 ? (
            <p className="muted">You have no friends yet. Send or receive a payment first and they show up here.</p>
          ) : (
            <div className="chips" role="group" aria-labelledby="req-who">
              {peers.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                  <Avatar owner={p.owner} small />
                  {displayName(p.owner)}
                </button>
              ))}
            </div>
          )}
          {mode === 'split' ? (
            <label className="row" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} />
              <span>I am splitting it too</span>
            </label>
          ) : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="req-note">What is it for? <span className="faint">(optional)</span></label>
          <input id="req-note" className="input" maxLength={120} placeholder="Dinner, groceries, tickets" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {plan ? (
          <div className="card-flat stack-sm" aria-live="polite">
            {picked.map((id, i) => {
              const p = peers.find((x) => x.id === id);
              return (
                <div key={id} className="row between">
                  <span>{p ? displayName(p.owner) : 'Friend'} pays</span>
                  <strong className="num">{money(plan.shares[i]!)}</strong>
                </div>
              );
            })}
            {mode === 'split' && includeMe ? (
              <div className="row between faint">
                <span>Your share</span>
                <span className="num">{money(plan.mine)}</span>
              </div>
            ) : null}
            <p className="hint">The shares always add up to the total. Leftover cents go to the first share.</p>
          </div>
        ) : null}

        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={!plan || busy}>
          {busy ? 'Sending…' : picked.length > 1 ? `Ask ${picked.length} people` : 'Send request'}
        </button>
      </form>
    </Sheet>
  );
}
