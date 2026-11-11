import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LazyMotion } from 'motion/react';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { api, onWakeRetry, type BootstrapResponse, type SpendCategory } from '../api.js';
import { ActivitySheet } from './ActivitySheet.js';
import { ActivityTab } from './ActivityTab.js';
import { AskTab } from './AskTab.js';
import { useWallet } from './data.js';
import { buildFeed, type FeedItem } from './feed.js';
import { dayLabel, displayName, money, parseMoney } from './format.js';
import { Home } from './Home.js';
import { InsightsTab } from './InsightsTab.js';
import { clearSession, loadSession, saveSession, type Session } from './session.js';
import { SetupSheet } from './SetupSheet.js';
import { AddSheet } from './AddSheet.js';
import { SettingsView } from './SettingsView.js';
import { ErrorNotice, ToastProvider, useToast } from './ui.js';
import { AppShell, appRoute, sectionLabel, settingsTabLabel, isPlannedSection } from './AppShell.js';
import { PlannedView } from './PlannedView.js';
import { AppPreloader } from './Preloader.js';
import { bootProgress, useBootProgress } from './boot-progress.js';
import { LoadingSteps } from './LoadingSteps.js';
import { Welcome } from './Welcome.js';
import { SignIn } from './SignIn.js';
import { navigate, APP_SECTIONS, SETTINGS_TABS, useRoute, type AppSection, type Route } from './router.js';
import { READINESS_POLL_CAP_MS, readinessPollDelays, runReadinessPoll } from './readiness-poll.js';
import { SiteFooter } from './SiteFooter.js';
import { applyTheme, nextTheme, readTheme, saveTheme, type ThemePref } from './theme.js';
import { applyDensity, densityLabel, readDensity, saveDensity, type DensityPref } from './density.js';
import { CommandPalette, type PaletteRow } from './CommandPalette.js';
import { ShortcutSheet } from './ShortcutSheet.js';
import { TourRail, type TourRailHandle } from './TourRail.js';

/** Animation features load in their own chunk; `strict` rejects a stray full `motion.*` import. */
const loadMotion = () => import('./motion-features.js').then((mod) => mod.default);

type Sheetname = null | 'log' | 'setup';

/** "light" to "Light", for the next-theme hint in the palette. */
function preferenceName(pref: string): string {
  return pref.charAt(0).toUpperCase() + pref.slice(1);
}

export function ConsumerApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [bootReady, setBootReady] = useState(false);
  const route = useRoute();
  // start() is passed to children with a stable identity, so it reads the route
  // from a ref instead of capturing this render's value.
  const routeRef = useRef(route);
  useEffect(() => { routeRef.current = route; }, [route]);

  // A sleeping ledger can fail the initial readiness probe. Poll the capabilities
  // after it wakes so the form does not stay disabled until a reload. Only worth
  // polling when accounts are persistent: a deployment without them never opens
  // sign-up, no matter how long we wait.
  useEffect(() => {
    if (!boot?.identity?.persistent || boot.identity.signupAvailable) return;
    // Stops after ~5 minutes of wall clock (not five minutes of gaps), bounds each
    // probe, and re-arms instead of probing while the tab is hidden.
    return runReadinessPoll({
      probe: (signal) => api.bootstrap({ signal }).then((next) => ({
        ready: next.identity?.signupAvailable === true,
        boot: next,
      })),
      onResult: (result) => setBoot(result.boot),
      delays: readinessPollDelays(),
      capMs: READINESS_POLL_CAP_MS,
      isHidden: () => document.visibilityState === 'hidden',
    });
  }, [boot?.identity?.persistent, boot?.identity?.signupAvailable]);

  useEffect(() => {
    document.documentElement.classList.add('settle-smooth-scroll');
    bootProgress.reset(Date.now());
    // A wake retry is the ledger still starting up: show it as another attempt
    // on that step instead of a silent wait.
    const offWakeRetry = onWakeRetry(({ attempt }) => {
      bootProgress.dispatch({ type: 'retry', id: 'ledger', at: Date.now(), attempt });
    });
    // Start the sleeping Render ledger booting while the landing page renders.
    // Not awaited: a wake takes 30-60s and nothing here may block the preloader.
    void api.wake().then((wake) => {
      // No configured ledger means there is nothing to wake: never wait on it.
      if (wake.awake || wake.configured === false) {
        bootProgress.dispatch({ type: 'done', id: 'ledger', at: Date.now() });
      }
    });
    const minSplash = new Promise<void>((resolve) => { window.setTimeout(resolve, 720); });
    void Promise.all([
      api.bootstrap().then((next) => {
        setBoot(next);
        bootProgress.dispatch({ type: 'done', id: 'server', at: Date.now() });
      }).catch((e: Error) => {
        setBootError(e.message);
        bootProgress.dispatch({ type: 'fail', id: 'server', at: Date.now(), reason: e.message });
      }),
      minSplash,
    ]).finally(() => setBootReady(true));
    return () => {
      offWakeRetry();
      document.documentElement.classList.remove('settle-smooth-scroll');
    };
  }, []);

  useEffect(() => {
    if (!session) document.title = 'Settle · transaction intelligence you run yourself';
  }, [session]);

  const start = useCallback((next: Session) => {
    saveSession(next);
    setSession(next);
    if (routeRef.current.kind !== 'app') navigate({ kind: 'app', section: 'overview' }, { replace: true });
  }, []);
  const signOut = useCallback(() => {
    void api.logout().catch(() => undefined);
    clearSession();
    setSession(null);
    navigate({ kind: 'landing' }, { replace: true });
  }, []);

  useEffect(() => {
    const oauthComplete = new URLSearchParams(window.location.search).get('authComplete') === 'google';
    if (loadSession() && !oauthComplete) return;
    void api.authSession().then((body) => {
      if (!body.user || !body.account) return;
      start({ account: body.account, household: [], demo: false, user: body.user });
      if (oauthComplete) navigate({ kind: 'app', section: 'overview' }, { replace: true });
    }).catch(() => undefined);
  }, [start]);

  return (
    <LazyMotion features={loadMotion} strict>
      <ToastProvider>
        <AppPreloader visible={!bootReady} />
        <div className={`app${bootReady ? ' app-ready' : ''}`}>
          <a className="skip" href="#main">Skip to content</a>
          {session && boot ? (
            <Signed boot={boot} session={session} onSwitch={start} onSignOut={signOut} />
          ) : route.kind === 'signin' || route.kind === 'signup' ? (
            <main id="main" className="main">
              <SignIn
                key={route.kind}
                mode={route.kind === 'signup' ? 'create' : 'signin'}
                boot={boot}
                bootError={bootError}
                onStart={start}
              />
            </main>
          ) : (
            <main id="main" className="main main-welcome">
              <Welcome boot={boot} bootError={bootError} onStart={start} />
            </main>
          )}
          <SiteFooter variant={session && boot ? 'compact' : 'full'} boot={boot} session={session} />
        </div>
      </ToastProvider>
    </LazyMotion>
  );
}

function Signed({ boot, session, onSwitch, onSignOut }: {
  boot: BootstrapResponse;
  session: Session;
  onSwitch: (s: Session) => void;
  onSignOut: () => void;
}) {
  const me = session.account;
  const demo = session.demo === true;
  const who = session.user?.displayName ?? displayName(me.owner);
  const { data, error, refreshing, reload, run: walletRun } = useWallet(me.id);
  const { state: progress, now: progressNow } = useBootProgress();
  const walletArrived = data !== null;

  // The first wallet view means accounts and insights are both on hand.
  useEffect(() => {
    if (!walletArrived) return;
    bootProgress.dispatch({ type: 'done', id: 'accounts', at: Date.now() });
    bootProgress.dispatch({ type: 'done', id: 'insights', at: Date.now() });
  }, [walletArrived]);

  // A wallet load that never produced data is a failed step, not a stuck one.
  useEffect(() => {
    if (!error || walletArrived) return;
    const running = bootProgress.getState().steps.find((step) => step.status === 'running');
    if (running === undefined) return;
    bootProgress.dispatch({ type: 'fail', id: running.id, at: Date.now(), reason: error });
  }, [error, walletArrived]);

  const [sheet, setSheet] = useState<Sheetname>(null);
  const [setupMode, setSetupMode] = useState<'onboarding' | 'edit'>('onboarding');
  const [setupStep, setSetupStep] = useState<0 | 1 | 2>(0);
  const [item, setItem] = useState<FeedItem | null>(null);
  const [logPreset, setLogPreset] = useState<{ category?: SpendCategory; amountMinor?: number }>({});
  const [addMode, setAddMode] = useState<'spent' | 'got'>('spent');
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => readTheme());
  const [density, setDensity] = useState<DensityPref>(() => readDensity());
  // AppShell owns the rail state and hands its toggle over for the palette.
  const sidebarToggle = useRef<(() => void) | null>(null);
  const tourRef = useRef<TourRailHandle | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const toast = useToast();
  const route = useRoute();
  /** Signed-in sessions only ever render an app route; other URLs are corrected below. */
  const appView: Extract<Route, { kind: 'app' }> = route.kind === 'app' ? route : { kind: 'app', section: 'overview' };
  const viewSection = appView.section;
  const viewSettingsTab = appView.section === 'settings' ? appView.tab ?? 'profile' : null;
  const statementHref = `/api/accounts/${encodeURIComponent(me.id)}/statement.txt`;

  // OAuth failures can land on any signed-in URL, not just the ones that expect
  // them. Say what happened, then drop the query so a reload stays quiet.
  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('authError');
    if (!authError) return;
    const message = authError === 'google-link' || authError === 'google'
      ? 'Google could not be connected or signed in. Try again from Account access.'
      : authError === 'link-required'
        ? 'That Google account matches an existing email. Sign in with your password, then connect Google from Account access.'
        : 'Sign-in did not complete. Try again.';
    toast(message, { tone: 'bad' });
    if (route.kind === 'app') navigate(route, { replace: true });
    else navigate({ kind: 'app', section: 'overview' }, { replace: true });
    // Mount only: later failures are handled by the sign-in and account screens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Re-apply the saved theme if the pre-paint script did not run.
    applyTheme(theme);
  }, []);

  useEffect(() => {
    // Same for density: theme-init.js sets it before paint, but a blocked
    // script must not leave the saved preference unapplied.
    applyDensity(readDensity());
  }, []);

  const toggleTheme = useCallback(() => {
    const next = nextTheme(theme);
    saveTheme(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  const toggleDensity = useCallback(() => {
    const next: DensityPref = density === 'compact' ? 'comfortable' : 'compact';
    saveDensity(next);
    applyDensity(next);
    setDensity(next);
  }, [density]);

  // The Appearance tab picks an exact preference; the shell button cycles.
  const chooseTheme = useCallback((next: ThemePref) => {
    saveTheme(next);
    applyTheme(next);
    setTheme(next);
  }, []);

  const chooseDensity = useCallback((next: DensityPref) => {
    saveDensity(next);
    applyDensity(next);
    setDensity(next);
  }, []);

  // A signed-in visitor on a non-app URL (a stale link, an OAuth redirect that
  // dropped the path) belongs on the overview, not on the landing page.
  useEffect(() => {
    if (route.kind === 'app') return;
    navigate({ kind: 'app', section: 'overview' }, { replace: true });
  }, [route]);

  // First-run setup: open once per wallet, but never block a returning person.
  useEffect(() => {
    if (!data) return;
    if (data.view.moneyProfile?.walletCashMinor != null) return;
    const key = `settle:setup-seen:${me.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      /* private mode: still show it this once */
    }
    setSetupMode('onboarding');
    setSetupStep(0);
    setSheet('setup');
  }, [data, me.id]);

  useEffect(() => {
    document.title = viewSettingsTab
      ? `${settingsTabLabel(viewSettingsTab)} · Settings · Settle`
      : `${sectionLabel(viewSection)} · Settle`;
  }, [viewSection, viewSettingsTab]);

  const go = useCallback((section: AppSection) => {
    navigate(appRoute(section));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const closeSheet = () => setSheet(null);

  const openLog = useCallback((preset: { category?: SpendCategory; amountMinor?: number } = {}) => {
    setLogPreset(preset);
    setAddMode('spent');
    setSheet('log');
  }, []);
  const openIncome = () => {
    setLogPreset({});
    setAddMode('got');
    setSheet('log');
  };

  const ask = (question?: string) => {
    if (question) setAskSeed(question);
    go('ask');
  };

  const openFeedItem = useCallback((feedItem: FeedItem) => setItem(feedItem), []);

  const paletteCommands = useMemo<PaletteRow[]>(() => {
    const rows: PaletteRow[] = [];

    for (const section of APP_SECTIONS) {
      const keywords: string[] = [section];
      if (section === 'insights') keywords.push('patterns');
      if (section === 'overview') keywords.push('home');
      rows.push({
        id: `go-${section}`,
        kind: 'command',
        label: `Go to ${sectionLabel(section)}`,
        keywords,
        run: () => go(section),
      });
    }

    for (const tab of SETTINGS_TABS) {
      rows.push({
        id: `settings-${tab}`,
        kind: 'command',
        label: `Open settings: ${settingsTabLabel(tab)}`,
        run: () => navigate({ kind: 'app', section: 'settings', tab }),
      });
    }

    const nextDensity: DensityPref = density === 'compact' ? 'comfortable' : 'compact';
    rows.push(
      { id: 'new-transaction', kind: 'command', label: 'New transaction', run: () => openLog() },
      {
        id: 'toggle-theme',
        kind: 'command',
        label: 'Toggle theme',
        hint: preferenceName(nextTheme(theme)),
        run: toggleTheme,
      },
      {
        id: 'toggle-density',
        kind: 'command',
        label: `Switch to ${densityLabel(nextDensity).toLowerCase()} density`,
        hint: densityLabel(density),
        run: toggleDensity,
      },
      { id: 'toggle-sidebar', kind: 'command', label: 'Collapse or expand sidebar', run: () => sidebarToggle.current?.() },
      { id: 'shortcuts', kind: 'command', label: 'Keyboard shortcuts', run: () => setHelpOpen(true) },
      {
        id: demo ? 'exit-sample' : 'sign-out',
        kind: 'command',
        label: demo ? 'Exit sample' : 'Sign out',
        run: onSignOut,
      },
    );

    return rows;
  }, [demo, density, go, onSignOut, openLog, theme, toggleDensity, toggleTheme]);

  const paletteTransactions = useMemo<PaletteRow[]>(() => {
    if (!data) return [];
    return buildFeed(data.view).map((feedItem) => {
      const sign = feedItem.signedMinor < 0 ? '\u2212' : feedItem.signedMinor > 0 ? '+' : '';
      return {
        id: `transaction-${feedItem.id}`,
        kind: 'transaction',
        label: feedItem.title,
        hint: dayLabel(feedItem.occurredAt),
        keywords: [feedItem.subtitle, feedItem.category ?? ''],
        amount: `${sign}${money(Math.abs(feedItem.signedMinor))}`,
        run: () => {
          navigate(appRoute('transactions'));
          openFeedItem(feedItem);
        },
      };
    });
  }, [data, openFeedItem]);

  return (
    <>
      <AppShell
        route={appView}
        who={who}
        householdLabel={demo ? 'Sample household' : who}
        demo={demo}
        accounts={session.household}
        accountId={me.id}
        email={session.user?.email}
        statementHref={statementHref}
        themePref={theme}
        syncing={refreshing}
        onNew={() => openLog()}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onSignOut={onSignOut}
        onSwitch={(account) => onSwitch({ account, household: session.household, demo: session.demo })}
        onEditBalances={() => navigate({ kind: 'app', section: 'settings', tab: 'balances' })}
        onToggleTheme={toggleTheme}
        onOpenGuide={demo ? () => tourRef.current?.start() : undefined}
        sidebarToggleRef={sidebarToggle}
      >
        {error && !data ? <ErrorNotice message={error} onRetry={() => void reload()} /> : null}
        {error && data ? (
          <div className="notice notice-warn sync-banner" role="status">
            <span>Couldn&apos;t refresh your wallet.</span>
            <button type="button" className="link-btn" onClick={() => void reload()}>Retry</button>
          </div>
        ) : null}
        {!data && !error ? (
          <div className="boot-card">
            <LoadingSteps
              state={progress}
              now={progressNow}
              onRetry={() => {
                bootProgress.reset(Date.now());
                void reload();
              }}
            />
          </div>
        ) : (
          <div className="view" key={viewSection}>
            {viewSection === 'overview' ? (
              <Home
                me={me}
                name={session.user?.displayName}
                data={data}
                actions={{
                  logSpend: openLog,
                  logIncome: openIncome,
                  ask,
                  openItem: openFeedItem,
                  seeAll: () => go('transactions'),
                  seeInsights: () => go('insights'),
                  seeWallet: () => go('settings'),
                  setup: (step) => {
                    setSetupMode(data?.view.moneyProfile?.walletCashMinor == null ? 'onboarding' : 'edit');
                    setSetupStep(step ?? 0);
                    setSheet('setup');
                  },
                }}
              />
            ) : null}
            {viewSection === 'transactions' ? <ActivityTab data={data} onOpen={openFeedItem} /> : null}
            {viewSection === 'insights' ? (
              <InsightsTab
                data={data}
                onLog={() => openLog()}
                onSetup={(step) => { setSetupMode('edit'); setSetupStep(step ?? 0); setSheet('setup'); }}
                onAsk={() => ask('What stands out about my spending this month?')}
              />
            ) : null}
            {viewSection === 'ask' ? <AskTab accountId={me.id} boot={boot} seed={askSeed} onSeedUsed={() => setAskSeed(null)} /> : null}
            {viewSection === 'settings' ? (
              <SettingsView
                tab={viewSettingsTab ?? 'profile'}
                name={who}
                email={session.user?.email}
                demo={demo}
                me={me}
                data={data}
                statementHref={statementHref}
                theme={theme}
                density={density}
                onTheme={chooseTheme}
                onDensity={chooseDensity}
                onSignOut={onSignOut}
                onEditBalances={() => {
                  setSetupMode('edit');
                  setSetupStep(0);
                  setSheet('setup');
                }}
                onReload={reload}
              />
            ) : null}
            {isPlannedSection(viewSection) ? <PlannedView section={viewSection} /> : null}
          </div>
        )}
      </AppShell>

      <AddSheet
        open={sheet === 'log'}
        onClose={closeSheet}
        me={me}
        recent={data?.view.spendEntries ?? []}
        initialMode={addMode}
        initialCategory={logPreset.category}
        initialAmount={logPreset.amountMinor}
        onChanged={reload}
        walletRun={walletRun}
      />
      <SetupSheet
        open={sheet === 'setup'}
        onClose={closeSheet}
        me={me}
        profile={data?.view.moneyProfile}
        mode={setupMode}
        initialStep={setupStep}
        suggestedCashMinor={parseMoney(data?.view.balance)}
        onSaved={async () => {
          await reload();
        }}
      />
      <ActivitySheet item={item} accountId={me.id} onClose={() => setItem(null)} onChanged={reload} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        transactions={paletteTransactions}
      />
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      {demo ? <TourRail ref={tourRef} /> : null}
    </>
  );
}
