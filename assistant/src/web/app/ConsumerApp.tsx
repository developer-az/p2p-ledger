import { useCallback, useEffect, useRef, useState } from 'react';
import { LazyMotion } from 'motion/react';
import './app.css';
import { api, onWakeRetry, type BootstrapResponse, type SpendCategory } from '../api.js';
import { ActivitySheet } from './ActivitySheet.js';
import { ActivityTab } from './ActivityTab.js';
import { AskTab } from './AskTab.js';
import { useWallet } from './data.js';
import type { FeedItem } from './feed.js';
import { DemoGuide, type DemoStepId } from './DemoGuide.js';
import { displayName, parseMoney } from './format.js';
import { Home } from './Home.js';
import { InsightsTab } from './InsightsTab.js';
import { clearSession, loadSession, saveSession, type Session } from './session.js';
import { SetupSheet } from './SetupSheet.js';
import { AddMoneySheet } from './SimpleSheets.js';
import { AddSheet } from './AddSheet.js';
import { NeedsYouCard, SettleUpSheet } from './SettleUp.js';
import { WalletTab } from './WalletTab.js';
import { Avatar, ErrorNotice, Icon, ToastProvider, useToast, type IconName } from './ui.js';
import { FloatingDock, useSwipeNav } from './dock.js';
import { AppPreloader } from './Preloader.js';
import { bootProgress, useBootProgress } from './boot-progress.js';
import { LoadingSteps } from './LoadingSteps.js';
import { Welcome } from './Welcome.js';
import { SignIn } from './SignIn.js';
import { navigate, useRoute } from './router.js';
import { BrandMark } from './BrandMark.js';
import { READINESS_POLL_CAP_MS, readinessPollDelays, runReadinessPoll } from './readiness-poll.js';
import { SiteFooter } from './SiteFooter.js';
import { applyTheme, nextTheme, readTheme, saveTheme, themeLabel, type ThemePref } from './theme.js';

/** Animation features load in their own chunk; `strict` rejects a stray full `motion.*` import. */
const loadMotion = () => import('./motion-features.js').then((mod) => mod.default);

type Tab = 'today' | 'activity' | 'patterns' | 'ask' | 'wallet';
/** The dock: four places and one "+" in the middle. Wallet lives in the account menu. */
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'patterns', label: 'Patterns', icon: 'chart' },
  { id: 'ask', label: 'Ask', icon: 'sparkle' },
];
const TAB_TITLES: Record<Tab, string> = { today: 'Today', activity: 'Activity', patterns: 'Patterns', ask: 'Ask', wallet: 'Wallet' };
/** Tab order drives swipe direction: left reveals the next tab, right the previous. */
const TAB_IDS: Tab[] = TABS.map((t) => t.id);

type Sheetname = null | 'add' | 'log' | 'setup' | 'settle';

const DEMO_STEPS: DemoStepId[] = ['baseline', 'log', 'income', 'patterns', 'pace'];

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

function loadDemoProgress(key: string): DemoStepId[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step): step is DemoStepId => typeof step === 'string' && (DEMO_STEPS as string[]).includes(step));
  } catch {
    return [];
  }
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

/** The logo always leads home: out of the sample household to the welcome page, or to Today in a wallet. */
function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <a
      className="brand"
      href="/"
      aria-label="Settle home"
      onClick={onHome ? (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onHome();
      } : undefined}
    >
      <BrandMark size={28} />
      <span className="brand-word">settle</span>
    </a>
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
  const demoKey = `settle:demo-progress:${me.id}`;
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

  const [tab, setTab] = useState<Tab>('today');
  const [demoProgress, setDemoProgress] = useState<DemoStepId[]>(() => (demo ? loadDemoProgress(demoKey) : []));
  const guideHiddenKey = `settle:demo-guide-hidden:${me.id}`;
  const [showDemoGuide, setShowDemoGuideState] = useState(() => !readFlag(guideHiddenKey));
  /** Showing or hiding the quest card is remembered per sample wallet. */
  const setShowDemoGuide = useCallback((show: boolean) => {
    setShowDemoGuideState(show);
    writeFlag(guideHiddenKey, !show);
  }, [guideHiddenKey]);
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [setupMode, setSetupMode] = useState<'onboarding' | 'edit'>('onboarding');
  const [setupStep, setSetupStep] = useState<0 | 1 | 2>(0);
  const [item, setItem] = useState<FeedItem | null>(null);
  const [logPreset, setLogPreset] = useState<{ category?: SpendCategory; amountMinor?: number }>({});
  const [addMode, setAddMode] = useState<'spent' | 'got'>('spent');
  const [settleMode, setSettleMode] = useState<'ask' | 'settle'>('ask');
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => readTheme());
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const route = useRoute();

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
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const markDemo = useCallback((step: DemoStepId) => {
    if (!demo) return;
    setDemoProgress((prev) => {
      if (prev.includes(step)) return prev;
      const next = [...prev, step];
      try {
        localStorage.setItem(demoKey, JSON.stringify(next));
      } catch {
        /* private mode: progress still works for this session */
      }
      return next;
    });
  }, [demo, demoKey]);

  useEffect(() => {
    if (!demo) {
      setDemoProgress([]);
      return;
    }
    setDemoProgress(loadDemoProgress(demoKey));
    setShowDemoGuideState(!readFlag(guideHiddenKey));
  }, [demo, demoKey, guideHiddenKey]);

  // Escape closes the quest card, unless a sheet or the menu has the key first.
  useEffect(() => {
    if (!demo || !showDemoGuide || sheet || menu) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setShowDemoGuide(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [demo, showDemoGuide, sheet, menu, setShowDemoGuide]);

  useEffect(() => {
    if (!demo || !data) return;
    if (data.view.moneyProfile?.walletCashMinor != null) markDemo('baseline');
  }, [demo, data, markDemo]);

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
    document.title = `${TAB_TITLES[tab]} · Settle`;
  }, [tab]);

  const go = (t: Tab) => {
    if (demo && t === 'patterns') markDemo('patterns');
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Swipe-driven navigation on the main pane. Vertical scrolling still wins.
  const swipe = useSwipeNav(TAB_IDS, tab, go);
  const closeSheet = () => setSheet(null);
  const openSettle = (mode: 'ask' | 'settle' = 'ask') => {
    setSettleMode(mode);
    setSheet('settle');
  };

  const openLog = (preset: { category?: SpendCategory; amountMinor?: number } = {}) => {
    setLogPreset(preset);
    setAddMode('spent');
    setSheet('log');
  };
  const openIncome = () => {
    setLogPreset({});
    setAddMode('got');
    setSheet('log');
  };

  const ask = (question?: string) => {
    if (question) setAskSeed(question);
    go('ask');
  };

  const openFeedItem = (feedItem: FeedItem) => setItem(feedItem);

  const handleDemoStep = (step: DemoStepId) => {
    switch (step) {
      case 'baseline':
        setSetupMode('edit');
        setSetupStep(0);
        setSheet('setup');
        break;
      case 'log':
        openLog();
        break;
      case 'income':
        openIncome();
        break;
      case 'patterns':
        go('patterns');
        break;
      case 'pace':
        setSetupMode('edit');
        setSetupStep(2);
        setSheet('setup');
        break;
    }
  };

  const demoGuide = demo && showDemoGuide ? (
    <DemoGuide
      progress={demoProgress}
      onStep={handleDemoStep}
      onDismiss={() => setShowDemoGuide(false)}
      onExit={() => {
        onSignOut();
        navigate({ kind: 'signup' });
      }}
      onPatterns={() => go('patterns')}
    />
  ) : null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand onHome={demo ? onSignOut : () => { setMenu(false); setSheet(null); go('today'); }} />
          {demo ? <button type="button" className="demo-pill" onClick={() => setShowDemoGuide(true)} title="Open the guided demo">Demo</button> : null}
          <span className="spacer" />
          <div className="top-actions">
            {refreshing ? <span className="sync-pill" role="status" aria-label="Updating your wallet"><span className="sync-dot" /></span> : null}
            <button type="button" className="theme-toggle" aria-label={themeLabel(theme)} title={themeLabel(theme)} onClick={() => {
              const next = nextTheme(theme);
              saveTheme(next);
              applyTheme(next);
              setTheme(next);
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {theme === 'light' ? (
                  <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
                ) : theme === 'dark' ? (
                  <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z" />
                ) : (
                  <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" /></>
                )}
              </svg>
            </button>
            <div className="menu-wrap" ref={menuRef}>
              <button type="button" className="wallet-chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <Avatar owner={me.owner} small />{who}
              </button>
              {menu ? (
                <div className="menu" role="menu">
                  {session.user ? <p className="menu-email">{session.user.email}</p> : null}
                  {session.household.length > 1 ? (
                    <>
                      <p className="menu-label">View as</p>
                      {session.household.filter((h) => h.id !== me.id).map((h) => (
                        <button key={h.id} type="button" role="menuitem" onClick={() => { setMenu(false); onSwitch({ account: h, household: session.household, demo: session.demo }); }}>
                          <Avatar owner={h.owner} small />{displayName(h.owner)}
                        </button>
                      ))}
                      <hr />
                    </>
                  ) : null}
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setSetupMode('edit'); setSetupStep(0); setSheet('setup'); }}>
                    <Icon name="settings" size={18} />Edit money snapshot
                  </button>
                  <a role="menuitem" href={`/api/accounts/${encodeURIComponent(me.id)}/statement.txt`}><Icon name="download" size={18} />Download statement</a>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); go('wallet'); }}><Icon name="wallet" size={18} />Wallet & trust</button>
                  <hr />
                  <button type="button" role="menuitem" onClick={onSignOut}><Icon name="logout" size={18} />{demo ? 'Exit sample' : 'Sign out'}</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="main" {...swipe}>
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
          <div className="view" key={tab}>
            {tab === 'today' ? (
              <Home
                me={me}
                name={session.user?.displayName}
                data={data}
                guide={demoGuide}
                actions={{
                  addMoney: () => setSheet('add'),
                  logSpend: openLog,
                  logIncome: openIncome,
                  settleUp: () => openSettle('ask'),
                  ask,
                  openItem: openFeedItem,
                  seeAll: () => go('activity'),
                  seeInsights: () => go('patterns'),
                  seeWallet: () => go('wallet'),
                  setup: (step) => {
                    setSetupMode(data?.view.moneyProfile?.walletCashMinor == null ? 'onboarding' : 'edit');
                    setSetupStep(step ?? 0);
                    setSheet('setup');
                  },
                }}
              />
            ) : null}
            {tab === 'activity' ? <ActivityTab data={data} onOpen={openFeedItem} /> : null}
            {tab === 'patterns' ? (
              <InsightsTab
                data={data}
                onLog={() => openLog()}
                onSetup={(step) => { setSetupMode('edit'); setSetupStep(step ?? 0); setSheet('setup'); }}
                onAsk={() => ask('What stands out about my spending this month?')}
                demo={demo}
                onDemoHome={demo ? () => { go('today'); setShowDemoGuide(true); } : undefined}
              />
            ) : null}
            {tab === 'ask' ? <AskTab accountId={me.id} boot={boot} seed={askSeed} onSeedUsed={() => setAskSeed(null)} /> : null}
            {tab === 'wallet' ? (
              <WalletTab
                me={me}
                data={data}
                viewer={{ email: session.user?.email, demo }}
                actions={{
                  setup: () => { setSetupMode(data?.view.moneyProfile?.walletCashMinor == null ? 'onboarding' : 'edit'); setSetupStep(0); setSheet('setup'); },
                  logIncome: openIncome,
                  addMoney: () => setSheet('add'),
                  ask: () => ask(),
                  signOut: onSignOut,
                  reload,
                }}
              />
            ) : null}
          </div>
        )}
      </main>

      <FloatingDock tabs={TABS} active={tab} onSelect={go} syncing={refreshing} onAdd={() => openLog()} addOpen={sheet === 'log'} />

      <AddMoneySheet open={sheet === 'add'} onClose={closeSheet} me={me} onChanged={reload} />
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
        onSpent={() => markDemo('log')}
        onIncome={() => markDemo('income')}
        onSplit={() => openSettle('ask')}
      />
      <SetupSheet
        open={sheet === 'setup'}
        onClose={closeSheet}
        me={me}
        profile={data?.view.moneyProfile}
        mode={setupMode}
        initialStep={setupStep}
        suggestedCashMinor={parseMoney(data?.view.balance)}
        onSaved={async (savedStep) => {
          await reload();
          if (savedStep === 2) markDemo('pace');
          else markDemo('baseline');
        }}
      />
      <ActivitySheet item={item} accountId={me.id} onClose={() => setItem(null)} onChanged={reload} />
      <SettleUpSheet open={sheet === 'settle'} onClose={closeSheet} me={me} onChanged={reload} initialMode={settleMode} />
    </>
  );
}
