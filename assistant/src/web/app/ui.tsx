import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { avatarHue, initials } from './format.js';

/* ---------- Icons: small inline SVGs so there is nothing to download ---------- */

const PATHS = {
  send: 'M5 12h14M13 6l6 6-6 6',
  receive: 'M19 12H5M11 6l-6 6 6 6',
  request: 'M12 5v14M5 12h14',
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4l10-10-4-4L4 16v4zM13 7l4 4',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  chat: 'M4 5h16v11H9l-5 4V5z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.01',
  split: 'M12 4v6M12 10L6 20M12 10l6 10',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  chevron: 'M9 6l6 6-6 6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ---------- People ---------- */

export function Avatar({ owner, small = false }: { owner: string; small?: boolean }) {
  return (
    <span
      className={`avatar${small ? ' avatar-sm' : ''}`}
      style={{ background: `hsl(${avatarHue(owner)} 48% 38%)` }}
      aria-hidden="true"
    >
      {initials(owner)}
    </span>
  );
}

/* ---------- Toasts ---------- */

interface ToastApi {
  toast: (message: string) => void;
}
const ToastContext = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(ToastContext).toast;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(1);
  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Sheet: a modal built on <dialog>, so focus trapping and Escape come from the browser ---------- */

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="app app-sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dimmed area (the dialog element itself or its wrapper) closes the sheet.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop) onClose();
      }}
    >
      <div className="app-sheet-wrap" data-backdrop="true">
        <div className="app-sheet-panel">
          <div className="app-sheet-head">
            <h2 id="sheet-title">{title}</h2>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </dialog>
  );
}

/* ---------- Small pieces ---------- */

export function Skeleton({ height = 20, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card-flat" style={{ textAlign: 'center', padding: '28px 16px' }}>
      <p style={{ fontWeight: 700 }}>{title}</p>
      {children ? <p className="muted" style={{ marginTop: 4 }}>{children}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-bad" role="alert">
      <strong>Something went wrong.</strong> <span>{message}</span>
      {onRetry ? (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}
