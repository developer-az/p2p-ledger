import { describe, expect, it } from 'vitest';
import {
  DRAWER_MEDIA_QUERY,
  NO_GESTURE,
  initialNavDrawer,
  isDrawerOpen,
  navDrawerReducer,
  shouldCloseFromScrim,
  type NavDrawerEvent,
  type NavDrawerState,
} from '../src/web/app/nav-drawer.js';

/** Runs a list of events in order, the way the shell does on a phone. */
function run(events: NavDrawerEvent[], mobile = true): NavDrawerState {
  return events.reduce(navDrawerReducer, initialNavDrawer(mobile));
}

describe('mobile nav drawer state', () => {
  it('matches the shell media query', () => {
    expect(DRAWER_MEDIA_QUERY).toBe('(max-width: 767px)');
  });

  it('starts closed on mobile', () => {
    const state = initialNavDrawer(true);
    expect(state.open).toBe(false);
    expect(state.openedBy).toBeNull();
    expect(isDrawerOpen(state)).toBe(false);
  });

  it('opens on a menu press and remembers the gesture', () => {
    const state = run([{ type: 'menu-press', gesture: 7 }]);
    expect(isDrawerOpen(state)).toBe(true);
    expect(state.openedBy).toBe(7);
  });

  it('opens on a keyboard press that has no gesture behind it', () => {
    const state = run([{ type: 'menu-press', gesture: NO_GESTURE }]);
    expect(isDrawerOpen(state)).toBe(true);
    expect(state.openedBy).toBe(NO_GESTURE);
  });

  it('ignores the scrim press left over from the opening tap', () => {
    // pointerdown(7) -> click on the menu button (opens) -> click re-targeted
    // at the freshly mounted scrim, still gesture 7.
    const state = run([
      { type: 'menu-press', gesture: 7 },
      { type: 'scrim-press', gesture: 7 },
    ]);
    expect(isDrawerOpen(state)).toBe(true);
    expect(shouldCloseFromScrim(state, 7)).toBe(false);
  });

  it('closes on a scrim press from a later gesture', () => {
    const state = run([
      { type: 'menu-press', gesture: 7 },
      { type: 'scrim-press', gesture: 8 },
    ]);
    expect(isDrawerOpen(state)).toBe(false);
    expect(state.openedBy).toBeNull();
    expect(shouldCloseFromScrim(state, 9)).toBe(false);
  });

  it('closes when the menu button is pressed again', () => {
    const state = run([
      { type: 'menu-press', gesture: 1 },
      { type: 'menu-press', gesture: 2 },
    ]);
    expect(isDrawerOpen(state)).toBe(false);
    expect(state.openedBy).toBeNull();
  });

  it('closes on Escape, a nav link tap and a route change', () => {
    for (const event of [
      { type: 'escape' },
      { type: 'navigate' },
      { type: 'route-change' },
      { type: 'close' },
    ] as NavDrawerEvent[]) {
      const state = run([{ type: 'menu-press', gesture: 3 }, event]);
      expect(isDrawerOpen(state), event.type).toBe(false);
      expect(state.openedBy, event.type).toBeNull();
    }
  });

  it('keeps the same state object when a closing event changes nothing', () => {
    const closed = initialNavDrawer(true);
    expect(navDrawerReducer(closed, { type: 'escape' })).toBe(closed);
    expect(navDrawerReducer(closed, { type: 'scrim-press', gesture: 4 })).toBe(closed);
    expect(navDrawerReducer(closed, { type: 'navigate' })).toBe(closed);
  });

  it('ignores menu presses on desktop, where the sidebar is docked', () => {
    const state = run([{ type: 'menu-press', gesture: 1 }], false);
    expect(state.open).toBe(false);
    expect(isDrawerOpen(state)).toBe(false);
    // A desktop sidebar is never behind a scrim, whatever the flags say.
    expect(shouldCloseFromScrim({ open: true, mobile: false, openedBy: 2 }, 3)).toBe(false);
  });

  it('closes the drawer when the viewport widens, and stays closed coming back', () => {
    const wide = run([
      { type: 'menu-press', gesture: 1 },
      { type: 'viewport', mobile: false },
    ]);
    expect(isDrawerOpen(wide)).toBe(false);
    const narrowAgain = navDrawerReducer(wide, { type: 'viewport', mobile: true });
    expect(narrowAgain.mobile).toBe(true);
    expect(isDrawerOpen(narrowAgain)).toBe(false);
  });

  it('survives a full open, navigate, reopen, scrim-close cycle', () => {
    const state = run([
      { type: 'menu-press', gesture: 10 },
      { type: 'scrim-press', gesture: 10 },
      { type: 'navigate' },
      { type: 'menu-press', gesture: 11 },
      { type: 'scrim-press', gesture: 12 },
    ]);
    expect(isDrawerOpen(state)).toBe(false);
    expect(state.openedBy).toBeNull();
  });
});
