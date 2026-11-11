import { describe, expect, it } from 'vitest';
import {
  APP_SECTIONS,
  SETTINGS_TABS,
  parseRoute,
  routeHref,
  type Route,
} from '../src/web/app/router.js';

describe('parseRoute', () => {
  it('maps the public pages', () => {
    expect(parseRoute('/')).toEqual({ kind: 'landing' });
    expect(parseRoute('/signin')).toEqual({ kind: 'signin' });
    expect(parseRoute('/signup')).toEqual({ kind: 'signup' });
    expect(parseRoute('/reset-password')).toEqual({ kind: 'reset-password' });
    expect(parseRoute('/account-access')).toEqual({ kind: 'account-access' });
    expect(parseRoute('/google-signin')).toEqual({ kind: 'google-signin' });
    expect(parseRoute('/privacy')).toEqual({ kind: 'legal', page: 'privacy' });
    expect(parseRoute('/terms')).toEqual({ kind: 'legal', page: 'terms' });
    expect(parseRoute('/ops')).toEqual({ kind: 'ops' });
  });

  it('ignores trailing slashes and case', () => {
    expect(parseRoute('/signin/')).toEqual({ kind: 'signin' });
    expect(parseRoute('/SignIn')).toEqual({ kind: 'signin' });
    expect(parseRoute('/app/Insights/')).toEqual({ kind: 'app', section: 'insights' });
    expect(parseRoute('')).toEqual({ kind: 'landing' });
  });

  it('maps every app section', () => {
    for (const section of APP_SECTIONS) {
      if (section === 'settings') continue;
      expect(parseRoute(`/app/${section}`)).toEqual({ kind: 'app', section });
    }
  });

  it('defaults /app to overview and unknown sections to overview', () => {
    expect(parseRoute('/app')).toEqual({ kind: 'app', section: 'overview' });
    expect(parseRoute('/app/wallet')).toEqual({ kind: 'app', section: 'overview' });
    expect(parseRoute('/app/overview/extra')).toEqual({ kind: 'app', section: 'overview' });
  });

  it('maps settings tabs, defaulting to profile', () => {
    expect(parseRoute('/app/settings')).toEqual({ kind: 'app', section: 'settings', tab: 'profile' });
    expect(parseRoute('/app/settings/nope')).toEqual({ kind: 'app', section: 'settings', tab: 'profile' });
    for (const tab of SETTINGS_TABS) {
      expect(parseRoute(`/app/settings/${tab}`)).toEqual({ kind: 'app', section: 'settings', tab });
    }
  });

  it('sends unknown top-level paths to the landing page', () => {
    expect(parseRoute('/nope')).toEqual({ kind: 'landing' });
    expect(parseRoute('/signin/extra')).toEqual({ kind: 'landing' });
  });
});

describe('routeHref', () => {
  const all: Route[] = [
    { kind: 'landing' },
    { kind: 'signin' },
    { kind: 'signup' },
    { kind: 'reset-password' },
    { kind: 'account-access' },
    { kind: 'google-signin' },
    { kind: 'legal', page: 'privacy' },
    { kind: 'legal', page: 'terms' },
    { kind: 'ops' },
    ...APP_SECTIONS.filter((s) => s !== 'settings').map((section): Route => ({ kind: 'app', section })),
    ...SETTINGS_TABS.map((tab): Route => ({ kind: 'app', section: 'settings', tab })),
  ];

  it('round-trips every route through parseRoute', () => {
    for (const route of all) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it('writes canonical paths', () => {
    expect(routeHref({ kind: 'landing' })).toBe('/');
    expect(routeHref({ kind: 'app', section: 'overview' })).toBe('/app/overview');
    expect(routeHref({ kind: 'app', section: 'settings', tab: 'appearance' })).toBe('/app/settings/appearance');
    expect(routeHref({ kind: 'app', section: 'settings' })).toBe('/app/settings/profile');
    expect(routeHref({ kind: 'legal', page: 'terms' })).toBe('/terms');
  });

  it('keeps a query string when one is given', () => {
    expect(routeHref({ kind: 'landing' }, '?authError=expired')).toBe('/?authError=expired');
    expect(routeHref({ kind: 'signin' }, 'authComplete=google')).toBe('/signin?authComplete=google');
    expect(routeHref({ kind: 'signin' }, '')).toBe('/signin');
    expect(routeHref({ kind: 'signin' }, '?')).toBe('/signin');
  });
});

describe('route lists', () => {
  it('lists the sidebar sections in order', () => {
    expect(APP_SECTIONS).toEqual([
      'overview', 'transactions', 'insights', 'ask',
      'subscriptions', 'forecast', 'alerts',
      'imports', 'rules', 'reports', 'settings',
    ]);
  });

  it('lists the settings tabs in order', () => {
    expect(SETTINGS_TABS).toEqual([
      'profile', 'security', 'privacy', 'integrations', 'categories', 'appearance', 'balances',
    ]);
  });
});
