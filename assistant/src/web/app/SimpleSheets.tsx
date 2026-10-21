import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  api,
  dollarsToMinor,
  INCOME_SOURCES,
  SPEND_CATEGORIES,
  type AccountRef,
  type IncomeSource,
  type SpendCategory,
  type SpendEntry,
} from '../api.js';
import { categoryLabel, categoryMeta } from './categories.js';
import { money } from './format.js';
import { recordIncomeMutation, recordSpendMutation } from './ledger-mutations.js';
import type { OptimisticMutation, OptimisticResult } from './ledger-store.js';
import { Sheet, useToast } from './ui.js';

type WalletRun = (mutation: OptimisticMutation) => Promise<OptimisticResult>;

export { categoryLabel } from './categories.js';

const QUICK = [2500, 5000, 10_000, 25_000];
const SOURCE_LABELS: Record<IncomeSource, string> = {
  salary: 'Salary',
  freelance: 'Freelance',
  gift: 'Gift',
  refund: 'Refund',
  other: 'Other',
};

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
      toast(`Added ${money(minor)} to your Settle wallet`, { tone: 'good' });
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

export function IncomeSheet({
  open,
  onClose,
  me,
  onChanged,
  walletRun,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  onChanged: () => Promise<void>;
  walletRun?: WalletRun;
  onLogged?: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [source, setSource] = useState<IncomeSource>('salary');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (open) {
      setText('');
      setNote('');
      setSource('salary');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      if (walletRun) {
        const result = await walletRun(recordIncomeMutation(me.id, minor, source, note.trim() || undefined));
        if (!result.ok) throw new Error(result.error ?? 'Could not log income');
      } else {
        await api.recordIncome(me.id, { amountMinor: minor, source, note: note.trim() || undefined });
        await onChanged();
      }
      onLogged?.();
      toast(`${money(minor)} of ${SOURCE_LABELS[source].toLowerCase()} logged`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Log income" subtitle="Money that arrived. It feeds your month, not your Settle wallet." onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="field">
          <label className="label" htmlFor="income-amount">Amount</label>
          <div className="amount-input">
            <span aria-hidden="true">$</span>
            <input id="income-amount" className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="label" id="income-source">Where from?</span>
          <div className="chips" role="group" aria-labelledby="income-source">
            {INCOME_SOURCES.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="income-note">Note <span className="faint">(optional)</span></label>
          <input id="income-note" className="input" maxLength={120} placeholder="October paycheck" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={minor === null || busy}>
          {busy ? 'Saving…' : minor === null ? 'Log income' : `Log ${money(minor)}`}
        </button>
      </form>
    </Sheet>
  );
}

export function LogSpendSheet({
  open,
  onClose,
  me,
  recent = [],
  initialCategory,
  initialAmount,
  onChanged,
  walletRun,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  recent?: SpendEntry[];
  initialCategory?: SpendCategory;
  initialAmount?: number;
  onChanged: () => Promise<void>;
  walletRun?: WalletRun;
  onLogged?: () => void;
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
      setText(initialAmount ? (initialAmount / 100).toFixed(initialAmount % 100 === 0 ? 0 : 2) : '');
      setCategory(initialCategory ?? 'dining');
      setNote('');
      setError(null);
      setBusy(false);
    }
  }, [open, initialCategory, initialAmount]);

  const again = useMemo(() => {
    const seen = new Set<string>();
    const rows: SpendEntry[] = [];
    for (const entry of recent) {
      const key = `${entry.category}|${entry.note ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(entry);
      if (rows.length === 3) break;
    }
    return rows;
  }, [recent]);

  async function submit() {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      let spendId: string | undefined;
      if (walletRun) {
        const base = recordSpendMutation(me.id, minor, category, note.trim() || undefined);
        const result = await walletRun({
          ...base,
          commit: async () => {
            const created = await api.recordSpend(me.id, {
              amountMinor: minor,
              category,
              note: note.trim() || undefined,
            });
            spendId = created.id;
          },
        });
        if (!result.ok) throw new Error(result.error ?? 'Could not log spend');
      } else {
        const result = await api.recordSpend(me.id, { amountMinor: minor, category, note: note.trim() || undefined });
        spendId = result.id;
        await onChanged();
      }
      onLogged?.();
      toast(`Logged ${money(minor)} · ${categoryLabel(category)}`, {
        tone: 'good',
        action: spendId
          ? {
          label: 'Undo',
          onClick: () => {
            void api.deleteSpend(me.id, spendId!)
              .then(async () => {
                await onChanged();
                toast('Log removed');
              })
              .catch((e: Error) => toast(e.message, { tone: 'bad' }));
          },
        }
          : undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Log a spend"
      subtitle="What left your pocket? Two taps and you're done."
      size="wide"
      onClose={onClose}
    >
      <form className="log-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="log-amount">
          <span aria-hidden="true">$</span>
          <input
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Amount"
          />
        </div>

        <div className="chips log-quick" role="group" aria-label="Quick amounts">
          {QUICK.map((q) => (
            <button key={q} type="button" className="chip" aria-pressed={minor === q} onClick={() => setText(String(q / 100))}>
              {money(q)}
            </button>
          ))}
        </div>

        {again.length > 0 ? (
          <div className="again">
            <p className="eyebrow">Again?</p>
            <div className="chips">
              {again.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chip chip-again"
                  onClick={() => {
                    setCategory(entry.category);
                    setNote(entry.note ?? '');
                    setText((entry.amountMinor / 100).toFixed(entry.amountMinor % 100 === 0 ? 0 : 2));
                  }}
                >
                  {categoryMeta(entry.category).emoji} {entry.note || categoryLabel(entry.category)} · {entry.amount}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="field">
          <span className="label" id="spend-cat">What was it?</span>
          <div className="cat-grid" role="group" aria-labelledby="spend-cat">
            {SPEND_CATEGORIES.map((c) => {
              const meta = categoryMeta(c);
              return (
                <button
                  key={c}
                  type="button"
                  className="cat-tile"
                  aria-pressed={category === c}
                  style={{ '--cat': meta.color } as CSSProperties}
                  onClick={() => setCategory(c)}
                >
                  <span className="cat-emoji" aria-hidden="true">{meta.emoji}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="spend-note">Note <span className="faint">(optional)</span></label>
          <input id="spend-note" className="input" maxLength={120} placeholder="Coffee with Sam" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <p className="hint">Only you see this. It never moves money or changes your Settle wallet.</p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={minor === null || busy}>
          {busy ? 'Saving…' : minor === null ? 'Log it' : `Log ${money(minor)}`}
        </button>
      </form>
    </Sheet>
  );
}
