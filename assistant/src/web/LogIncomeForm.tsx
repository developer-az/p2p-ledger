import { useState, type FormEvent } from 'react';
import { api, dollarsToMinor, INCOME_SOURCES, type IncomeSource } from './api.js';

function label(s: IncomeSource): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function LogIncomeForm({
  accountId,
  busy,
  onLogged,
}: {
  accountId: string;
  busy: boolean;
  onLogged: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<IncomeSource>('salary');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = dollarsToMinor(amount);
    if (minor === null) {
      setError('Enter a valid amount.');
      return;
    }
    setError('');
    try {
      await api.recordIncome(accountId, { amountMinor: minor, source, note: note.trim() || undefined });
      setAmount('');
      setNote('');
      onLogged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="bb-habit-form" onSubmit={(e) => void submit(e)}>
      <p className="bb-dim bb-pad">Log paycheck, side gig, or other money in (your books, not the bank feed).</p>
      <div className="bb-habit-row">
        <input
          className="bb-habit-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          aria-label="Income amount"
          disabled={busy}
        />
        <select
          className="bb-habit-select"
          value={source}
          onChange={(e) => setSource(e.target.value as IncomeSource)}
          aria-label="Income source"
          disabled={busy}
        >
          {INCOME_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
      <input
        className="bb-habit-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={140}
        disabled={busy}
      />
      <button type="submit" className="bb-btn-chip" disabled={busy}>Add income</button>
      {error && <p className="bb-err">{error}</p>}
    </form>
  );
}
