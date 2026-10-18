import { useCallback, useEffect, useRef, useState } from 'react';
import './app.css';
import { api, type AccountRef, type BootstrapResponse, type SpendCategory } from '../api.js';
import { ActivitySheet } from './ActivitySheet.js';
import { ActivityTab } from './ActivityTab.js';
import { AskTab } from './AskTab.js';
import { useWallet } from './data.js';
import { buildFeed, type FeedItem } from './feed.js';
import { DemoGuide, type DemoStepId } from './DemoGuide.js';
import { displayName, parseMoney } from './format.js';
import { Home } from './Home.js';
import { InsightsTab } from './InsightsTab.js';
import { RequestSheet } from './RequestSheet.js';
import { SendSheet } from './SendSheet.js';
import { clearSession, loadSession, saveSession, type Session } from './session.js';
import { SetupSheet } from './SetupSheet.js';
import { AddMoneySheet, IncomeSheet, LogSpendSheet } from './SimpleSheets.js';
import { WalletTab } from './WalletTab.js';
import { Avatar, Confetti, ErrorNotice, Icon, ToastProvider, type IconName } from './ui.js';
import { Welcome } from './Welcome.js';

type Tab = 'today' | 'activity' | 'patterns' | 'ask' | 'wallet';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'patterns', label: 'Patterns', icon: 'chart' },
  { id: 'ask', label: 'Ask', icon: 'sparkle' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
];

type Sheetname = null | 'send' | 'split' | 'add' | 'log' | 'income' | 'setup';

const DEMO_STEPS: DemoStepId[] = ['baseline', 'log', 'split', 'pay', 'receipt'];

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

  useEffect(() => {
    document.title = 'Settle · know your money, settle with friends';
    api.bootstrap().then(setBoot).catch((e: Error) => setBootError(e.message));
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
    <ToastProvider>
      <div className="app">
        <a className="skip" href="#main">Skip to content</a>
        {session && boot ? (
          <Signed boot={boot} session={session} onSwitch={start} onSignOut={signOut} />
        ) : (
          <>
            <header className="topbar"><div className="topbar-inner"><Brand /></div></header>
            <main id="main" className="main">
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
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Settle home">
      <span className="brand-mark" aria-hidden="true">S</span>
      <span className="brand-word">Settle</span>
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
  const { data, error, reload } = useWallet(me.id);
  const [tab, setTab] = useState<Tab>('today');
  const [demoProgress, setDemoProgress] = useState<DemoStepId[]>(() => (demo ? loadDemoProgress(demoKey) : []));
  const [showDemoGuide, setShowDemoGuide] = useState(true);
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [setupMode, setSetupMode] = useState<'onboarding' | 'edit'>('onboarding');
  const [setupStep, setSetupStep] = useState<0 | 1 | 2>(0);
  const [sendTo, setSendTo] = useState<AccountRef | null>(null);
  const [item, setItem] = useState<FeedItem | null>(null);
  const [logPreset, setLogPreset] = useState<{ category?: SpendCategory; amountMinor?: number }>({});
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

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const closeSheet = () => setSheet(null);
  const balanceMinor = Math.round((parseMoney(data?.view.balance) ?? 0) * 100);
  const celebrate = () => setBurst(Date.now());

  const openLog = (preset: { category?: SpendCategory; amountMinor?: number } = {}) => {
    setLogPreset(preset);
    setSheet('log');
  };

  const ask = (question?: string) => {
    if (question) setAskSeed(question);
    go('ask');
  };

  const openFeedItem = (feedItem: FeedItem) => {
    if (demo && feedItem.transferId) markDemo('receipt');
    setItem(feedItem);
  };

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
      case 'split':
        setSheet('split');
        break;
      case 'pay':
        if (tab !== 'today') go('today');
        window.setTimeout(() => {
          document.getElementById('needs-you')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        break;
      case 'receipt': {
        const feed = data ? buildFeed(data.view) : [];
        const first = feed.find((entry) => entry.transferId);
        if (first) openFeedItem(first);
        else go('activity');
        break;
      }
    }
  };

  const demoGuide = demo && showDemoGuide ? (
    <DemoGuide
      data={data}
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
          <nav className="tabs" aria-label="Main">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <div className="top-actions">
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

      <main id="main" className="main">
        {error && !data ? <ErrorNotice message={error} onRetry={() => void reload()} /> : null}
        <div className="view" key={tab}>
          {tab === 'today' ? (
            <Home
              me={me}
              data={data}
              guide={demoGuide}
              actions={{
                send: (to) => { setSendTo(to ?? null); setSheet('send'); },
                split: () => setSheet('split'),
                addMoney: () => setSheet('add'),
                logSpend: openLog,
                logIncome: () => setSheet('income'),
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
                requestPaid: () => markDemo('pay'),
                reload: () => void reload(),
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
            />
          ) : null}
          {tab === 'ask' ? <AskTab accountId={me.id} boot={boot} seed={askSeed} onSeedUsed={() => setAskSeed(null)} /> : null}
          {tab === 'wallet' ? (
            <WalletTab
              me={me}
              data={data}
              boot={boot}
              actions={{
                setup: () => { setSetupMode(data?.view.moneyProfile?.walletCashMinor == null ? 'onboarding' : 'edit'); setSetupStep(0); setSheet('setup'); },
                logIncome: () => setSheet('income'),
                addMoney: () => setSheet('add'),
                send: (to) => { setSendTo(to ?? null); setSheet('send'); },
                split: () => setSheet('split'),
                ask: () => ask(),
                reload: () => void reload(),
                requestPaid: () => markDemo('pay'),
                signOut: onSignOut,
              }}
            />
          ) : null}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Main">
        <div className="bottom-nav-inner">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="bottom-tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <Icon name={t.icon} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {tab !== 'today' ? (
        <button type="button" className="fab" onClick={() => openLog()} aria-label="Log a spend">
          <Icon name="plus" size={24} /><span>Log spend</span>
        </button>
      ) : null}

      <SendSheet
        open={sheet === 'send'}
        onClose={closeSheet}
        me={me}
        balanceMinor={balanceMinor}
        peers={data?.peers ?? []}
        initialTo={sendTo}
        onChanged={() => void reload()}
        onAddMoney={() => setSheet('add')}
      />
      <RequestSheet
        open={sheet === 'split'}
        onClose={closeSheet}
        me={me}
        peers={data?.peers ?? []}
        initialMode="split"
        onChanged={() => void reload()}
        onCompleted={() => markDemo('split')}
      />
      <AddMoneySheet open={sheet === 'add'} onClose={closeSheet} me={me} onChanged={() => void reload()} />
      <IncomeSheet open={sheet === 'income'} onClose={closeSheet} me={me} onChanged={() => void reload()} />
      <LogSpendSheet
        open={sheet === 'log'}
        onClose={closeSheet}
        me={me}
        recent={data?.view.spendEntries ?? []}
        initialCategory={logPreset.category}
        initialAmount={logPreset.amountMinor}
        onChanged={() => void reload()}
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
        onSaved={() => void reload()}
      />
      <ActivitySheet item={item} accountId={me.id} onClose={() => setItem(null)} onChanged={() => void reload()} />
      <Confetti burst={burst} />
    </>
  );
}
