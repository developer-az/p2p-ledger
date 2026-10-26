import { useCallback, useEffect, useRef, useState } from 'react';
import { LazyMotion } from 'motion/react';
import './app.css';
import { api, type BootstrapResponse, type SpendCategory } from '../api.js';
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
import { AddMoneySheet, IncomeSheet, LogSpendSheet } from './SimpleSheets.js';
import { NeedsYouCard, SettleUpSheet } from './SettleUp.js';
import { WalletTab } from './WalletTab.js';
import { Avatar, Confetti, ErrorNotice, Icon, ToastProvider, type IconName } from './ui.js';
import { FloatingDock, useSwipeNav } from './dock.js';
import { AppPreloader } from './Preloader.js';
import { Welcome } from './Welcome.js';
import { Pip } from './Pip.js';

/** Animation features load in their own chunk; `strict` rejects a stray full `motion.*` import. */
const loadMotion = () => import('./motion-features.js').then((mod) => mod.default);

type Tab = 'today' | 'activity' | 'patterns' | 'ask' | 'wallet';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'patterns', label: 'Patterns', icon: 'chart' },
  { id: 'ask', label: 'Ask', icon: 'sparkle' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
];
/** Tab order drives swipe direction: left reveals the next tab, right the previous. */
const TAB_IDS: Tab[] = TABS.map((t) => t.id);

type Sheetname = null | 'add' | 'log' | 'income' | 'setup' | 'settle';

const DEMO_STEPS: DemoStepId[] = ['baseline', 'log', 'income', 'patterns', 'pace'];

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

  useEffect(() => {
    document.title = 'Settle · know your money, keep the habit';
    document.documentElement.classList.add('settle-smooth-scroll');
    const minSplash = new Promise<void>((resolve) => { window.setTimeout(resolve, 720); });
    void Promise.all([
      api.bootstrap().then(setBoot).catch((e: Error) => setBootError(e.message)),
      minSplash,
    ]).finally(() => setBootReady(true));
    return () => document.documentElement.classList.remove('settle-smooth-scroll');
  }, []);

  const start = useCallback((next: Session) => {
    saveSession(next);
    setSession(next);
  }, []);
  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return (
    <LazyMotion features={loadMotion} strict>
      <ToastProvider>
        <AppPreloader visible={!bootReady} />
        <div className={`app${bootReady ? ' app-ready' : ''}`}>
          <a className="skip" href="#main">Skip to content</a>
          {session && boot ? (
            <Signed boot={boot} session={session} onSwitch={start} onSignOut={signOut} />
          ) : (
            <>
              <main id="main" className="main main-welcome">
                <Welcome boot={boot} bootError={bootError} onStart={start} />
              </main>
            </>
          )}
          <footer className="footer">
            <span>Settle is a demo. No real money moves.</span>
            <a href="/ops">Engineering console</a>
            <a href="https://github.com/developer-az/p2p-ledger" target="_blank" rel="noreferrer">GitHub</a>
          </footer>
        </div>
      </ToastProvider>
    </LazyMotion>
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Settle home">
      <Pip size={30} track={false} mood="happy" />
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
  const demoKey = `settle:demo-progress:${me.id}`;
  const { data, error, refreshing, reload, run: walletRun } = useWallet(me.id);
  const [tab, setTab] = useState<Tab>('today');
  const [demoProgress, setDemoProgress] = useState<DemoStepId[]>(() => (demo ? loadDemoProgress(demoKey) : []));
  const [showDemoGuide, setShowDemoGuide] = useState(true);
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [setupMode, setSetupMode] = useState<'onboarding' | 'edit'>('onboarding');
  const [setupStep, setSetupStep] = useState<0 | 1 | 2>(0);
  const [item, setItem] = useState<FeedItem | null>(null);
  const [logPreset, setLogPreset] = useState<{ category?: SpendCategory; amountMinor?: number }>({});
  const [settleMode, setSettleMode] = useState<'ask' | 'settle'>('ask');
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    setShowDemoGuide(true);
  }, [demo, demoKey]);

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

  const go = (t: Tab) => {
    if (demo && t === 'patterns') markDemo('patterns');
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Swipe-driven navigation on the main pane. Vertical scrolling still wins.
  const swipe = useSwipeNav(TAB_IDS, tab, go);
  const closeSheet = () => setSheet(null);
  const celebrate = () => setBurst(Date.now());
  const openSettle = (mode: 'ask' | 'settle' = 'ask') => {
    setSettleMode(mode);
    setSheet('settle');
  };

  const openLog = (preset: { category?: SpendCategory; amountMinor?: number } = {}) => {
    setLogPreset(preset);
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
        setSheet('income');
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
        window.setTimeout(() => {
          document.getElementById('own-wallet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 450);
      }}
      onPatterns={() => go('patterns')}
    />
  ) : null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          {demo ? <button type="button" className="demo-pill" onClick={() => setShowDemoGuide(true)} title="Open the guided demo">Demo</button> : null}
          <span className="spacer" />
          <div className="top-actions">
            {refreshing ? <span className="sync-pill" role="status" aria-label="Updating your wallet"><span className="sync-dot" /></span> : null}
            <button type="button" className="top-ask" onClick={() => ask()} title="Ask about your money">
              <Icon name="sparkle" size={16} /><span>Ask</span>
            </button>
            <div className="menu-wrap" ref={menuRef}>
              <button type="button" className="wallet-chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <Avatar owner={me.owner} small />{displayName(me.owner)}
              </button>
              {menu ? (
                <div className="menu" role="menu">
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
                  <button type="button" role="menuitem" onClick={onSignOut}><Icon name="logout" size={18} />Leave this wallet</button>
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
        <div className="view" key={tab}>
          {tab === 'today' ? (
            <Home
              me={me}
              data={data}
              guide={demoGuide}
              cheer={burst}
              actions={{
                addMoney: () => setSheet('add'),
                logSpend: openLog,
                logIncome: () => setSheet('income'),
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
              actions={{
                setup: () => { setSetupMode(data?.view.moneyProfile?.walletCashMinor == null ? 'onboarding' : 'edit'); setSetupStep(0); setSheet('setup'); },
                logIncome: () => setSheet('income'),
                addMoney: () => setSheet('add'),
                ask: () => ask(),
                signOut: onSignOut,
              }}
            />
          ) : null}
        </div>
      </main>

      <FloatingDock tabs={TABS} active={tab} onSelect={go} syncing={refreshing} />

      {tab !== 'today' ? (
        <button type="button" className="fab" onClick={() => openLog()} aria-label="Log what you spent">
          <Icon name="plus" size={24} /><span>I spent $</span>
        </button>
      ) : null}

      <AddMoneySheet open={sheet === 'add'} onClose={closeSheet} me={me} onChanged={reload} />
      <IncomeSheet open={sheet === 'income'} onClose={closeSheet} me={me} onChanged={reload} walletRun={walletRun} onLogged={() => markDemo('income')} />
      <LogSpendSheet
        open={sheet === 'log'}
        onClose={closeSheet}
        me={me}
        recent={data?.view.spendEntries ?? []}
        initialCategory={logPreset.category}
        initialAmount={logPreset.amountMinor}
        onChanged={reload}
        walletRun={walletRun}
        onLogged={() => { celebrate(); markDemo('log'); }}
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
      <Confetti burst={burst} />
    </>
  );
}
