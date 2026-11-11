import { describe, expect, it } from 'vitest';
import {
  NO_GESTURE,
  initialNavDrawer,
  isDrawerOpen,
  navDrawerReducer,
  shouldCloseFromScrim,
  shouldFocusMenuAfterRouteChange,
  type NavDrawerEvent,
  type NavDrawerState,
} from '../src/web/app/nav-drawer.js';

/** Runs events in order, the way the shell does on a phone. */
function run(events: NavDrawerEvent[], mobile = true): NavDrawerState {
  return events.reduce(navDrawerReducer, initialNavDrawer(mobile));
}

describe('scrim click without a preceding pointerdown', () => {
  it('closes a drawer that was opened by a pointer tap', () => {
    const state = run([
      { type: 'menu-press', gesture: 4 },
      { type: 'scrim-press', gesture: null },
    ]);

    expect(isDrawerOpen(state)).toBe(false);
    expect(state.openedBy).toBeNull();
  });

  it('closes a drawer that was opened from the keyboard', () => {
    const state = run([
      { type: 'menu-press', gesture: NO_GESTURE },
      { type: 'scrim-press', gesture: null },
    ]);

    expect(isDrawerOpen(state)).toBe(false);
    expect(state.openedBy).toBeNull();
  });

  it('still ignores the click that is the tail of the opening tap', () => {
    const opened = run([{ type: 'menu-press', gesture: 5 }]);

    expect(shouldCloseFromScrim(opened, 5)).toBe(false);
    expect(isDrawerOpen(navDrawerReducer(opened, { type: 'scrim-press', gesture: 5 }))).toBe(true);
    // The same click without pointer detail has no gesture to blame.
    expect(shouldCloseFromScrim(opened, null)).toBe(true);
  });

  it('does not close a closed drawer, or a docked desktop sidebar', () => {
    expect(shouldCloseFromScrim(initialNavDrawer(true), null)).toBe(false);
    expect(shouldCloseFromScrim(initialNavDrawer(false), null)).toBe(false);
    expect(shouldCloseFromScrim({ open: true, mobile: false, openedBy: null }, null)).toBe(false);
  });
});

describe('route change focus handoff', () => {
  const opened = run([{ type: 'menu-press', gesture: 3 }]);

  it('moves focus to the menu button when focus was inside the drawer', () => {
    expect(shouldFocusMenuAfterRouteChange(opened, true)).toBe(true);
  });

  it('leaves focus alone when it was outside the drawer', () => {
    expect(shouldFocusMenuAfterRouteChange(opened, false)).toBe(false);
  });

  it('does not pull focus for a drawer that is already closed', () => {
    const closed = navDrawerReducer(opened, { type: 'route-change' });
    expect(isDrawerOpen(closed)).toBe(false);
    expect(shouldFocusMenuAfterRouteChange(closed, true)).toBe(false);
    expect(shouldFocusMenuAfterRouteChange(initialNavDrawer(false), true)).toBe(false);
  });

  it('closes the open drawer on a route change', () => {
    const closed = navDrawerReducer(opened, { type: 'route-change' });
    expect(isDrawerOpen(closed)).toBe(false);
    expect(closed.openedBy).toBeNull();
  });
});
