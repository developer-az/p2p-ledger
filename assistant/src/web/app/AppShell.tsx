import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import './styles/shell.css';
import type { AccountRef } from '../api.js';
import { BrandMark } from './BrandMark.js';
import { displayName, initials } from './format.js';
import { navigate, routeHref, type AppSection, type Route, type SettingsTab } from './router.js';
import { createShortcutMatcher, formatKeys } from './shortcuts.js';
import { Icon, type IconName } from './ui.js';
import { themeLabel, type ThemePref } from './theme.js';

/**
 * The signed-in shell: a URL-driven sidebar, a breadcrumb top bar and the
 * content column. Views own their own markup; this file owns navigation,
 * the account menu, the collapse rail and the mobile drawer.
 *
 * Sections marked "Planned · M#" route to the shared `PlannedView`.
 */

/** A section and its display data. */
interface SectionItem {
  section: AppSection;
  label: string;
  icon: IconName;
  /** Milestone tag for a section that is not built yet. */
  milestone?: string;
}

const SECTION_LABELS: Record<AppSection, string> = {
  overview: 'Overview',
  transactions: 'Transactions',
  insights: 'Insights',
  ask: 'Ask',
  subscriptions: 'Subscriptions',
  forecast: 'Forecast',
  alerts: 'Alerts',
  imports: 'Imports',
  rules: 'Rules',
  reports: 'Reports',
  settings: 'Settings',
};

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  profile: 'Profile',
  security: 'Security',
  privacy: 'Data & privacy',
  integrations: 'Integrations',
  categories: 'Categories & rules',
  appearance: 'Appearance',
  balances: 'Balances & budget',
};

const GROUPS: { title: string; items: SectionItem[] }[] = [
  {
    title: 'Workspace',
    items: [
      { section: 'overview', label: 'Overview', icon: 'home' },
      { section: 'transactions', label: 'Transactions', icon: 'list' },
      { section: 'insights', label: 'Insights', icon: 'chart' },
      { section: 'ask', label: 'Ask', icon: 'chat' },
    ],
  },
  {
    title: 'Money',
    items: [
      { section: 'subscriptions', label: 'Subscriptions', icon: 'repeat', milestone: 'M5' },
      { section: 'forecast', label: 'Forecast', icon: 'trend', milestone: 'M6' },
      { section: 'alerts', label: 'Alerts', icon: 'bell', milestone: 'M6' },
    ],
  },
  {
    title: 'Data',
    items: [
      { section: 'imports', label: 'Imports', icon: 'upload', milestone: 'M3' },
      { section: 'rules', label: 'Rules', icon: 'sliders', milestone: 'M4' },
      { section: 'reports', label: 'Reports', icon: 'file', milestone: 'M6' },
    ],
  },
];

const SETTINGS_ITEM: SectionItem = { section: 'settings', label: 'Settings', icon: 'settings' };

const RAIL_KEY = 'settle-sidebar';
const MOBILE_QUERY = '(max-width: 767px)';
const ACCOUNT_MENU_ID = 'account-menu';

/** Anything modal on screen owns the keyboard; the shell steps back. */
const MODAL_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"]:not(dialog)';

function hasOpenModal(): boolean {
  return document.querySelector(MODAL_SELECTOR) !== null;
}

/** Display label for a section, used by the shell and by view titles. */
export function sectionLabel(section: AppSection): string {
  return SECTION_LABELS[section];
}

/** Display label for a settings tab. */
export function settingsTabLabel(tab: SettingsTab): string {
  return SETTINGS_TAB_LABELS[tab];
}

/** The canonical route for a section, narrowing the settings shape for TS. */
export function appRoute(section: AppSection): Route {
  if (section === 'settings') return { kind: 'app', section: 'settings' };
  return { kind: 'app', section };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* private mode: the rail state lasts for this visit */
  }
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = agent.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** True on a plain left click, the only click the shell handles itself. */
function isPlainClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

export interface AppShellProps {
  route: Extract<Route, { kind: 'app' }>;
  /** The person using the app right now. */
  who: string;
  /** Breadcrumb root: "Sample household" for the demo, else the person's name. */
  householdLabel: string;
  demo: boolean;
  /** Every account the current session may switch to. */
  accounts: AccountRef[];
  accountId: string;
  email?: string;
  statementHref: string;
  themePref: ThemePref;
  syncing?: boolean;
  children: ReactNode;
  onNew: () => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
  onSwitch: (account: AccountRef) => void;
  onEditBalances: () => void;
  onToggleTheme: () => void;
  onOpenGuide?: () => void;
  /** Hand-off so the command palette runs the same collapse action as `[`. */
  sidebarToggleRef?: RefObject<(() => void) | null>;
}

export function AppShell({
  route,
  who,
  householdLabel,
  demo,
  accounts,
  accountId,
  email,
  statementHref,
  themePref,
  syncing = false,
  children,
  onNew,
  onOpenPalette,
  onOpenHelp,
  onSignOut,
  onSwitch,
  onEditBalances,
  onToggleTheme,
  onOpenGuide,
  sidebarToggleRef,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const rail = collapsed && !isMobile;
  const section = route.section;
  const settingsTab = route.section === 'settings' ? route.tab ?? 'profile' : null;

  const isMac = useMemo(detectMac, []);
  const matcher = useMemo(() => createShortcutMatcher({ isMac }), [isMac]);

  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountWrapRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNew, onOpenPalette, onOpenHelp });
  callbacks.current = { onNew, onOpenPalette, onOpenHelp };

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // A wider window turns the drawer back into a docked sidebar.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      if (drawerOpen) closeDrawer();
      else openDrawer();
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  }, [closeDrawer, collapsed, drawerOpen, isMobile, openDrawer]);

  // The palette runs the same action as the `[` key, so the rail stays one
  // piece of state, owned here.
  useEffect(() => {
    if (!sidebarToggleRef) return;
    sidebarToggleRef.current = toggleSidebar;
    return () => {
      sidebarToggleRef.current = null;
    };
  }, [sidebarToggleRef, toggleSidebar]);

  const closeAccountMenu = useCallback(() => {
    setMenuOpen(false);
    accountButtonRef.current?.focus();
  }, []);

  // Focus lands on the first link inside an opened drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    firstLinkRef.current?.focus();
  }, [drawerOpen]);

  // Outside click closes the account menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (accountWrapRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  // One window listener, one matcher. A handled key comes back defaultPrevented
  // and a modal owns every key, so an open sheet keeps its own Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // The palette and the sheets handle their own keys; every shortcut is
      // ignored while one is open, Escape included.
      if (hasOpenModal()) return;
      const target = e.target;
      const element = target instanceof HTMLElement ? target : null;
      const id = matcher({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        targetTag: element?.tagName,
        targetEditable: element?.isContentEditable === true,
        timeStamp: e.timeStamp,
      });
      if (id === null) return;

      // Escape closes the drawer or the account menu, never behind a modal.
      if (id === 'escape') {
        if (menuOpen) {
          e.preventDefault();
          closeAccountMenu();
          return;
        }
        if (drawerOpen) {
          e.preventDefault();
          closeDrawer();
        }
        return;
      }

      e.preventDefault();
      switch (id) {
        case 'palette':
        case 'search':
          callbacks.current.onOpenPalette();
          break;
        case 'help':
          callbacks.current.onOpenHelp();
          break;
        case 'new':
          callbacks.current.onNew();
          break;
        case 'sidebar':
          toggleSidebar();
          break;
        case 'go-overview':
          navigate(appRoute('overview'));
          break;
        case 'go-transactions':
          navigate(appRoute('transactions'));
          break;
        case 'go-insights':
          navigate(appRoute('insights'));
          break;
        case 'go-settings':
          navigate(appRoute('settings'));
          break;
        case 'go-ask':
          navigate(appRoute('ask'));
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAccountMenu, closeDrawer, drawerOpen, matcher, menuOpen, toggleSidebar]);

  const onNavClick = (target: AppSection) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (drawerOpen) closeDrawer();
    navigate(appRoute(target));
  };

  const item = (entry: SectionItem, current: boolean) => (
    <a
      key={entry.section}
      className="shell-item"
      href={routeHref(appRoute(entry.section))}
      aria-current={current ? 'page' : undefined}
      aria-label={entry.label}
      title={entry.milestone ? `${entry.label} · Planned ${entry.milestone}` : entry.label}
      onClick={onNavClick(entry.section)}
    >
      <span className="shell-item-icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
      <span className="shell-item-label">{entry.label}</span>
      {entry.milestone ? <span className="shell-item-tag" aria-hidden="true">{entry.milestone}</span> : null}
    </a>
  );

  const settingsHref = settingsTab === null
    ? routeHref(appRoute('settings'))
    : routeHref({ kind: 'app', section: 'settings', tab: settingsTab });

  const crumbs = settingsTab === null
    ? [householdLabel, sectionLabel(section)]
    : [householdLabel, sectionLabel('settings'), settingsTabLabel(settingsTab)];

  const others = accounts.filter((account) => account.id !== accountId);

  const onDrawerKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!drawerOpen || e.key !== 'Tab') return;
    const root = sidebarRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ).filter((el) => el.offsetParent !== null);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`shell${rail ? ' is-rail' : ''}`}>
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`shell-sidebar glass${drawerOpen ? ' is-open' : ''}`}
        inert={isMobile && !drawerOpen ? true : undefined}
        onKeyDown={onDrawerKeyDown}
      >
        <div className="shell-side-head">
          <a
            ref={firstLinkRef}
            className="shell-brand"
            href={routeHref(appRoute('overview'))}
            aria-label="Settle overview"
            title="Settle"
            onClick={onNavClick('overview')}
          >
            <BrandMark size={24} />
            <span className="shell-brand-word">Settle</span>
          </a>
          <button
            type="button"
            className="shell-icon-btn shell-collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleSidebar}
          >
            <Icon name="chevron" size={16} />
          </button>
        </div>

        <nav className="shell-nav" aria-label="Main">
          {GROUPS.map((group) => (
            <div key={group.title} className="shell-group">
              <p className="shell-group-label">{group.title}</p>
              {group.items.map((entry) => item(entry, entry.section === section))}
            </div>
          ))}
          <div className="shell-nav-end">
            <div className="shell-group">
              <a
                className="shell-item"
                href={settingsHref}
                aria-current={section === 'settings' ? 'page' : undefined}
                aria-label={SETTINGS_ITEM.label}
                title={SETTINGS_ITEM.label}
                onClick={(e) => {
                  if (!isPlainClick(e)) return;
                  e.preventDefault();
                  if (drawerOpen) closeDrawer();
                  if (settingsTab === null) navigate(appRoute('settings'));
                }}
              >
                <span className="shell-item-icon" aria-hidden="true"><Icon name={SETTINGS_ITEM.icon} size={18} /></span>
                <span className="shell-item-label">{SETTINGS_ITEM.label}</span>
              </a>
            </div>
          </div>
        </nav>

        <div className="shell-side-foot" ref={accountWrapRef}>
          <button
            ref={accountButtonRef}
            type="button"
            className="shell-account"
            aria-expanded={menuOpen}
            aria-controls={ACCOUNT_MENU_ID}
            aria-label={`Account menu for ${who}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="shell-avatar" aria-hidden="true">{initials(who)}</span>
            <span className="shell-account-name">{who}</span>
          </button>
          <button
            type="button"
            className="shell-icon-btn shell-theme"
            aria-label={themeLabel(themePref)}
            title={themeLabel(themePref)}
            onClick={onToggleTheme}
          >
            <ThemeGlyph pref={themePref} />
          </button>

          {menuOpen ? (
            <div id={ACCOUNT_MENU_ID} className="shell-menu">
              {email ? <p className="shell-menu-email">{email}</p> : null}
              {others.length > 0 ? (
                <>
                  <p className="shell-menu-label">View as</p>
                  {others.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onSwitch(account);
                      }}
                    >
                      <span className="shell-avatar" aria-hidden="true">{initials(displayName(account.owner))}</span>
                      {displayName(account.owner)}
                    </button>
                  ))}
                  <hr />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEditBalances();
                }}
              >
                <Icon name="settings" size={16} />Balances &amp; budget
              </button>
              <a href={statementHref}>
                <Icon name="download" size={16} />Download statement
              </a>
              {demo && onOpenGuide ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenGuide();
                  }}
                >
                  <Icon name="target" size={16} />Guided tour
                </button>
              ) : null}
              <hr />
              <button type="button" onClick={onSignOut}>
                <Icon name="logout" size={16} />{demo ? 'Exit sample' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {drawerOpen ? (
        <div className="shell-backdrop" aria-hidden="true" onClick={closeDrawer} />
      ) : null}

      <div className="shell-col">
        <header className="shell-top glass">
          <button
            ref={menuButtonRef}
            type="button"
            className="shell-icon-btn shell-menu-btn"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            onClick={drawerOpen ? closeDrawer : openDrawer}
          >
            <Icon name="list" size={18} />
          </button>

          <nav className="shell-breadcrumb" aria-label="Breadcrumb">
            <ol className="shell-crumbs">
              {crumbs.map((crumb, index) => (
                <li
                  key={crumb}
                  aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                >
                  {crumb}
                </li>
              ))}
            </ol>
          </nav>

          {demo ? <span className="shell-badge">Sample data</span> : null}

          <span className="shell-grow" />

          {syncing ? (
            <span className="shell-sync" role="status" aria-label="Syncing">
              <span className="shell-sync-dot" aria-hidden="true" />
              <span className="shell-sync-label">Syncing</span>
            </span>
          ) : null}

          <button
            type="button"
            className="shell-search"
            aria-label="Search transactions"
            data-tour="search"
            onClick={onOpenPalette}
          >
            <Icon name="search" size={16} />
            <span className="shell-search-label">Search transactions</span>
            <kbd>{formatKeys('Mod+K', isMac)}</kbd>
          </button>

          <button type="button" className="shell-new" aria-label="New transaction" onClick={onNew}>
            <Icon name="plus" size={16} />
            <span className="shell-new-label">New transaction</span>
          </button>
        </header>

        <main id="main" className="main shell-main">{children}</main>
      </div>
    </div>
  );
}

/** Sections whose content is only described in the plan. */
export const PLANNED_SECTIONS = ['subscriptions', 'forecast', 'alerts', 'imports', 'rules', 'reports'] as const;

/** Every section that renders the shared planned empty state. */
export type PlannedSection = (typeof PLANNED_SECTIONS)[number];

/** Narrowing guard for the planned sections. */
export function isPlannedSection(section: AppSection): section is PlannedSection {
  return (PLANNED_SECTIONS as readonly string[]).includes(section);
}

/** system / light / dark glyph for the theme button. */
function ThemeGlyph({ pref }: { pref: ThemePref }) {
  if (pref === 'light') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </svg>
    );
  }
  if (pref === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
