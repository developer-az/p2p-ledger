import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { parseDollarsToMinor } from '../server/money.js';
import { api, type AccountActivity, type AccountRef, type AccountView, type BootstrapResponse, type Turn } from './api.js';

const PRACTICE_PREFIX = '01111111-1111-7111-8111-';

type Tab = 'overview' | 'send' | 'activity' | 'ask';

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

  useEffect(() => {
    const id = accountFromUrl();
    if (!id) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    void api.account(id).then((v) => {
      if (!cancelled) {
        setAccount({ id: v.id, owner: v.owner });
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
          <span className="topbar-sub">/ payments + support</span>
        </div>
        {account && (
          <button type="button" className="t-btn-inline" onClick={signOut}>[ sign out ]</button>
        )}
      </header>
      <main className="main">
        {booting && <p className="dim wait">loading…</p>}
        {bootError && !account && <p className="err">{bootError}</p>}
        {!booting && !account && <SignIn onSignIn={signIn} />}
        {!booting && account && (
          <Wallet account={account} stoppedTransferId={stoppedId} onSignOut={signOut} />
        )}
      </main>
    </div>
  );
}

function SignIn({ onSignIn }: { onSignIn: (a: AccountRef, stopped?: string) => void }) {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void api.bootstrap().then(setBoot).catch((e) => setErr((e as Error).message));
  }, []);

  const practice = boot?.practice;

  async function createWallet() {
    const id = owner.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id) return;
    setBusy('create');
    setErr('');
    try {
      const a = await api.openAccount(id);
      onSignIn(a);
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
      if (focus) onSignIn(focus, seeded.stopped.transferId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function openPractice(a: AccountRef) {
    if (!practice) return;
    const stopped = a.id === practice.focusAccountId ? practice.stoppedTransferId : undefined;
    onSignIn(a, stopped);
  }

  return (
    <>
      <p className="status-line">
        ledger-service:{' '}
        {boot?.live ? <span className="live">online (docker)</span> : <span className="off">offline — practice network only</span>}
      </p>

      <div className="help">
        <strong>Sign in</strong>
        <p>
          Full P2P: send money, add funds, view cashflow, ask anything about your account.
          Live mode uses the Java ledger when Docker is up (<code>npm run dev:stack</code>).
        </p>
      </div>

      {err && <p className="err" role="alert">{err}</p>}

      <section className="pane">
        <div className="pane-hd"><strong>create wallet</strong></div>
        <div className="pane-bd">
          <div className="field">
            <label htmlFor="owner">owner id (your handle)</label>
            <input id="owner" type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. riley" />
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
            <button type="button" className="t-btn" disabled={busy !== ''} onClick={() => void seedLive()}>
              [ seed alex / sam / jordan on ledger ]
            </button>
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
              className={a.id === practice.focusAccountId ? 't-btn recommended' : 't-btn'}
              onClick={() => openPractice(a)}
            >
              <span className="key">[{i + 1}]</span> {displayName(a.owner)}
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
        {(['overview', 'send', 'activity', 'ask'] as Tab[]).map((t) => (
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

      {view && tab === 'overview' && <Overview view={view} />}
      {view && tab === 'send' && (
        <SendPayment
          accountId={account.id}
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

function Overview({ view }: { view: AccountView }) {
  return (
    <section className="pane">
      <div className="pane-hd"><strong>cashflow</strong> · last 30 days</div>
      <div className="pane-bd">
        <dl className="kv">
          <dt>available</dt>
          <dd>{view.balance}</dd>
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
  );
}

function SendPayment({
  accountId,
  peers,
  onDone,
}: {
  accountId: string;
  peers: AccountRef[];
  onDone: () => void;
}) {
  const [to, setTo] = useState(peers[0]?.id ?? '');
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
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
              {peers.length === 0 && <option value="">no peers yet</option>}
              {peers.map((p) => (
                <option key={p.id} value={p.id}>{displayName(p.owner)} ({p.owner})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="amt">amount (USD)</label>
            <input id="amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" />
          </div>
          <div className="field">
            <label htmlFor="memo">memo</label>
            <input id="memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="dinner split" />
          </div>
          <button type="submit" className="t-btn recommended" disabled={busy || peers.length === 0}>[ send payment ]</button>
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
