import { useState, type FormEvent } from 'react';
import { api, dollarsToMinor, SPEND_CATEGORIES, type HabitsHome, type SpendCategory } from './api.js';

function label(c: SpendCategory): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function HabitsPanel({
  accountId,
  habits,
  busy,
  onLogged,
}: {
  accountId: string;
  habits: HabitsHome;
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

  const weekly = habits.weekly;

  return (
    <div className="bb-habits">
      <p className="bb-habits-hero">{weekly.totalThisWeek}</p>
      <p className="bb-dim bb-pad">{weekly.weekOverWeek}</p>
      {weekly.highlights.length > 0 && (
        <ul className="bb-habit-trends">
          {weekly.highlights.map((h) => (
            <li key={h.category}>
              <span>{label(h.category)}</span>
              <span className="bb-dim">{h.thisWeek} · {h.direction}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="bb-habit-form" onSubmit={(e) => void submit(e)}>
        <div className="bb-habit-row">
          <input
            className="bb-habit-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="$0"
            aria-label="Log amount"
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
          placeholder="Note (optional)"
          maxLength={140}
          disabled={busy}
        />
        <button type="submit" className="bb-btn-chip" disabled={busy}>LOG</button>
        {error && <p className="bb-err">{error}</p>}
      </form>
      <p className="bb-dim bb-pad">30d logged {habits.summary30d.totalSpent} · {habits.summary30d.entryCount} entries</p>
    </div>
  );
}
