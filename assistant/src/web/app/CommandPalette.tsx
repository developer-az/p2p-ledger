import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import './styles/palette.css';
import { rankPalette, type PaletteItem } from './palette.js';

/**
 * One palette row with its action attached. Ranking stays in `palette.ts`;
 * `amount` is a string the caller has already formatted, because ranking never
 * touches money.
 */
export interface PaletteRow extends PaletteItem {
  run: () => void;
  amount?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly PaletteRow[];
  transactions: readonly PaletteRow[];
}

/** Matches the module default, stated here so the cap is visible at the call site. */
const MAX_TRANSACTIONS = 8;

/**
 * The command palette: a modal combobox over commands and transactions.
 *
 * The active row is tracked by index over the rendered order, so keyboard and
 * mouse always agree. Rows keep the ranking inside their group, and both
 * groups are rendered as one listbox with presentational headings.
 */
export function CommandPalette({ open, onClose, commands, transactions }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rawId = useId();
  const baseId = rawId.replace(/:/g, '');
  const listboxId = `palette-listbox-${baseId}`;

  const { commandRows, transactionRows, visible } = useMemo(() => {
    const byId = new Map<string, PaletteRow>();
    for (const command of commands) byId.set(command.id, command);
    for (const transaction of transactions) byId.set(transaction.id, transaction);
    const ranked = rankPalette(query, commands, transactions, { maxTransactions: MAX_TRANSACTIONS });
    const resolved: PaletteRow[] = [];
    for (const item of ranked) {
      const row = byId.get(item.id);
      if (row !== undefined) resolved.push(row);
    }
    const rankedCommands = resolved.filter((row) => row.kind === 'command');
    const rankedTransactions = resolved.filter((row) => row.kind === 'transaction');
    return {
      commandRows: rankedCommands,
      transactionRows: rankedTransactions,
      visible: [...rankedCommands, ...rankedTransactions],
    };
  }, [commands, query, transactions]);

  const active = visible.length === 0 ? -1 : Math.min(activeIndex, visible.length - 1);

  const optionId = (index: number) => `palette-option-${baseId}-${index}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setActiveIndex(0);
      if (!dialog.open) dialog.showModal();
      inputRef.current?.focus();
      return;
    }
    if (dialog.open) dialog.close();
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore !== null && restore.isConnected) restore.focus();
  }, [open]);

  // Keep the active row on screen while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const runRow = (row: PaletteRow) => {
    row.run();
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex((index) => (index + 1) % visible.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex((index) => (index - 1 + visible.length) % visible.length);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex(visible.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = active >= 0 ? visible[active] : undefined;
      if (row !== undefined) runRow(row);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const group = (title: string, rows: PaletteRow[], offset: number) => {
    if (rows.length === 0) return null;
    return (
      <div className="palette-group" key={title}>
        <p className="palette-group-label" aria-hidden="true">{title}</p>
        {rows.map((row, index) => {
          const flat = offset + index;
          const selected = flat === active;
          return (
            <div
              key={row.id}
              id={optionId(flat)}
              ref={selected ? activeRef : undefined}
              role="option"
              aria-selected={selected}
              className="palette-row"
              onMouseEnter={() => setActiveIndex(flat)}
              onClick={() => runRow(row)}
            >
              <span className="palette-row-label">{row.label}</span>
              {row.hint ? <span className="palette-row-hint">{row.hint}</span> : null}
              {row.amount ? <span className="palette-row-amount num">{row.amount}</span> : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="app palette-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette-panel glass">
        <input
          ref={inputRef}
          type="text"
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Search commands and transactions"
          placeholder="Search commands and transactions"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div id={listboxId} className="palette-list" role="listbox" aria-label="Results">
          {visible.length === 0 ? (
            <p className="palette-empty">No matches</p>
          ) : (
            <>
              {group('Commands', commandRows, 0)}
              {group('Transactions', transactionRows, commandRows.length)}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
