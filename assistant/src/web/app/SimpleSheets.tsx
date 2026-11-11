import { useEffect, useState } from 'react';
import { api, dollarsToMinor, type AccountRef } from '../api.js';
import { money } from './format.js';
import { Sheet, useToast } from './ui.js';

// Logging a spend or income lives in AddSheet.tsx. This file keeps the demo
// ledger's "Add money" deposit.

const QUICK = [2500, 5000, 10_000, 25_000];

export function AddMoneySheet({
  open,
  onClose,
  me,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.deposit(me.id, minor);
      await onChanged();
      toast(`Money added · ${money(minor)}`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Add money" subtitle="A simulated bank transfer into your Settle wallet." onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="chips" role="group" aria-label="Quick amounts">
          {QUICK.map((q) => (
            <button key={q} type="button" className="chip" aria-pressed={minor === q} onClick={() => setText(String(q / 100))}>
              {money(q)}
            </button>
          ))}
        </div>
        <div className="field">
          <label className="label" htmlFor="add-amount">Amount</label>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input id="add-amount" className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <p className="hint">This is pretend money in the demo ledger. It does not touch a real bank account.</p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={minor === null || busy}>
          {busy ? 'Adding…' : minor === null ? 'Add money' : `Add ${money(minor)}`}
        </button>
      </form>
    </Sheet>
  );
}
