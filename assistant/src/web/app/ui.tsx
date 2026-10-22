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
import { shouldDismissSheet } from './sheet-dismiss.js';

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
  chevronDown: 'M6 9l6 6 6-6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  flame: 'M12 3c1 3-1 4-1 6a3 3 0 0 0 6 0c0-1-.3-2-1-3 3 2 5 5 5 8a9 9 0 1 1-18 0c0-4 3-7 6-9-1 2-1 3 0 4 1-2 2-4 3-6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  card: 'M3 7h18v11H3V7zM3 10h18M7 15h4',
  wallet: 'M4 6h14a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6zm0 0V5a1 1 0 0 1 1-1h11M16 13h.01',
  calendar: 'M4 6h16v14H4V6zM8 3v5M16 3v5M4 11h16',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-3v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L6.6 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H5v-3h.4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L6.6 8 8.7 5.9l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V4h3v.7a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.4v3H21a1.7 1.7 0 0 0-1.6 1z',
  undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  lock: 'M6 11h12v9H6v-9zM8 11V8a4 4 0 0 1 8 0v3',
  coffee: 'M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8zM16 9h2a2 2 0 0 1 0 4h-2M4 21h14',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
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

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastApi {
  toast: (message: string, options?: { action?: ToastAction; tone?: 'default' | 'good' | 'bad' }) => void;
}
const ToastContext = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(ToastContext).toast;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; action?: ToastAction; tone: 'default' | 'good' | 'bad' }[]>([]);
  const nextId = useRef(1);
  const toast = useCallback<ToastApi['toast']>((message, options) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, action: options?.action, tone: options?.tone ?? 'default' }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), options?.action ? 7000 : 4500);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.onClick();
                  setItems((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Sheet: a modal built on <dialog>, so focus trapping and Escape come from the browser ---------- */

export function Sheet({
  open,
  title,
  subtitle,
  size = 'default',
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  size?: 'default' | 'wide';
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDownTarget = useRef<EventTarget | null>(null);
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
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDownCapture={(e) => {
        pointerDownTarget.current = e.target;
      }}
      onClick={(e) => {
        if (shouldDismissSheet(panelRef.current, pointerDownTarget.current, e.target)) onClose();
        pointerDownTarget.current = null;
      }}
    >
      <div className="app-sheet-wrap">
        <div
          ref={panelRef}
          className={`app-sheet-panel${size === 'wide' ? ' app-sheet-panel-wide' : ''}`}
        >
          <div className="app-sheet-head">
            <div>
              <h2 id="sheet-title">{title}</h2>
              {subtitle ? <p className="app-sheet-sub">{subtitle}</p> : null}
            </div>
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

/* ---------- Small data visuals ---------- */

export function ProgressRing({
  value,
  size = 116,
  stroke = 10,
  tone = 'accent',
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'onDark';
  label?: string;
  children?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`ring ring-${tone}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

/* Chrome flakes, not party confetti — the celebration has to look like the house. */
const CONFETTI_COLORS = ['#ffffff', '#d9d9d5', '#b9b9b3', '#8f8f8a', '#fdfdfb', '#6f6f6a'];

/** A short, CSS-only celebration. Key it with a changing number to replay. */
export function Confetti({ burst }: { burst: number }) {
  if (!burst) return null;
  return (
    <div className="confetti" aria-hidden="true" key={burst}>
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${8 + ((i * 37) % 84)}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 7) * 35}ms`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
