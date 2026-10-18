import { useCallback, useEffect, useRef, useState } from 'react';
import './app.css';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { ActivitySheet } from './ActivitySheet.js';
import { ActivityTab } from './ActivityTab.js';
import { AskTab } from './AskTab.js';
import { useWallet } from './data.js';
import type { FeedItem } from './feed.js';
import { displayName, parseMoney } from './format.js';
import { Home } from './Home.js';
import { InsightsTab } from './InsightsTab.js';
import { RequestSheet } from './RequestSheet.js';
import { SendSheet } from './SendSheet.js';
import { clearSession, loadSession, saveSession, type Session } from './session.js';
import { AddMoneySheet, LogSpendSheet } from './SimpleSheets.js';
import { TrustTab } from './TrustTab.js';
import { Avatar, ErrorNotice, Icon, ToastProvider, type IconName } from './ui.js';
import { Welcome } from './Welcome.js';

type Tab = 'home' | 'activity' | 'insights' | 'ask' | 'trust';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'activity', label: 'Activity', icon: 'list' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'ask', label: 'Ask', icon: 'chat' },
  { id: 'trust', label: 'Trust', icon: 'shield' },
];

type Sheetname = null | 'send' | 'split' | 'ask' | 'add' | 'log';

export function ConsumerApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());

  useEffect(() => {
    document.title = 'Settle · split bills and send money';
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
    <a className="brand" href="/">
      <span className="brand-mark" aria-hidden="true">S</span>Settle
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
  const { data, error, reload } = useWallet(me.id);
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<Sheetname>(null);
  const [sendTo, setSendTo] = useState<AccountRef | null>(null);
  const [item, setItem] = useState<FeedItem | null>(null);
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

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };
  const closeSheet = () => setSheet(null);
  const balanceMinor = Math.round((parseMoney(data?.view.balance) ?? 0) * 100);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <nav className="tabs" aria-label="Main">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>{t.label}</button>
            ))}
          </nav>
          <span className="spacer" />
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button type="button" className="wallet-chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Avatar owner={me.owner} small />{displayName(me.owner)}
            </button>
            {menu ? (
              <div className="menu" role="menu">
                {session.household.length > 1 ? (
                  <>
                    <p className="menu-label">View as</p>
                    {session.household.filter((h) => h.id !== me.id).map((h) => (
                      <button key={h.id} type="button" role="menuitem" onClick={() => { setMenu(false); onSwitch({ account: h, household: session.household }); }}>
                        <Avatar owner={h.owner} small />{displayName(h.owner)}
                      </button>
                    ))}
                    <hr />
                  </>
                ) : null}
                <a role="menuitem" href={`/api/accounts/${encodeURIComponent(me.id)}/statement.txt`}><Icon name="download" size={18} />Download statement</a>
                <button type="button" role="menuitem" onClick={onSignOut}><Icon name="logout" size={18} />Leave this wallet</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" className="main">
        {error && !data ? <ErrorNotice message={error} onRetry={() => void reload()} /> : null}
        {tab === 'home' ? (
          <Home
            me={me}
            data={data}
            actions={{
              send: (to) => { setSendTo(to ?? null); setSheet('send'); },
              split: () => setSheet('split'),
              addMoney: () => setSheet('add'),
              logSpend: () => setSheet('log'),
              openItem: setItem,
              seeAll: () => go('activity'),
              seeInsights: () => go('insights'),
              reload: () => void reload(),
            }}
          />
        ) : null}
        {tab === 'activity' ? <ActivityTab data={data} onOpen={setItem} /> : null}
        {tab === 'insights' ? <InsightsTab data={data} onLog={() => setSheet('log')} /> : null}
        {tab === 'ask' ? <AskTab accountId={me.id} boot={boot} /> : null}
        {tab === 'trust' ? <TrustTab me={me} data={data} live={boot.live} /> : null}
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
        open={sheet === 'split' || sheet === 'ask'}
        onClose={closeSheet}
        me={me}
        peers={data?.peers ?? []}
        initialMode={sheet === 'ask' ? 'ask' : 'split'}
        onChanged={() => void reload()}
      />
      <AddMoneySheet open={sheet === 'add'} onClose={closeSheet} me={me} onChanged={() => void reload()} />
      <LogSpendSheet open={sheet === 'log'} onClose={closeSheet} me={me} onChanged={() => void reload()} />
      <ActivitySheet item={item} accountId={me.id} onClose={() => setItem(null)} />
    </>
  );
}
