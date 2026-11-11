/**
 * State for the mobile navigation drawer.
 *
 * The drawer opens from the menu button and closes on a scrim tap, Escape, a
 * nav link or a route change. A touch tap is not one event: it produces
 * `pointerdown`, `pointerup` and then a synthesized `click`, and a browser may
 * deliver that tail to whatever element now sits under the finger. The scrim
 * mounts during the tap that opens the drawer, so it can be handed the end of
 * the same tap that opened it.
 *
 * Every press therefore carries the sequence number of the gesture that
 * produced it, and a scrim press is ignored when it belongs to the gesture
 * that opened the drawer. A later, separate tap gets a new number and closes
 * it. Keeping the rule here, pure, lets the shell stay a thin wire and lets
 * the open/close behaviour be tested without a DOM.
 */

/** Matches `@media (max-width: 767px)` in styles/shell.css. */
export const DRAWER_MEDIA_QUERY = '(max-width: 767px)';

/** A press with no pointer behind it (keyboard, palette, `[` shortcut). */
export const NO_GESTURE = 0;

export interface NavDrawerState {
  /** The drawer is showing. */
  open: boolean;
  /** The viewport is narrow enough for a drawer; wider windows dock the sidebar. */
  mobile: boolean;
  /** The gesture that opened the drawer, or null while it is closed. */
  openedBy: number | null;
}

export type NavDrawerEvent =
  /** The menu button (or the `[` shortcut) was pressed. */
  | { type: 'menu-press'; gesture: number }
  /** The scrim was pressed. */
  | { type: 'scrim-press'; gesture: number }
  /** A nav link navigated; the drawer closes behind it. */
  | { type: 'navigate' }
  /** Escape. */
  | { type: 'escape' }
  /** The route changed (back/forward, palette); the drawer must not linger. */
  | { type: 'route-change' }
  /** The viewport crossed the 768px line. */
  | { type: 'viewport'; mobile: boolean }
  /** Close without a reason of its own. */
  | { type: 'close' };

export function initialNavDrawer(mobile: boolean): NavDrawerState {
  return { open: false, mobile, openedBy: null };
}

/** True when the drawer is visible. A desktop sidebar is not a drawer. */
export function isDrawerOpen(state: NavDrawerState): boolean {
  return state.open && state.mobile;
}

/**
 * A scrim press closes the drawer unless it is the tail of the tap that opened
 * it. The scrim only exists on mobile and only while the drawer is open.
 */
export function shouldCloseFromScrim(state: NavDrawerState, gesture: number): boolean {
  return isDrawerOpen(state) && state.openedBy !== gesture;
}

function close(state: NavDrawerState): NavDrawerState {
  if (!state.open && state.openedBy === null) return state;
  return { ...state, open: false, openedBy: null };
}

export function navDrawerReducer(state: NavDrawerState, event: NavDrawerEvent): NavDrawerState {
  switch (event.type) {
    case 'menu-press':
      if (!state.mobile) return state;
      if (state.open) return close(state);
      return { mobile: true, open: true, openedBy: event.gesture };
    case 'scrim-press':
      if (!shouldCloseFromScrim(state, event.gesture)) return state;
      return close(state);
    case 'navigate':
    case 'escape':
    case 'route-change':
    case 'close':
      return close(state);
    case 'viewport':
      if (event.mobile === state.mobile) return state;
      // Crossing into desktop docks the sidebar; crossing back starts closed.
      return { mobile: event.mobile, open: false, openedBy: null };
  }
}
