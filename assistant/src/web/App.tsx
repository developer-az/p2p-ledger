import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatMoney, MAX_DOLLARS_UI, parseDollarsToMinor } from '../server/money.js';
import { loadSavedWallets, rememberWallet } from './wallet-store.js';
import {
  api,
  type AccountActivity,
  type AccountRef,
  type AccountView,
  type BootstrapResponse,
  type LedgerEntryRow,
} from './api.js';
import { ActivityShell } from './activity-log.js';
import { LedgerCharts } from './LedgerCharts.js';
import { ResearchPoster } from './ResearchPoster.js';
import { RetryStorm } from './RetryStorm.js';
import { TerminalAssistant } from './TerminalAssistant.js';
import { OFFLINE_BOOTSTRAP } from './practice-fixture.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';
const PRACTICE_PREFIX = '01111111-1111-7111-8111-';

type Tab = 'overview' | 'ledger' | 'send' | 'activity';

function displayName(owner: string): string {
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function accountFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return id;
}

function syncAccountUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('id', id);
  else url.searchParams.delete('id');
  window.history.replaceState(null, '', url);
}

export function App() {
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const [booting, setBooting] = useState(() => accountFromUrl() !== null);
  const [bootError, setBootError] = useState('');
  const [chatMeta, setChatMeta] = useState({ provider: 'gemini', configured: false });

  useEffect(() => {
    void api.bootstrap().then((b) => {
      if (b.chat) setChatMeta({ provider: b.chat.provider, configured: b.chat.configured });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let id = accountFromUrl();
    if (!id) {
      const saved = loadSavedWallets()[0];
      if (saved) {
        id = saved.id;
        syncAccountUrl(id);
      }
    }
    if (!id) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    void api.account(id).then((v) => {
      if (!cancelled) {
        if (v.id.startsWith(PRACTICE_PREFIX)) {
          syncAccountUrl(null);
          setBootError('Practice wallets are disabled — use live PostgreSQL accounts below.');
          setBooting(false);
          return;
        }
        setAccount({ id: v.id, owner: v.owner });
        rememberWallet({ id: v.id, owner: v.owner, live: true, savedAt: new Date().toISOString() });
        setBooting(false);
      }
    }).catch(() => {
      if (!cancelled) {
        syncAccountUrl(null);
        setBootError('session expired — sign in again below');
        setBooting(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  function signIn(a: AccountRef, stopped?: string) {
    setStoppedId(stopped ?? null);
    setAccount(a);
    setBootError('');
    syncAccountUrl(a.id);
    rememberWallet({ id: a.id, owner: a.owner, live: true, savedAt: new Date().toISOString() });
  }

  function signOut() {
    setAccount(null);
    setStoppedId(null);
    syncAccountUrl(null);
  }

  return (
    <div className="root">
      <header className="gh-header">
        <a className="gh-brand" href="/">
          <span className="gh-mark" aria-hidden>L</span>
          <span className="gh-name">p2p-ledger</span>
        </a>
        <nav className="gh-nav" aria-label="Primary">
          <a href={REPO} target="_blank" rel="noreferrer">Repository</a>
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">Architecture</a>
        </nav>
        {account && (
          <button type="button" className="gh-btn" onClick={signOut}>Sign out</button>
        )}
      </header>
      <main className="main terminal-main">
        <ActivityShell>
          {booting && <p className="dim wait">loading wallet…</p>}
          {bootError && !account && <p className="err">{bootError}</p>}
          {!booting && !account && (
            <>
              <ResearchPoster />
              <SignIn onSignIn={signIn} />
            </>
          )}
          {!booting && account && (
            <Wallet
              account={account}
              stoppedTransferId={stoppedId}
              chatMeta={chatMeta}
            />
          )}
        </ActivityShell>
      </main>
    </div>
  );
}

function SignIn({ onSignIn }: { onSignIn: (a: AccountRef, stopped?: string) => void }) {
  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState(() => loadSavedWallets().find((w) => w.live)?.owner ?? '');
  const [busy, setBusy] = useState('');
  const [apiUp, setApiUp] = useState(false);
  const [saved, setSaved] = useState(() => loadSavedWallets().filter((w) => w.live));
  const [household, setHousehold] = useState<AccountRef[]>([]);

  useEffect(() => {
    void api.bootstrap()
      .then((b) => {
        setBoot(b);
        setApiUp(true);
        setErr('');
      })
      .catch((e) => {
        setApiUp(false);
        setErr((e as Error).message);
      });
  }, []);

  async function createWallet() {
    const id = owner.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id) return;
    setBusy('create');
    setErr('');
    try {
      const a = await api.openAccount(id);
      if (!boot.live) throw new Error('Live ledger is not reachable. Wait for Render to wake, then retry.');
      onSignIn(a);
      setSaved(loadSavedWallets());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function seedLive() {
    setBusy('seed');
    setErr('');
    try {
      const seeded = await api.seedDemo();
      const focus = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
      setHousehold(seeded.accounts);
      if (focus) onSignIn(focus, seeded.stopped.transferId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <p className="status-line">
        ledger-service:{' '}
        {!apiUp ? (
          <span className="off">API starting…</span>
        ) : boot.live ? (
          <span className="live">PostgreSQL online</span>
        ) : (
          <span className="off">waiting for Render — live wallets only</span>
        )}
      </p>

      {err && <p className="err" role="alert">{err}</p>}

      {saved.length > 0 && (
        <section className="pane">
          <div className="pane-hd"><strong>saved wallets</strong> · this browser</div>
          <div className="pane-bd">
            {saved.map((w) => (
              <button
                key={w.id}
                type="button"
                className="t-btn"
                onClick={() => onSignIn({ id: w.id, owner: w.owner })}
              >
                {displayName(w.owner)} <span className="desc">PostgreSQL · {w.id.slice(0, 8)}…</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="pane">
        <div className="pane-hd"><strong>create wallet</strong></div>
        <div className="pane-bd">
          <div className="field">
            <label htmlFor="owner">owner id (your handle)</label>
            <input id="owner" type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. riley.ap" />
            <p className="dim" style={{ fontSize: '11px', margin: '6px 0 0' }}>
              When ledger is online, wallet is stored in PostgreSQL and appears under saved wallets.
            </p>
          </div>
          <button type="button" className="t-btn recommended" disabled={busy !== '' || !owner.trim() || !boot.live} onClick={() => void createWallet()}>
            [ create &amp; open live wallet ]
          </button>
        </div>
      </section>

      <section className="pane">
        <div className="pane-hd"><strong>demo household</strong> · PostgreSQL on Render</div>
        <div className="pane-bd">
          <button
            type="button"
            className="t-btn recommended"
            disabled={busy !== '' || !boot.live}
            onClick={() => void seedLive()}
          >
            [ seed alex / sam / jordan household ]
          </button>
          <p className="dim" style={{ fontSize: '11px', margin: '8px 0 0' }}>
            Real wallets with deposits, P2P, utilities, reimbursements, and a declined rent — pick a role after seeding.
          </p>
          {household.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="step-label">play as</p>
              {household.map((a) => (
                <button key={a.id} type="button" className="t-btn" onClick={() => onSignIn(a)}>
                  {displayName(a.owner)} <span className="desc">{a.owner}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Wallet({
  account,
  stoppedTransferId,
  chatMeta,
}: {
  account: AccountRef;
  stoppedTransferId: string | null;
  chatMeta: { provider: string; configured: boolean };
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [view, setView] = useState<AccountView | null>(null);
  const [peers, setPeers] = useState<AccountRef[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const [v, p] = await Promise.all([
        api.account(account.id, 50),
        api.peers(account.id),
      ]);
      setView(v);
      setPeers(p);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [account.id]);

  useEffect(() => { void reload(); }, [reload]);

  const owner = displayName(view?.owner ?? account.owner);

  return (
    <div className="workspace-terminal">
      <div className="workspace-main">
      <p className="status-line">
        signed in as <strong>{owner}</strong> · PostgreSQL ledger-service
        <button type="button" className="t-btn-inline" style={{ marginLeft: 12 }} onClick={() => void reload()}>[ refresh ]</button>
      </p>

      <nav className="tabs" aria-label="Sections">
        {(['overview', 'ledger', 'send', 'activity'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'tab on' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {busy && <p className="dim wait">syncing…</p>}
      {err && <p className="err" role="alert">{err}</p>}

      {view && tab === 'overview' && (
        <Overview view={view} accountId={account.id} peers={peers} />
      )}
      {view && tab === 'ledger' && <LedgerStatement accountId={account.id} currency={view.currency} />}
      {view && tab === 'send' && (
        <SendPayment
          accountId={account.id}
          live
          peers={peers}
          onDone={() => void reload()}
        />
      )}
      {view && tab === 'activity' && (
        <ActivityList transfers={view.transfers} stoppedTransferId={stoppedTransferId} />
      )}
      </div>
      <TerminalAssistant
        accountId={account.id}
        owner={owner}
        llmReady={chatMeta.configured}
        llmProvider={chatMeta.provider}
      />
    </div>
  );
}

function Overview({
  view,
  accountId,
  peers,
}: {
  view: AccountView;
  accountId: string;
  peers: AccountRef[];
}) {
  const counterparty = peers.find((p) => p.id !== accountId);
  return (
    <>
      <section className="pane">
        <div className="pane-hd">
          <strong>cashflow</strong> · last 30 days · ledger-service
        </div>
        <div className="pane-bd">
          <dl className="kv">
            <dt>available</dt>
            <dd>{view.balance}</dd>
            <dt>account</dt>
            <dd className="mono-id">{view.id}</dd>
            <dt>opened</dt>
            <dd>{new Date(view.openedAt).toLocaleString()}</dd>
          </dl>
          <div className="kv-row">
            <dl className="kv"><dt>money in</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.inflow}</dd></dl>
            <dl className="kv"><dt>deposits</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.deposited}</dd></dl>
            <dl className="kv"><dt>from people</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.received}</dd></dl>
          </div>
          <div className="kv-row">
            <dl className="kv"><dt>sent out</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.sent}</dd></dl>
            <dl className="kv"><dt>declined</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.stopped}</dd></dl>
            <dl className="kv"><dt>count</dt><dd style={{ fontSize: '13px', color: 'var(--fg)' }}>{view.summary.declinedCount}</dd></dl>
          </div>
          <p className="dim" style={{ fontSize: '11px', margin: 0 }}>
            Ask in the support terminal — totals are summed in integer cents on the server.
          </p>
        </div>
      </section>
      <LedgerCharts view={view} accountId={accountId} />
      {counterparty && (
        <RetryStorm accountId={accountId} peers={[counterparty]} />
      )}
    </>
  );
}

function LedgerStatement({ accountId, currency }: { accountId: string; currency: string }) {
  const [rows, setRows] = useState<LedgerEntryRow[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.entries(accountId, 60).then((r) => {
      if (!cancelled) {
        setRows(r.entries);
        setErr('');
        setLoading(false);
      }
    }).catch((e) => {
      if (!cancelled) {
        setErr((e as Error).message);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [accountId]);

  return (
    <section className="pane">
      <div className="pane-hd">
        <strong>statement</strong> · GET /v1/accounts/…/entries · append-only lines
      </div>
      <div className="pane-bd">
        {loading && <p className="dim wait">loading entries…</p>}
        {err && <p className="err">{err}</p>}
        <p style={{ margin: '0 0 10px' }}>
          <a className="t-btn-inline" href={api.statementDownloadUrl(accountId)} download>
            [ download statement .txt ]
          </a>
          <button type="button" className="t-btn-inline" style={{ marginLeft: 8 }} onClick={() => window.print()}>
            [ print / save PDF ]
          </button>
        </p>
        {!loading && !err && rows.length === 0 && (
          <p className="dim">No posted lines yet — complete a deposit or transfer.</p>
        )}
        {rows.length > 0 && (
          <table className="stmt">
            <thead>
              <tr>
                <th>when</th>
                <th>transfer</th>
                <th>Δ</th>
                <th>balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.id}-${e.transferId}`}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="mono-id">{e.transferId.slice(0, 8)}…</td>
                  <td className={e.amountMinor >= 0 ? 'pos' : 'neg'}>
                    {formatMoney(e.amountMinor, currency)}
                  </td>
                  <td>{formatMoney(e.balanceAfterMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function SendPayment({
  accountId,
  live,
  peers,
  onDone,
}: {
  accountId: string;
  live: boolean;
  peers: AccountRef[];
  onDone: () => void;
}) {
  const [to, setTo] = useState(peers[0]?.id ?? '');
  const [handleLookup, setHandleLookup] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [depositAmt, setDepositAmt] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!to && peers[0]) setTo(peers[0].id);
  }, [peers, to]);

  async function pay(e: FormEvent) {
    e.preventDefault();
    const minor = parseDollarsToMinor(amount);
    if (!to || !minor) {
      setErr('pick a recipient and enter a valid amount');
      return;
    }
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const t = await api.transfer({
        sourceAccountId: accountId,
        destinationAccountId: to,
        amountMinor: minor,
        memo: memo.trim() || undefined,
      });
      setMsg(t.status === 'REJECTED'
        ? `declined: ${t.rejectionReason ?? 'unknown'}`
        : `sent · transfer ${t.id.slice(0, 8)}`);
      setAmount('');
      onDone();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addFunds(e: FormEvent) {
    e.preventDefault();
    const minor = parseDollarsToMinor(depositAmt);
    if (!minor) {
      setErr('enter a valid deposit amount');
      return;
    }
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api.deposit(accountId, minor);
      setMsg('deposit posted');
      setDepositAmt('');
      onDone();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <section className="pane">
        <div className="pane-hd"><strong>send</strong> · POST /api/transfers</div>
        <form className="pane-bd" onSubmit={(e) => void pay(e)}>
          <div className="field">
            <label htmlFor="to">to</label>
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)} disabled={peers.length === 0}>
              {peers.length === 0 && <option value="">no recipients yet</option>}
              {peers.map((p) => (
                <option key={p.id} value={p.id}>{displayName(p.owner)} ({p.owner})</option>
              ))}
            </select>
            {peers.length === 0 && live && (
              <p className="dim" style={{ fontSize: '11px', margin: '6px 0 0' }}>
                No history yet — use exact owner id from live seed (e.g. <code>sam-abc123</code>) below, or seed the household first.
              </p>
            )}
          </div>
          {live && (
            <div className="field">
              <label htmlFor="handle">pay by owner id (live ledger)</label>
              <input
                id="handle"
                type="text"
                value={handleLookup}
                onChange={(e) => setHandleLookup(e.target.value)}
                placeholder="sam-3f2a1b"
              />
              <button
                type="button"
                className="t-btn-inline"
                style={{ marginTop: 8 }}
                disabled={busy || !handleLookup.trim()}
                onClick={() => {
                  void (async () => {
                    setErr('');
                    try {
                      const matches = await api.findAccounts(handleLookup.trim());
                      if (matches.length === 0) throw new Error('No wallet with that owner id');
                      const hit = matches[0];
                      if (!hit) throw new Error('No wallet with that owner id');
                      if (matches.length > 1) throw new Error('Multiple wallets — use UUID from ledger tab');
                      setTo(hit.id);
                      setMsg(`recipient set · ${hit.owner}`);
                    } catch (ex) {
                      setErr((ex as Error).message);
                    }
                  })();
                }}
              >
                [ resolve owner ]
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor="amt">amount (USD)</label>
            <input id="amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`25.00 (max ${MAX_DOLLARS_UI.toLocaleString()})`} />
          </div>
          <div className="field">
            <label htmlFor="memo">memo</label>
            <input id="memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="dinner split" />
          </div>
          <button type="submit" className="t-btn recommended" disabled={busy || !to}>[ send payment ]</button>
        </form>
      </section>
      <section className="pane">
        <div className="pane-hd"><strong>add funds</strong> · bank deposit</div>
        <form className="pane-bd" onSubmit={(e) => void addFunds(e)}>
          <div className="field">
            <label htmlFor="dep">amount (USD)</label>
            <input id="dep" type="text" inputMode="decimal" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="100.00" />
          </div>
          <button type="submit" className="t-btn" disabled={busy}>[ deposit ]</button>
        </form>
      </section>
      {msg && <p className="ok" style={{ color: 'var(--action)' }}>{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function ActivityList({
  transfers,
  stoppedTransferId,
}: {
  transfers: AccountActivity[];
  stoppedTransferId: string | null;
}) {
  const sorted = [...transfers].sort((a, b) => rank(a, stoppedTransferId) - rank(b, stoppedTransferId));
  return (
    <section className="pane">
      <div className="pane-hd"><strong>activity</strong> · {sorted.length} rows</div>
      <div className="pane-bd">
        <table className="ledger">
          <thead>
            <tr><th>state</th><th>amount</th><th>type</th><th>detail</th></tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <TxRow key={t.transferId} t={t} mark={stoppedTransferId === t.transferId} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TxRow({ t, mark }: { t: AccountActivity; mark: boolean }) {
  const fail = t.status === 'REJECTED';
  return (
    <tr className={`${mark ? 'marked' : ''} ${fail ? 'fail' : ''}`}>
      <td>{fail ? 'REJECTED' : 'POSTED'}</td>
      <td>{t.amount}</td>
      <td>{t.direction}</td>
      <td>
        {t.memo ?? displayName(t.counterparty)}
        {t.declineExplanation && <><br /><span className="err" style={{ fontSize: '11px' }}>{t.declineExplanation}</span></>}
      </td>
    </tr>
  );
}

function rank(t: AccountActivity, stoppedId: string | null): number {
  if (stoppedId && t.transferId === stoppedId) return 0;
  if (t.status === 'REJECTED') return 1;
  return 2;
}
