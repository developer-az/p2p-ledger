import { useState, type FormEvent } from 'react';
import { api, dollarsToMinor, SPEND_CATEGORIES, type SpendCategory } from './api.js';

function label(c: SpendCategory): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Quick capture — appears in ACTIVITY feed as "You logged". */
export function LogSpendForm({
  accountId,
  busy,
  onLogged,
}: {
  accountId: string;
  busy: boolean;
  onLogged: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<SpendCategory>('dining');
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
      await api.recordSpend(accountId, { amountMinor: minor, category, note: note.trim() || undefined });
      setAmount('');
      setNote('');
      onLogged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="bb-habit-form" onSubmit={(e) => void submit(e)}>
      <p className="bb-dim bb-pad">Log spending you care about (not synced from a bank).</p>
      <div className="bb-habit-row">
        <input
          className="bb-habit-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          aria-label="Amount"
          disabled={busy}
        />
        <select
          className="bb-habit-select"
          value={category}
          onChange={(e) => setCategory(e.target.value as SpendCategory)}
          aria-label="Category"
          disabled={busy}
        >
          {SPEND_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
        </select>
      </div>
      <input
        className="bb-habit-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was it? (optional)"
        maxLength={140}
        disabled={busy}
      />
      <button type="submit" className="bb-btn-chip" disabled={busy}>Add to activity</button>
      {error && <p className="bb-err">{error}</p>}
    </form>
  );
}
