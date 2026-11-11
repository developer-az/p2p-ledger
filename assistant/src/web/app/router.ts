import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** Sidebar sections, in navigation order. */
export const APP_SECTIONS = [
  'overview',
  'transactions',
  'insights',
  'ask',
  'subscriptions',
  'forecast',
  'alerts',
  'imports',
  'rules',
  'reports',
  'settings',
] as const;

export type AppSection = (typeof APP_SECTIONS)[number];

/** Settings tabs, in navigation order. */
export const SETTINGS_TABS = [
  'profile',
  'security',
  'privacy',
  'integrations',
  'categories',
  'appearance',
  'balances',
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type Route =
  | { kind: 'landing' }
  | { kind: 'signin' }
  | { kind: 'signup' }
  | { kind: 'reset-password' }
  | { kind: 'account-access' }
  | { kind: 'google-signin' }
  | { kind: 'legal'; page: 'privacy' | 'terms' }
  | { kind: 'ops' }
  | { kind: 'app'; section: Exclude<AppSection, 'settings'> }
  | { kind: 'app'; section: 'settings'; tab?: SettingsTab };

const DEFAULT_SETTINGS_TAB: SettingsTab = 'profile';

function isSection(value: string): value is AppSection {
  return (APP_SECTIONS as readonly string[]).includes(value);
}

function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value);
}

function pathSegments(pathname: string): string[] {
  return pathname.toLowerCase().replace(/\/+$/, '').split('/').filter(Boolean);
}

/** Maps a pathname to a route. Unknown paths fall back to the landing page. */
export function parseRoute(pathname: string): Route {
  const [head, second, third] = pathSegments(pathname);
  if (head === undefined) return { kind: 'landing' };

  if (head === 'app') {
    if (second === undefined || !isSection(second)) return { kind: 'app', section: 'overview' };
    if (second === 'settings') {
      const tab = third !== undefined && isSettingsTab(third) ? third : DEFAULT_SETTINGS_TAB;
      return { kind: 'app', section: 'settings', tab };
    }
    return { kind: 'app', section: second };
  }

  if (second !== undefined) return { kind: 'landing' };

  switch (head) {
    case 'signin':
      return { kind: 'signin' };
    case 'signup':
      return { kind: 'signup' };
    case 'reset-password':
      return { kind: 'reset-password' };
    case 'account-access':
      return { kind: 'account-access' };
    case 'google-signin':
      return { kind: 'google-signin' };
    case 'privacy':
      return { kind: 'legal', page: 'privacy' };
    case 'terms':
      return { kind: 'legal', page: 'terms' };
    case 'ops':
      return { kind: 'ops' };
    default:
      return { kind: 'landing' };
  }
}

/** Canonical pathname for a route. */
function basePath(route: Route): string {
  switch (route.kind) {
    case 'landing':
      return '/';
    case 'signin':
      return '/signin';
    case 'signup':
      return '/signup';
    case 'reset-password':
      return '/reset-password';
    case 'account-access':
      return '/account-access';
    case 'google-signin':
      return '/google-signin';
    case 'legal':
      return `/${route.page}`;
    case 'ops':
      return '/ops';
    case 'app':
      if (route.section === 'settings') return `/app/settings/${route.tab ?? DEFAULT_SETTINGS_TAB}`;
      return `/app/${route.section}`;
  }
}

/** Canonical URL for a route, keeping a query string when one is given. */
export function routeHref(route: Route, search = ''): string {
  const base = basePath(route);
  const query = search.startsWith('?') ? search.slice(1) : search;
  return query ? `${base}?${query}` : base;
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** The bits of the View Transitions API this app uses. */
type ViewTransitionLike = {
  finished?: Promise<void>;
  updateCallbackDone?: Promise<void>;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};


let syncNavigation = false;

/** Pushes (or replaces) history and notifies route listeners. */
export function navigate(route: Route, opts: { replace?: boolean; search?: string } = {}): void {
  if (typeof window === 'undefined') return;
  const href = routeHref(route, opts.search ?? '');
  if (href === currentHref()) return;
  if (opts.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);

  // Route listeners commit synchronously (flushSync in useRoute), so the new
  // view is in the DOM when the update callback returns. Rendering is paused
  // inside a view-transition callback, so waiting for animation frames there
  // would stall until the browser's DOM-update timeout.
  const update = () => {
    syncNavigation = true;
    try {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } finally {
      syncNavigation = false;
    }
  };
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = (document as ViewTransitionDocument).startViewTransition;

  // Route changes cross-fade through the native View Transitions API when the
  // browser has it (styles/shell.css sets the 160ms fade). Reduced motion and
  // browsers without support get the plain, instant state update.
  if (reduced || typeof start !== 'function') {
    update();
    return;
  }
  // A route change during a running transition aborts the old one; the
  // resulting rejections are expected, so swallow both.
  let transition: ViewTransitionLike | undefined;
  try {
    transition = start.call(document, update);
  } catch {
    update();
    return;
  }
  transition?.finished?.catch(() => undefined);
  (transition as { ready?: Promise<void> } | undefined)?.ready?.catch(() => undefined);
  transition?.updateCallbackDone?.catch(() => undefined);
}

/** Reads the current route and re-reads it on back/forward navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { kind: 'landing' } : parseRoute(window.location.pathname),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const next = parseRoute(window.location.pathname);
      if (syncNavigation) flushSync(() => setRoute(next));
      else setRoute(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}
