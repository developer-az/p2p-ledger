import { useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { Icon, type IconName } from './ui.js';

/**
 * Navigation for THE AURA.
 *
 * A single floating dock replaces the old sticky tab bar and mobile bottom bar.
 * It floats above the content at every width, so navigation never competes with
 * the layout — the page reads as one continuous house look, and the controls sit
 * on top of it like a plinth.
 *
 * Two ways in, because the audience is split: snappy taps for the crypto-native,
 * and swipe for everyone who expects a phone to behave like a phone. Swipe is
 * horizontal-only and ignores gestures that are mostly vertical, so scrolling the
 * gallery never changes tab.
 */

export interface DockTab<T extends string> {
  id: T;
  label: string;
  icon: IconName;
}

/** Below this horizontal travel (px) a gesture is a tap, not a swipe. */
const SWIPE_THRESHOLD = 56;
/** If vertical travel beats horizontal, the person was scrolling — do nothing. */
const DOMINANCE = 1.2;

/**
 * Pure decision function: -1 = previous tab, 1 = next tab, 0 = no change.
 * Exported so the gesture contract is unit-testable without a DOM.
 */
export function swipeStep(dx: number, dy: number, threshold = SWIPE_THRESHOLD): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold) return 0;
  if (Math.abs(dy) * DOMINANCE > Math.abs(dx)) return 0;
  // Swiping left (negative dx) reveals the next page — the standard phone idiom.
  return dx < 0 ? 1 : -1;
}

/**
 * Swipe-to-navigate for the main pane. Attach the returned handlers to the
 * scrolling container. Movement stays off the dock, so the dock is still a
 * plain tap target.
 */
export function useSwipeNav<T extends string>(
  ids: readonly T[],
  active: T,
  onSelect: (id: T) => void,
) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    const origin = start.current;
    start.current = null;
    const touch = e.changedTouches[0];
    if (!origin || !touch) return;
    const step = swipeStep(touch.clientX - origin.x, touch.clientY - origin.y);
    if (step === 0) return;
    const index = ids.indexOf(active) + step;
    const next = ids[index];
    if (next) onSelect(next);
  };

  return { onTouchStart, onTouchEnd };
}

export function FloatingDock<T extends string>({
  tabs,
  active,
  onSelect,
  syncing = false,
  label = 'Main',
}: {
  tabs: readonly DockTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Shows the pulse on the dock itself when a write is in flight. */
  syncing?: boolean;
  label?: string;
}) {
  return (
    <nav className="float-dock" aria-label={label}>
      <div className="float-dock-inner">
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              className="dock-item"
              aria-current={current ? 'page' : undefined}
              onClick={() => onSelect(tab.id)}
            >
              <span className="dock-icon" aria-hidden="true"><Icon name={tab.icon} size={19} /></span>
              <span className="dock-label">{tab.label}</span>
              {current && syncing ? <span className="dock-pulse" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
