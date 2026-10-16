import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMoney, MAX_DOLLARS_UI, parseDollarsToMinor } from '../server/money.js';
import { loadSavedWallets, rememberWallet } from './wallet-store.js';
import {
  api,
  type AccountActivity,
  type AccountRef,
  type AccountView,
  type BootstrapResponse,
  type LedgerEntryRow,
  type Turn,
} from './api.js';
import { GuidedLedgerStory } from './GuidedLedgerStory.js';
import { LedgerCharts } from './LedgerCharts.js';
import { RetryStorm } from './RetryStorm.js';
import { OFFLINE_BOOTSTRAP, PRACTICE_ALEX_ID } from './practice-fixture.js';
import { clearStoryComplete, isStoryComplete } from './tour-storage.js';

const PRACTICE_PREFIX = '01111111-1111-7111-8111-';

type Tab = 'overview' | 'ledger' | 'send' | 'activity' | 'ask';

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
  const [showStory, setShowStory] = useState(() => !isStoryComplete());
  const [tourHighlight, setTourHighlight] = useState<string | null>(null);

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
        setAccount({ id: v.id, owner: v.owner });
        rememberWallet({ id: v.id, owner: v.owner, live: !v.id.startsWith(PRACTICE_PREFIX), savedAt: new Date().toISOString() });
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

  function signIn(a: AccountRef, stopped?: string, live = false) {
    setStoppedId(stopped ?? null);
    setAccount(a);
    setBootError('');
    syncAccountUrl(a.id);
    rememberWallet({ id: a.id, owner: a.owner, live, savedAt: new Date().toISOString() });
  }

  function signOut() {
    setAccount(null);
    setStoppedId(null);
    syncAccountUrl(null);
  }

  return (
    <div className="root">
      <header className="topbar">
        <div>
          <span className="topbar-title">p2p-ledger</span>
          <span className="topbar-sub">/ corporate ledger terminal</span>
        </div>
        {account && (
          <button type="button" className="t-btn-inline" onClick={signOut}>[ sign out ]</button>
        )}
      </header>
      <main className="main">
        {booting && <p className="dim wait">loading…</p>}
        {bootError && !account && <p className="err">{bootError}</p>}
        {!booting && !account && showStory && (
          <GuidedLedgerStory
            onComplete={() => setShowStory(false)}
            onHandoff={(hook) => setTourHighlight(hook)}
          />
        )}
        {!booting && !account && !showStory && (
          <SignIn
            onSignIn={signIn}
            tourHighlight={tourHighlight}
            onReplayStory={() => {
              clearStoryComplete();
              setTourHighlight(null);
              setShowStory(true);
            }}
          />
        )}
        {!booting && account && (
          <Wallet account={account} stoppedTransferId={stoppedId} onSignOut={signOut} />
        )}
      </main>
    </div>
  );
}

function SignIn({
  onSignIn,
  tourHighlight,
  onReplayStory,
}: {
  onSignIn: (a: AccountRef, stopped?: string, live?: boolean) => void;
  tourHighlight?: string | null;
  onReplayStory?: () => void;
}) {
  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState(() => loadSavedWallets()[0]?.owner ?? '');
  const [busy, setBusy] = useState('');
  const [apiUp, setApiUp] = useState(false);
  const [saved, setSaved] = useState(() => loadSavedWallets());

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

  const practice = boot?.practice;

  async function createWallet() {
    const id = owner.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id) return;
    setBusy('create');
    setErr('');
    try {
      const a = await api.openAccount(id);
      onSignIn(a, undefined, boot.live);
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
      if (focus) onSignIn(focus, seeded.stopped.transferId, true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function openPractice(a: AccountRef) {
    if (!practice) return;
    const stopped = a.id === practice.focusAccountId ? practice.stoppedTransferId : undefined;
    onSignIn(a, stopped, false);
  }

  return (
    <>
      <p className="status-line">
        ledger-service:{' '}
        {!apiUp ? (
          <span className="off">API starting — practice accounts below work offline</span>
        ) : boot.live ? (
          <span className="live">ledger online</span>
        ) : (
          <span className="off">ledger offline — practice network</span>
        )}
        {boot.chat && (
          <span style={{ marginLeft: 12 }}>
            ask: {boot.chat.configured ? `${boot.chat.provider} ready` : `${boot.chat.provider} key missing — tool-only answers`}
          </span>
        )}
      </p>
      {boot.ledger?.persistence && (
        <p className="dim" style={{ fontSize: '11px', margin: '0 0 12px' }}>{boot.ledger.persistence}</p>
      )}

      <div className="help">
        <strong>ledger-service · system of record</strong>
        <p>
          PostgreSQL double-entry, idempotent HTTP API, fraud rules, outbox events.
          The assistant is a terminal over that API — not a second ledger.
        </p>
        {boot.ledger && (
          <ul className="cap-list">
            {boot.ledger.capabilities.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      {err && <p className="err" role="alert">{err}</p>}

      {onReplayStory && (
        <p className="dim" style={{ fontSize: '11px', margin: '0 0 12px' }}>
          <button type="button" className="t-btn-inline" onClick={onReplayStory}>[ replay visual intro ]</button>
        </p>
      )}

      {tourHighlight === 'tour-activity-hint' && (
        <p className="tour-callout">After sign-in, open the <strong>activity</strong> tab to see declined transfers.</p>
      )}
      {tourHighlight === 'tour-ledger-hint' && (
        <p className="tour-callout">After sign-in, open the <strong>ledger</strong> tab for append-only lines and statement download.</p>
      )}

      {saved.length > 0 && (
        <section className="pane">
          <div className="pane-hd"><strong>saved wallets</strong> · this browser</div>
          <div className="pane-bd">
            {saved.map((w) => (
              <button
                key={w.id}
                type="button"
                className="t-btn"
                onClick={() => onSignIn({ id: w.id, owner: w.owner }, undefined, w.live)}
              >
                {displayName(w.owner)} <span className="desc">{w.live ? 'PostgreSQL' : 'practice'} · {w.id.slice(0, 8)}…</span>
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
          <button type="button" className="t-btn recommended" disabled={busy !== '' || !owner.trim()} onClick={() => void createWallet()}>
            [ create &amp; open ]
          </button>
        </div>
      </section>

      {boot?.live && (
        <section className="pane">
          <div className="pane-hd"><strong>live demo world</strong></div>
          <div className="pane-bd">
            <button
              type="button"
              className={tourHighlight === 'tour-seed-live' ? 't-btn tour-pulse' : 't-btn'}
              data-tour-target="tour-seed-live"
              disabled={busy !== ''}
              onClick={() => void seedLive()}
            >
              [ seed live household on PostgreSQL ]
            </button>
            <p className="dim" style={{ fontSize: '11px', margin: '8px 0 0' }}>
              Creates distinct wallets (alex-/sam-/jordan-*) with deposits, P2P, utilities, reimbursements, and a declined rent.
            </p>
          </div>
        </section>
      )}

      <section className="pane">
        <div className="pane-hd"><strong>practice network</strong> · works offline</div>
        <div className="pane-bd">
          {practice?.accounts.map((a, i) => (
            <button
              key={a.id}
              type="button"
              data-tour-target={a.id === PRACTICE_ALEX_ID ? 'tour-practice-alex' : undefined}
              className={[
                a.id === practice.focusAccountId ? 't-btn recommended' : 't-btn',
                tourHighlight === 'tour-practice-alex' && a.id === PRACTICE_ALEX_ID ? 'tour-pulse' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => openPractice(a)}
            >
              <span className="key">[{i + 1}]</span> {displayName(a.owner)}
              <span className="desc">{a.role} — {a.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Wallet({
  account,
  stoppedTransferId,
  onSignOut,
}: {
  account: AccountRef;
  stoppedTransferId: string | null;
  onSignOut: () => void;
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
  const live = !account.id.startsWith(PRACTICE_PREFIX);

  return (
    <>
      <p className="status-line">
        signed in as <strong>{owner}</strong> · {live ? 'live ledger' : 'practice ledger'}
        <button type="button" className="t-btn-inline" style={{ marginLeft: 12 }} onClick={() => void reload()}>[ refresh ]</button>
      </p>

      <nav className="tabs" aria-label="Sections">
        {(['overview', 'ledger', 'send', 'activity', 'ask'] as Tab[]).map((t) => (
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

      {busy && tab !== 'ask' && <p className="dim wait">syncing…</p>}
      {err && <p className="err" role="alert">{err}</p>}

      {view && tab === 'overview' && (
        <Overview view={view} live={live} accountId={account.id} peers={peers} />
      )}
      {view && tab === 'ledger' && <LedgerStatement accountId={account.id} currency={view.currency} />}
      {view && tab === 'send' && (
        <SendPayment
          accountId={account.id}
          live={live}
          peers={peers}
          onDone={() => void reload()}
        />
      )}
      {view && tab === 'activity' && (
        <ActivityList transfers={view.transfers} stoppedTransferId={stoppedTransferId} />
      )}
      {tab === 'ask' && <SupportChat accountId={account.id} owner={owner} />}
    </>
  );
}

function Overview({
  view,
  live,
  accountId,
  peers,
}: {
  view: AccountView;
  live: boolean;
  accountId: string;
  peers: AccountRef[];
}) {
  const counterparty = peers.find((p) => p.id !== accountId);
  return (
    <>
      <section className="pane">
        <div className="pane-hd">
          <strong>cashflow</strong> · last 30 days · {live ? 'ledger-service' : 'practice mirror'}
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
            Income questions in Ask use these totals (summed in cents on the server).
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

function SupportChat({ accountId, owner }: { accountId: string; owner: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || lock.current) return;
    lock.current = true;
    const next = [...turns, { role: 'user' as const, text: q }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setErr('');
    try {
      const reply = await api.chat(accountId, next.slice(-12));
      setTurns([...next, { role: 'assistant', text: reply.answer, toolCalls: reply.toolCalls, model: reply.model }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="pane">
      <div className="pane-hd"><strong>ask</strong> · free text · {owner}</div>
      <div className="pane-bd">
        <p className="dim" style={{ margin: '0 0 8px', fontSize: '11px' }}>
          Examples: &quot;how much is my income this month&quot;, &quot;who paid me&quot;, &quot;why was rent declined&quot;, &quot;list last 5 payments&quot;
        </p>
        <div className="chat-log">
          {turns.map((t, i) => (
            <div key={i}>
              <div className={t.role === 'user' ? 'line-user' : 'line-bot'}>{t.text}</div>
              {t.toolCalls?.map((c, j) => (
                <details key={j} className="tool-block">
                  <summary>{c.tool}</summary>
                  <pre>{JSON.stringify(c.result, null, 2)}</pre>
                </details>
              ))}
            </div>
          ))}
          {busy && <p className="dim wait">…</p>}
          {err && <p className="err">{err}</p>}
          <div ref={end} />
        </div>
        <form
          className="input-row"
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
        >
          <label htmlFor="ask">›</label>
          <input
            id="ask"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ask anything about this account…"
            maxLength={2000}
          />
          <button type="submit" className="t-btn-inline" disabled={busy || !input.trim()}>[ send ]</button>
        </form>
      </div>
    </section>
  );
}

function rank(t: AccountActivity, stoppedId: string | null): number {
  if (stoppedId && t.transferId === stoppedId) return 0;
  if (t.status === 'REJECTED') return 1;
  return 2;
}
