import { useEffect, useMemo, useRef, useState } from 'react';
import { api, dollarsToMinor, type AccountRef } from '../api.js';
import { declineCopy } from './copy.js';
import { displayName, money } from './format.js';
import { Avatar, Icon, Sheet, useToast } from './ui.js';

type Step = 'form' | 'confirm' | 'sending' | 'sent' | 'declined';

export function SendSheet({
  open,
  onClose,
  me,
  balanceMinor,
  peers,
  initialTo,
  initialAmount,
  initialNote,
  onChanged,
  onAddMoney,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  balanceMinor: number;
  peers: AccountRef[];
  initialTo?: AccountRef | null;
  initialAmount?: string;
  initialNote?: string;
  onChanged: () => void;
  onAddMoney: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState<AccountRef | null>(initialTo ?? null);
  const [other, setOther] = useState('');
  const [amountText, setAmountText] = useState(initialAmount ?? '');
  const [note, setNote] = useState(initialNote ?? '');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<{ code: string | null } | null>(null);
  const [looking, setLooking] = useState(false);
  // One key per payment the person sets up. If a network error forces a retry, the same key goes
  // out again and the ledger recognises it, so a retry can never pay twice.
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setTo(initialTo ?? null);
    setAmountText(initialAmount ?? '');
    setNote(initialNote ?? '');
    setOther('');
    setStep('form');
    setError(null);
    setDeclined(null);
    key.current = crypto.randomUUID();
  }, [open, initialTo, initialAmount, initialNote]);

  const amountMinor = useMemo(() => dollarsToMinor(amountText), [amountText]);
  const over = amountMinor !== null && amountMinor > balanceMinor;
  const canContinue = !!to && amountMinor !== null && !over;

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      key.current = crypto.randomUUID();
    };
  }

  async function findOther() {
    const name = other.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    setLooking(true);
    setError(null);
    try {
      const found = (await api.findAccounts(name)).find((a) => a.id !== me.id);
      if (found) {
        setTo(found);
        key.current = crypto.randomUUID();
      } else {
        setError(`No wallet named "${other.trim()}". Check the spelling, or ask them to open one.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLooking(false);
    }
  }

  async function send() {
    if (!to || amountMinor === null) return;
    setStep('sending');
    setError(null);
    try {
      const result = await api.transfer(
        {
          sourceAccountId: me.id,
          destinationAccountId: to.id,
          amountMinor,
          currency: 'USD',
          memo: note.trim() || undefined,
        },
        key.current,
      );
      onChanged();
      if (result.status === 'COMPLETED') {
        setStep('sent');
        toast(`Sent ${money(amountMinor)} to ${displayName(to.owner)}`);
      } else {
        setDeclined({ code: result.rejectionReason ?? null });
        setStep('declined');
      }
    } catch (e) {
      setError(`${(e as Error).message} Your payment may not have gone through. Press Send again: it is safe to retry.`);
      setStep('confirm');
    }
  }

  const title = step === 'sent' ? 'Payment sent' : step === 'declined' ? 'Payment declined' : 'Send money';

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {step === 'form' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (canContinue) setStep('confirm');
          }}
        >
          <div className="field">
            <span className="label" id="send-to">To</span>
            <div className="chips" role="group" aria-labelledby="send-to">
              {peers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  aria-pressed={to?.id === p.id}
                  onClick={() => touch(setTo)(p)}
                >
                  <Avatar owner={p.owner} small />
                  {displayName(p.owner)}
                </button>
              ))}
              {to && !peers.some((p) => p.id === to.id) ? (
                <button type="button" className="chip" aria-pressed="true">
                  <Avatar owner={to.owner} small />
                  {displayName(to.owner)}
                </button>
              ) : null}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input
                className="input"
                placeholder="Someone else: type their wallet name"
                aria-label="Find someone by wallet name"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void findOther();
                  }
                }}
              />
              <button type="button" className="btn" disabled={!other.trim() || looking} onClick={() => void findOther()}>
                {looking ? 'Looking…' : 'Find'}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="send-amount">Amount</label>
            <div className="amount-input">
              <span aria-hidden="true">$</span>
              <input
                id="send-amount"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => touch(setAmountText)(e.target.value)}
                aria-invalid={over || (amountText !== '' && amountMinor === null)}
                aria-describedby="send-amount-hint"
              />
            </div>
            <p id="send-amount-hint" className={over || (amountText !== '' && amountMinor === null) ? 'error-text' : 'hint'}>
              {amountText !== '' && amountMinor === null
                ? 'Enter an amount like 12.50.'
                : over
                  ? `That is more than your balance of ${money(balanceMinor)}.`
                  : amountMinor !== null
                    ? `You will have ${money(balanceMinor - amountMinor)} left.`
                    : `Your balance is ${money(balanceMinor)}.`}
            </p>
            {over ? (
              <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => { onClose(); onAddMoney(); }}>
                Add money first
              </button>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="send-note">What is it for? <span className="faint">(optional)</span></label>
            <input
              id="send-note"
              className="input"
              maxLength={120}
              placeholder="Lunch, rent, tickets"
              value={note}
              onChange={(e) => touch(setNote)(e.target.value)}
            />
          </div>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={!canContinue}>Review</button>
        </form>
      )}

      {(step === 'confirm' || step === 'sending') && to && amountMinor !== null && (
        <div className="stack">
          <div className="card-flat stack-sm">
            <div className="row">
              <Avatar owner={to.owner} />
              <div>
                <p className="faint" style={{ fontSize: '0.88rem' }}>You are sending</p>
                <p className="num" style={{ fontSize: '1.8rem', fontWeight: 700, lineHeight: 1.15 }}>{money(amountMinor)}</p>
                <p>to <strong>{displayName(to.owner)}</strong>{note.trim() ? <> for {note.trim()}</> : null}</p>
              </div>
            </div>
          </div>
          <p className="muted">
            Your balance goes from {money(balanceMinor)} to {money(balanceMinor - amountMinor)}.
            The payment is recorded as a debit from you and a matching credit to {displayName(to.owner)}.
          </p>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <div className="row">
            <button className="btn" type="button" onClick={() => setStep('form')} disabled={step === 'sending'}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} type="button" onClick={() => void send()} disabled={step === 'sending'}>
              {step === 'sending' ? 'Sending…' : `Send ${money(amountMinor)}`}
            </button>
          </div>
        </div>
      )}

      {step === 'sent' && to && amountMinor !== null && (
        <div className="stack">
          <div className="notice notice-good row" style={{ alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--good)' }}><Icon name="check" size={26} /></span>
            <p><strong>{money(amountMinor)} sent to {displayName(to.owner)}.</strong> It shows in your activity with a receipt you can check.</p>
          </div>
          <button className="btn btn-primary btn-block" type="button" onClick={onClose}>Done</button>
        </div>
      )}

      {step === 'declined' && declined && amountMinor !== null && (() => {
        const copy = declineCopy(declined.code);
        return (
          <div className="stack">
            <div className="notice notice-bad stack-sm" role="alert">
              <p><strong>{copy.title}.</strong> No money moved.</p>
              <p>{copy.why}</p>
              <p><strong>Next:</strong> {copy.next}</p>
            </div>
            <div className="row">
              <button className="btn" type="button" onClick={onClose}>Close</button>
              {declined.code === 'INSUFFICIENT_FUNDS' ? (
                <button className="btn btn-primary" type="button" onClick={() => { onClose(); onAddMoney(); }}>Add money</button>
              ) : (
                <button className="btn btn-primary" type="button" onClick={() => { key.current = crypto.randomUUID(); setStep('form'); }}>Change amount</button>
              )}
            </div>
          </div>
        );
      })()}
    </Sheet>
  );
}
