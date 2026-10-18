import { useEffect, useState } from 'react';
import { api, dollarsToMinor, SPEND_CATEGORIES, type AccountRef, type SpendCategory } from '../api.js';
import { money } from './format.js';
import { Sheet, useToast } from './ui.js';

const QUICK = [2500, 10000, 50000];

export function AddMoneySheet({
  open,
  onClose,
  me,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  onChanged: () => void;
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
      onChanged();
      toast(`Added ${money(minor)}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Add money" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="muted">
          This is a simulated bank transfer. No real money is involved; it creates a deposit in the ledger so you can try payments.
        </p>
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
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={minor === null || busy}>
          {busy ? 'Adding…' : minor === null ? 'Add money' : `Add ${money(minor)}`}
        </button>
      </form>
    </Sheet>
  );
}

const CATEGORY_LABEL: Record<SpendCategory, string> = {
  dining: 'Dining',
  groceries: 'Groceries',
  transport: 'Transport',
  entertainment: 'Fun',
  housing: 'Housing',
  shopping: 'Shopping',
  health: 'Health',
  other: 'Other',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as SpendCategory] ?? category;
}

export function LogSpendSheet({
  open,
  onClose,
  me,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<SpendCategory>('dining');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (open) {
      setText('');
      setNote('');
      setCategory('dining');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordSpend(me.id, { amountMinor: minor, category, note: note.trim() || undefined });
      onChanged();
      toast(`Logged ${money(minor)} for ${categoryLabel(category).toLowerCase()}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Log a spend" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="muted">
          For spending outside the wallet, like coffee or a bus pass. Only you can see it, and it does not change your wallet balance.
        </p>
        <div className="field">
          <label className="label" htmlFor="spend-amount">Amount</label>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input id="spend-amount" className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="label" id="spend-cat">Category</span>
          <div className="chips" role="group" aria-labelledby="spend-cat">
            {SPEND_CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="spend-note">Note <span className="faint">(optional)</span></label>
          <input id="spend-note" className="input" maxLength={120} placeholder="Coffee with Sam" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={minor === null || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  );
}
