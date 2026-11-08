import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { m, useReducedMotion } from 'motion/react';
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
import { Pip } from './Pip.js';
import { Sheet, useToast } from './ui.js';

type WalletRun = (mutation: OptimisticMutation) => Promise<OptimisticResult>;

export type AddMode = 'spent' | 'got';

const SOURCES: Record<IncomeSource, { label: string; emoji: string }> = {
  salary: { label: 'Paycheck', emoji: '💼' },
  freelance: { label: 'Side work', emoji: '🧰' },
  gift: { label: 'Gift', emoji: '🎁' },
  refund: { label: 'Refund', emoji: '↩️' },
  other: { label: 'Other', emoji: '✨' },
};

/**
 * One sheet for everything you add. Type the amount, then tap what it was:
 * the tap is the save, so a spend is two taps and there is no "Log" button to
 * find. "I got paid" swaps the tiles for income sources. A repeat of a recent
 * log is one tap, with Undo on the toast.
 */
export function AddSheet({
  open,
  onClose,
  me,
  recent = [],
  initialMode = 'spent',
  initialCategory,
  initialAmount,
  onChanged,
  walletRun,
  onSpent,
  onIncome,
  onSplit,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  recent?: SpendEntry[];
  initialMode?: AddMode;
  initialCategory?: SpendCategory;
  initialAmount?: number;
  onChanged: () => Promise<void>;
  walletRun?: WalletRun;
  onSpent?: () => void;
  onIncome?: () => void;
  onSplit?: () => void;
}) {
  const toast = useToast();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<AddMode>(initialMode);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A tile tapped before there was an amount: saved as soon as one is typed and Enter pressed.
  const [pending, setPending] = useState<SpendCategory | IncomeSource | null>(null);
  const [nudge, setNudge] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const pendingSpend = useRef<{ body: string; key: string } | null>(null);
  const minor = dollarsToMinor(text);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setText(initialAmount ? (initialAmount / 100).toFixed(initialAmount % 100 === 0 ? 0 : 2) : '');
    setPending(initialCategory ?? null);
    setNote('');
    setNoteOpen(false);
    setError(null);
    setBusy(null);
  }, [open, initialMode, initialCategory, initialAmount]);

  const again = useMemo(() => {
    const seen = new Set<string>();
    const rows: SpendEntry[] = [];
    for (const entry of recent) {
      const key = `${entry.category}|${entry.note ?? ''}|${entry.amountMinor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(entry);
      if (rows.length === 3) break;
    }
    return rows;
  }, [recent]);

  async function saveSpend(amountMinor: number, category: SpendCategory, noteText?: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(category);
    setError(null);
    try {
      let spendId: string | undefined;
      const body = { amountMinor, category, note: noteText?.trim() || undefined };
      const serialized = JSON.stringify({ accountId: me.id, ...body });
      if (pendingSpend.current?.body !== serialized)
        pendingSpend.current = { body: serialized, key: crypto.randomUUID() };
      const requestKey = pendingSpend.current.key;
      if (walletRun) {
        const base = recordSpendMutation(me.id, amountMinor, category, body.note);
        const result = await walletRun({
          ...base,
          commit: async () => {
            const created = await api.recordSpend(me.id, body, requestKey);
            spendId = created.id;
          },
        });
        if (!result.ok) throw new Error(result.error ?? 'Could not log spend');
      } else {
        const result = await api.recordSpend(me.id, body, requestKey);
        spendId = result.id;
        await onChanged();
      }
      pendingSpend.current = null;
      onSpent?.();
      toast(`${categoryMeta(category).emoji} ${money(amountMinor)} · ${categoryLabel(category)}`, {
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
      saving.current = false;
      setBusy(null);
    }
  }

  async function saveIncome(amountMinor: number, source: IncomeSource) {
    if (saving.current) return;
    saving.current = true;
    setBusy(source);
    setError(null);
    try {
      const noteText = note.trim() || undefined;
      if (walletRun) {
        const result = await walletRun(recordIncomeMutation(me.id, amountMinor, source, noteText));
        if (!result.ok) throw new Error(result.error ?? 'Could not log income');
      } else {
        await api.recordIncome(me.id, { amountMinor, source, note: noteText });
        await onChanged();
      }
      onIncome?.();
      toast(`${SOURCES[source].emoji} ${money(amountMinor)} in · ${SOURCES[source].label}`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  /** A tile tap: save if there is an amount, otherwise remember it and ask for one. */
  function pick(choice: SpendCategory | IncomeSource) {
    if (busy) return;
    if (minor === null) {
      setPending(choice);
      setNudge((n) => n + 1);
      amountRef.current?.focus();
      return;
    }
    if (mode === 'spent') void saveSpend(minor, choice as SpendCategory, note);
    else void saveIncome(minor, choice as IncomeSource);
  }

  function submitFromKeyboard() {
    if (minor === null) {
      setNudge((n) => n + 1);
      return;
    }
    if (!pending) {
      setError(mode === 'spent' ? 'Now tap what it was.' : 'Now tap where it came from.');
      return;
    }
    pick(pending);
  }

  const switchMode = (next: AddMode) => {
    if (saving.current || next === mode) return;
    setMode(next);
    setPending(null);
    setError(null);
  };

  const prompt = minor === null
    ? mode === 'spent' ? 'How much?' : 'How much came in?'
    : mode === 'spent' ? 'Now tap what it was' : 'Now tap where it came from';

  return (
    <Sheet
      open={open}
      title={mode === 'spent' ? 'Add a spend' : 'Add money in'}
      subtitle="Type it, tap it, done."
      size="wide"
      onClose={() => { if (!saving.current) onClose(); }}
    >
      <form
        className={`add-form is-${mode}`}
        onSubmit={(e) => { e.preventDefault(); submitFromKeyboard(); }}
      >
        <div className="add-top">
          <Pip size={58} mood={minor === null ? 'calm' : 'happy'} idle={false} className="add-pip" />
          <div className="add-switch" role="radiogroup" aria-label="What happened">
            <span className="add-switch-thumb" aria-hidden="true" />
            <button type="button" role="radio" disabled={busy !== null} aria-checked={mode === 'spent'} onClick={() => switchMode('spent')}>I spent</button>
            <button type="button" role="radio" disabled={busy !== null} aria-checked={mode === 'got'} onClick={() => switchMode('got')}>I got paid</button>
          </div>
        </div>

        <m.div
          key={nudge}
          className={`add-amount${minor !== null ? ' has-value' : ''}`}
          initial={false}
          animate={nudge && !reduce ? { x: [0, -9, 8, -5, 3, 0] } : undefined}
          transition={{ duration: 0.45 }}
        >
          <span aria-hidden="true">{mode === 'got' ? '+$' : '$'}</span>
          <input
            ref={amountRef}
            disabled={busy !== null}
            data-autofocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            aria-label="Amount"
            aria-describedby="add-prompt"
          />
        </m.div>
        <p className="add-prompt" id="add-prompt" aria-live="polite">{prompt}</p>

        {mode === 'spent' && again.length > 0 ? (
          <div className="add-again" role="group" aria-label="Log a recent spend again">
            {again.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="add-again-chip"
                disabled={busy !== null}
                onClick={() => void saveSpend(entry.amountMinor, entry.category, entry.note ?? undefined)}
              >
                <span aria-hidden="true">{categoryMeta(entry.category).emoji}</span>
                {entry.note || categoryLabel(entry.category)}
                <b>{entry.amount}</b>
              </button>
            ))}
          </div>
        ) : null}

        <div className="add-tiles" role="group" aria-label={mode === 'spent' ? 'What was it' : 'Where it came from'}>
          {(mode === 'spent' ? SPEND_CATEGORIES : INCOME_SOURCES).map((choice, i) => {
            const meta = mode === 'spent'
              ? categoryMeta(choice)
              : { ...SOURCES[choice as IncomeSource], color: '#14804a' };
            return (
              <m.button
                key={`${mode}-${choice}`}
                type="button"
                className={`add-tile${pending === choice ? ' is-pending' : ''}`}
                style={{ '--cat': meta.color } as CSSProperties}
                disabled={busy !== null}
                aria-busy={busy === choice}
                onClick={() => pick(choice)}
                initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26, delay: i * 0.025 }}
                whileTap={reduce ? undefined : { scale: 0.94 }}
              >
                <span className="add-tile-emoji" aria-hidden="true">{meta.emoji}</span>
                <span>{meta.label}</span>
              </m.button>
            );
          })}
        </div>

        {noteOpen ? (
          <input
            className="input add-note"
            disabled={busy !== null}
            maxLength={120}
            autoFocus
            placeholder={mode === 'spent' ? 'Coffee with Sam' : 'October paycheck'}
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        ) : (
          <button type="button" className="add-note-toggle" disabled={busy !== null} onClick={() => setNoteOpen(true)}>+ Add a note</button>
        )}

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <div className="add-foot">
          <span>Only you see this. It never moves money.</span>
          {onSplit ? <button type="button" className="link-btn" disabled={busy !== null} onClick={onSplit}>Splitting a bill? →</button> : null}
        </div>
        {/* Enter in the amount field saves with the tile picked earlier. */}
        <button type="submit" className="sr-only" tabIndex={-1}>Save</button>
      </form>
    </Sheet>
  );
}
