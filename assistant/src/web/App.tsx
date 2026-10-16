import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  api,
  type AccountActivity,
  type AccountRef,
  type AccountView,
  type BootstrapResponse,
  type Integrity,
  type PaymentTrail,
  type RaceResult,
  type ReplayResult,
  type TamperReport,
  type Turn,
} from './api.js';
import { ActivityShell, useTrace } from './activity-log.js';
import { LedgerCharts } from './LedgerCharts.js';
import { OFFLINE_BOOTSTRAP } from './practice-fixture.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';

const SUGGESTIONS = [
  'Why was my rent payment declined?',
  "What's my balance?",
  'How much have I sent to each person this month?',
  'Send $50 to sam',
];

function personName(owner: string): string {
  if (owner.startsWith('Bank funding')) return 'Bank';
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function useAction<T>() {
  const [result, setResult] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn: () => Promise<T>) {
    setBusy(true);
    setError('');
    try {
      setResult(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { result, busy, error, run };
}

function Badge({ tone, children }: { tone: 'ok' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function App() {
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedTransferId, setStoppedTransferId] = useState<string | null>(null);
  const [booksVersion, setBooksVersion] = useState(0);
  const [auditMode, setAuditMode] = useState<'live' | 'practice' | 'unknown'>('unknown');

  useEffect(() => {
    void api.bootstrap().then((b) => {
      if (b.ledger?.auditCapabilities) setAuditMode('live');
      else setAuditMode(b.live ? 'unknown' : 'practice');
    }).catch(() => setAuditMode('practice'));
  }, []);

  return (
    <div className="root">
      <header className="topbar">
        <div>
          <span className="topbar-title">p2p-ledger</span>
          <span className="topbar-sub">/ ledger terminal</span>
        </div>
        <a className="t-btn-inline" href={REPO} target="_blank" rel="noreferrer">github</a>
      </header>
      <main className="main">
        <ActivityShell>
          {!account && (
            <SignInPane onPick={(a, stoppedId) => { setStoppedTransferId(stoppedId ?? null); setAccount(a); }} />
          )}
          <Books version={booksVersion} auditMode={auditMode} onAuditMode={setAuditMode} />
          {account && (
            <AccountScreen
              account={account}
              stoppedTransferId={stoppedTransferId}
              onChanged={() => setBooksVersion((v) => v + 1)}
              onSwitch={() => { setAccount(null); setStoppedTransferId(null); }}
            />
          )}
        </ActivityShell>
      </main>
    </div>
  );
}

function SignInPane({ onPick }: { onPick: (a: AccountRef, stoppedTransferId?: string) => void }) {
  const trace = useTrace();
  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    trace('GET /api/bootstrap');
    void api.bootstrap().then((b) => {
      setBoot(b);
      trace(`bootstrap · live=${b.live} · audit=${b.ledger?.auditCapabilities ? 'postgres' : 'practice-mirror'}`);
    }).catch(() => setBoot(OFFLINE_BOOTSTRAP));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once on mount
  }, []);

  async function createWallet(e: FormEvent) {
    e.preventDefault();
    const id = owner.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id) return;
    setBusy(true);
    setError('');
    trace(`POST /api/accounts · ownerId=${id}`);
    try {
      const a = await api.openAccount(id);
      trace(`ledger-service · account opened · ${a.id}`);
      onPick(a);
    } catch (err) {
      setError((err as Error).message);
      trace(`error · ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function openPractice(a: AccountRef, stopped?: string) {
    trace(`practice mirror · open ${a.owner} · ${a.id}`);
    onPick(a, stopped);
  }

  return (
    <>
      <div className="help">
        <strong>system of record</strong>
        <p>Balances come from PostgreSQL (live) or the in-memory practice mirror — not from this UI. Use the trace above to see each BFF → ledger call.</p>
      </div>
      <section className="pane">
        <div className="pane-hd"><strong>open account</strong> · POST /api/accounts</div>
        <form className="pane-bd" onSubmit={(e) => void createWallet(e)}>
          <div className="field">
            <label htmlFor="owner">owner id</label>
            <input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. alex.ap" />
          </div>
          <button type="submit" className="t-btn recommended" disabled={busy || !owner.trim()}>[ create &amp; open ]</button>
        </form>
      </section>
      <section className="pane">
        <div className="pane-hd"><strong>practice network</strong> · offline double-entry story</div>
        <div className="pane-bd">
          {boot.practice.accounts.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={a.id === boot.practice.focusAccountId ? 't-btn recommended' : 't-btn'}
              onClick={() => openPractice(
                a,
                a.id === boot.practice.focusAccountId ? boot.practice.stoppedTransferId : undefined,
              )}
            >
              <span className="key">[{i + 1}]</span> {personName(a.owner)}
              <span className="desc">{a.role} — {a.blurb}</span>
            </button>
          ))}
        </div>
      </section>
      {error && <p className="err" role="alert">{error}</p>}
    </>
  );
}

function Books({
  version,
  auditMode,
  onAuditMode,
}: {
  version: number;
  auditMode: 'live' | 'practice' | 'unknown';
  onAuditMode: (m: 'live' | 'practice' | 'unknown') => void;
}) {
  const trace = useTrace();
  const [books, setBooks] = useState<Integrity | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    trace('GET /api/integrity → GET /v1/ledger/integrity (or practice mirror)');
    try {
      const result = await api.integrity();
      setBooks(result);
      setProblem('');
      onAuditMode(result.source === 'live' ? 'live' : 'practice');
      trace(`integrity · ${result.source ?? 'unknown'} · balanced=${result.balanced} · entries=${result.entryCount} · sum=${result.entriesSum}`);
    } catch (e) {
      setProblem((e as Error).message);
      trace(`integrity failed · ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void check(); }, [version]);

  const delivery = books?.outbox.p95DeliveryMs ?? null;
  return (
    <section className="pane books-pane" id="books" aria-busy={busy}>
      <div className="pane-hd">
        <strong>reconciliation</strong>
        {books && <Badge tone={books.balanced ? 'ok' : 'bad'}>{books.balanced ? 'balanced' : 'out of balance'}</Badge>}
        {books && auditMode === 'live' && <Badge tone="ok">live · GET /v1/ledger/integrity</Badge>}
        {books && auditMode === 'practice' && <Badge tone="neutral">practice mirror</Badge>}
        {books && auditMode === 'unknown' && <Badge tone="neutral">checking…</Badge>}
      </div>
      <div className="pane-bd">
        <p className="dim" style={{ margin: '0 0 10px', fontSize: '12px' }}>
          {books ? `Checked ${clock(books.checkedAt)}` : problem || 'Running…'}
        </p>
        <button type="button" className="t-btn-inline" onClick={() => void check()} disabled={busy}>
          {busy ? '[ running… ]' : '[ run again ]'}
        </button>
        {books && (
          <dl className="kv-row" style={{ marginTop: 14 }}>
            <dl className="kv"><dt>entries sum</dt><dd>{books.entriesSum}</dd></dl>
            <dl className="kv"><dt>entries</dt><dd>{books.entryCount}</dd></dl>
            <dl className="kv"><dt>drift</dt><dd>{books.accountsDrifted}</dd></dl>
            <dl className="kv"><dt>declines w/ $</dt><dd>{books.rejectedWithEntries}</dd></dl>
            <dl className="kv"><dt>outbox p95</dt><dd>{delivery === null ? '—' : `${Math.round(delivery)} ms`}</dd></dl>
          </dl>
        )}
      </div>
    </section>
  );
}

function AccountScreen({ account, stoppedTransferId, onChanged, onSwitch }: {
  account: AccountRef;
  stoppedTransferId: string | null;
  onChanged: () => void;
  onSwitch: () => void;
}) {
  const trace = useTrace();
  const [view, setView] = useState<AccountView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<string | null>(stoppedTransferId);

  async function load(quiet = false) {
    if (!quiet) setBusy(true);
    setError('');
    trace(`GET /api/accounts?id=${account.id.slice(0, 8)}…`);
    try {
      setView(await api.account(account.id));
      trace('account view loaded · transfers + 30d summary');
    } catch (e) {
      if (!quiet) setView(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [account.id]);
  useEffect(() => { setOpen(stoppedTransferId); }, [stoppedTransferId]);

  const name = personName(view?.owner ?? account.owner);
  const transfers = view ? orderStoppedFirst(view.transfers, stoppedTransferId) : [];
  const people = view?.transfers.filter((t) => t.kind === 'TRANSFER') ?? [];
  const payer = people.find((t) => t.direction === 'received' && t.status === 'COMPLETED')
    ?? people.find((t) => t.status === 'COMPLETED')
    ?? people[0];

  return (
    <div className="workspace" id="workspace">
      <div className="main-col" aria-busy={busy}>
        <section className="pane">
          <div className="pane-hd">
            <strong>{name}</strong> · {view?.owner ?? account.owner} · <span className="mono-id">{shortId(account.id)}</span>
            <button type="button" className="t-btn-inline" style={{ marginLeft: 12 }} onClick={onSwitch}>[ switch ]</button>
          </div>
        </section>

        {busy && <div className="loading" aria-label="Loading account"><span /></div>}
        {!busy && error && !view && (
          <div className="inline-error">
            <p className="error" role="alert">{error}</p>
            <button type="button" className="t-btn-inline" onClick={() => void load()}>[ retry ]</button>
          </div>
        )}
        {!busy && view && (
          <>
            <dl className="kpis">
              <div className="kpi lead"><dt>Available balance</dt><dd>{view.balance}</dd></div>
              <div className="kpi"><dt>Sent · 30 days</dt><dd>{view.summary.sent}</dd></div>
              <div className="kpi"><dt>Received · 30 days</dt><dd>{view.summary.received}</dd></div>
              <div className="kpi"><dt>Stopped by rules</dt><dd className={view.summary.declinedCount ? 'bad-text' : ''}>{view.summary.stopped}</dd></div>
            </dl>
            <LedgerCharts view={view} accountId={account.id} />

            <div className="section-head">
              <h3>Payments</h3>
              <span className="muted small">Select a payment to inspect what the database holds for it.</span>
            </div>
            {transfers.length === 0
              ? <p className="muted">No payments yet.</p>
              : (
                <div className="table" role="table" aria-label="Payments">
                  <div className="thead" role="row">
                    <span role="columnheader">Description</span>
                    <span role="columnheader">Counterparty</span>
                    <span role="columnheader">Date</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader" className="num">Amount</span>
                  </div>
                  {transfers.map((t) => (
                    <div key={t.transferId} className={open === t.transferId ? 'tgroup open' : 'tgroup'}>
                      <PaymentRow transfer={t} open={open === t.transferId} onToggle={() => setOpen(open === t.transferId ? null : t.transferId)} />
                      {open === t.transferId && (
                        <PaymentDetail
                          accountId={account.id}
                          transferId={t.transferId}
                          onChanged={() => { void load(true); onChanged(); }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

            {payer && (
              <RetryStorm
                accountId={account.id}
                fromAccountId={payer.counterpartyAccountId}
                fromName={personName(payer.counterparty)}
                onDone={(transferId) => { void load(true); setOpen(transferId); onChanged(); }}
              />
            )}
          </>
        )}
      </div>
      <Chat account={account} name={name} />
    </div>
  );
}

function orderStoppedFirst(transfers: AccountActivity[], stoppedTransferId: string | null): AccountActivity[] {
  if (!stoppedTransferId) return transfers;
  return [...transfers].sort((a, b) => Number(b.transferId === stoppedTransferId) - Number(a.transferId === stoppedTransferId));
}

function PaymentRow({ transfer, open, onToggle }: { transfer: AccountActivity; open: boolean; onToggle: () => void }) {
  const trace = useTrace();
  const declined = transfer.status === 'REJECTED';
  const sign = transfer.direction === 'sent' ? '−' : '+';
  return (
    <button
      type="button"
      className="trow"
      role="row"
      onClick={() => {
        trace(open ? 'ui · collapse payment detail' : `ui · inspect transfer ${transfer.transferId.slice(0, 8)}…`);
        onToggle();
      }}
      aria-expanded={open}
    >
      <span className="cell desc" role="cell">
        <strong>{transfer.memo || (transfer.direction === 'deposit' ? 'Bank deposit' : 'Payment')}</strong>
        {declined && transfer.declineExplanation && <span className="reason">{transfer.declineExplanation}</span>}
      </span>
      <span className="cell" role="cell">
        <span className="muted">{transfer.direction === 'sent' ? 'To ' : transfer.direction === 'received' ? 'From ' : ''}</span>
        {transfer.direction === 'deposit' ? 'Bank funding' : personName(transfer.counterparty)}
      </span>
      <span className="cell muted" role="cell">{when(transfer.createdAt)}</span>
      <span className="cell" role="cell">
        <Badge tone={declined ? 'bad' : 'ok'}>{declined ? 'Declined' : 'Completed'}</Badge>
      </span>
      <span className={`cell num amount ${declined ? 'struck' : transfer.direction}`} role="cell">
        {declined ? transfer.amount : `${sign}${transfer.amount}`}
      </span>
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="step">
      <span className="step-n mono">{n}</span>
      <div className="step-body">
        <h4>{title}</h4>
        {children}
      </div>
    </li>
  );
}

function PaymentDetail({ accountId, transferId, onChanged }: { accountId: string; transferId: string; onChanged: () => void }) {
  const trace = useTrace();
  const [trail, setTrail] = useState<PaymentTrail | null>(null);
  const [error, setError] = useState('');
  const replay = useAction<ReplayResult>();
  const tamper = useAction<TamperReport>();

  useEffect(() => {
    let live = true;
    setTrail(null);
    setError('');
    trace(`GET /api/trail · transfer=${transferId.slice(0, 8)}…`);
    api.trail(accountId, transferId)
      .then((t) => {
        if (live) {
          setTrail(t);
          trace(`trail · ${t.status} · legs=${t.legs.length} · audited=${t.audited}`);
        }
      })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [accountId, transferId, trace]);

  if (error) return <div className="detail"><p className="error">{error}</p></div>;
  if (!trail) return <div className="detail"><div className="loading"><span /></div></div>;

  const declined = trail.status === 'REJECTED';
  const event = trail.events[0];
  const request = [
    `${trail.request.method} ${trail.request.path}`,
    trail.audited ? `Idempotency-Key: ${trail.request.idempotencyKey}` : 'Idempotency-Key: <stored with the transfer>',
    'Content-Type: application/json',
    '',
    JSON.stringify(trail.request.body, null, 2),
  ].join('\n');

  return (
    <div className="detail">
      <div className="detail-head">
        <span className="mono-id">transfer {trail.transferId}</span>
        <span className="dim"> · {trail.from} → {trail.to} · {trail.amount}</span>
        {!trail.audited && <Badge tone="neutral">statement fallback (no /trail on ledger yet)</Badge>}
      </div>
      <ol className="steps">
        <Step n={1} title="Decision">
          {declined ? (
            <p>
              Declined by <code>{trail.decline?.code}</code>. {trail.decline?.explanation}{' '}
              <span className="muted">The rule ran while both account rows were locked, so parallel requests cannot slip past a limit together.</span>
            </p>
          ) : (
            <p>
              {trail.amount} moved from {personName(trail.from)} to {personName(trail.to)}.{' '}
              <span className="muted">Both rows were locked in id order first, so two people paying each other at the same instant cannot deadlock.</span>
            </p>
          )}
        </Step>

        <Step n={2} title="Ledger entries">
          {trail.legs.length === 0 ? (
            <p>
              None posted. A declined payment moves no money.{' '}
              <span className="muted">Reconciliation counts any decline with entries, and that count stays at zero.</span>
            </p>
          ) : (
            <>
              <table className="grid">
                <thead><tr><th>Entry</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance after</th></tr></thead>
                <tbody>
                  {trail.legs.map((l) => (
                    <tr key={l.entryId}>
                      <td className="mono muted">#{l.entryId}</td>
                      <td>{personName(l.account)}</td>
                      <td className="num">{l.side === 'debit' ? l.amount : '—'}</td>
                      <td className="num">{l.side === 'credit' ? l.amount : '—'}</td>
                      <td className="num muted">{l.balanceAfter}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td /><td>Net</td><td colSpan={3} className="num"><Badge tone="ok">{trail.legsSum}</Badge></td></tr></tfoot>
              </table>
              <p className="muted small">A deferred Postgres trigger refuses to commit any payment whose entries do not net to zero.</p>
            </>
          )}
        </Step>

        <Step n={3} title="Event">
          {event ? (
            <p>
              <code>{event.type}</code> was written to the outbox in the same transaction as the money
              {event.publishedAt ? <>, then delivered to the queue <strong>{event.deliveryMs} ms</strong> later.</> : <>, and is queued for the relay.</>}{' '}
              <span className="muted">A failed commit leaves no event. A broker outage delays delivery but cannot lose it.</span>
            </p>
          ) : (
            <p className="muted">{trail.audited ? 'No event recorded.' : 'Shown once the updated ledger build is deployed.'}</p>
          )}
        </Step>

        <Step n={4} title="Request">
          <pre className="code">{request}</pre>
          {trail.audited ? (
            <>
              <div className="actions">
                <button type="button" className="t-btn-inline" disabled={replay.busy} onClick={() => void replay.run(async () => {
                  trace('POST /api/replay · Idempotency-Key replay');
                  const r = await api.replay(accountId, transferId);
                  trace(`replay · ${r.httpStatus} · replayed=${r.replayed}`);
                  onChanged();
                  return r;
                })}>
                  {replay.busy ? '[ sending… ]' : '[ replay request ]'}
                </button>
                <span className="muted small mono">body SHA-256 {trail.request.requestHash.slice(0, 12)}… · same key, different body → 422</span>
              </div>
              {replay.error && <p className="error">{replay.error}</p>}
              {replay.result && (
                <div className="result">
                  <Badge tone={replay.result.replayed && replay.result.sameTransfer ? 'ok' : 'bad'}>
                    {replay.result.httpStatus} · Idempotent-Replayed: {String(replay.result.replayed)}
                  </Badge>
                  <span>
                    Stored result returned{declined ? ', same decline, not re-evaluated' : ''}. Entries {replay.result.entriesBefore} → {replay.result.entriesAfter} ·
                    balance {replay.result.balanceBefore} → {replay.result.balanceAfter}
                  </span>
                </div>
              )}
            </>
          ) : <p className="muted small">Replay is enabled once the updated ledger build is deployed.</p>}
        </Step>

        {!declined && trail.audited && (
          <Step n={5} title="Try to change the books">
            <p className="muted">Four forbidden writes against these entries, each in a transaction that is always rolled back. The refusals come from Postgres, not the Java code.</p>
            <div className="actions">
              <button type="button" className="t-btn-inline" disabled={tamper.busy} onClick={() => void tamper.run(async () => {
                trace('POST /api/tamper → POST /v1/ledger/tamper-checks');
                return api.tamper(accountId, transferId);
              })}>
                {tamper.busy ? '[ attempting… ]' : '[ tamper checks ]'}
              </button>
            </div>
            {tamper.error && <p className="error">{tamper.error}</p>}
            {tamper.result && (
              <ul className="attempts">
                {tamper.result.attempts.map((a) => (
                  <li key={a.attempt}>
                    <div className="attempt-head">
                      <strong>{a.attempt}</strong>
                      <Badge tone={a.refused ? 'ok' : 'bad'}>{a.refused ? 'Refused' : 'Not refused'}</Badge>
                    </div>
                    <code className="sql">{a.sql}</code>
                    <span className="db-said mono">{a.databaseSaid}</span>
                  </li>
                ))}
              </ul>
            )}
          </Step>
        )}
      </ol>
    </div>
  );
}

function RetryStorm({ accountId, fromAccountId, fromName, onDone }: {
  accountId: string;
  fromAccountId: string;
  fromName: string;
  onDone: (transferId: string | null) => void;
}) {
  const trace = useTrace();
  const race = useAction<RaceResult>();
  const r = race.result;
  return (
    <section className="storm">
      <div className="section-head">
        <h3>Retry storm</h3>
        <span className="muted small">Concurrency test against the live database</span>
      </div>
      <p className="storm-copy">
        {fromName}&apos;s phone drops signal mid-payment and the app fires the same $5.00 request five times at once,
        all with one idempotency key. Postgres admits one and makes the others wait, then return the stored result.
      </p>
      <div className="actions">
        <button type="button" className="t-btn-inline" disabled={race.busy} onClick={() => void race.run(async () => {
          trace('POST /api/race · 5 parallel POST /v1/transfers · same Idempotency-Key');
          const result = await api.race(accountId, fromAccountId);
          trace(`race · distinctTransfers=${result.distinctTransfers} · entries=${result.entriesPosted ?? '—'}`);
          onDone(result.transferId);
          return result;
        })}>
          {race.busy ? '[ sending 5×… ]' : '[ race · 5 identical requests ]'}
        </button>
      </div>
      {race.error && <p className="error">{race.error}</p>}
      {r && (
        <>
          <table className="grid copies">
            <thead><tr><th>Copy</th><th>HTTP</th><th>Outcome</th><th className="num">Latency</th></tr></thead>
            <tbody>
              {r.attempts.map((a, i) => (
                <tr key={i}>
                  <td className="mono muted">#{i + 1}</td>
                  <td className="mono">{a.httpStatus}</td>
                  <td>{a.replayed ? 'Returned the stored payment' : a.status === 'REJECTED' ? 'Processed · declined' : 'Processed · money moved'}</td>
                  <td className="num mono muted">{a.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="result">
            <Badge tone={r.distinctTransfers === 1 ? 'ok' : 'bad'}>
              {r.copies} requests → {r.distinctTransfers} payment{r.distinctTransfers === 1 ? '' : 's'}
            </Badge>
            <span>
              {r.entriesPosted !== null && <>{r.entriesPosted} ledger entries posted.</>}
              {r.declineExplanation && <> Declined: {r.declineExplanation}</>}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function Chat({ account, name }: { account: AccountRef; name: string }) {
  const trace = useTrace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const sending = useRef(false);

  useEffect(() => {
    // Chrome 150+ makes scrollIntoView() return a Promise. Returning that from an
    // effect makes React call the Promise as cleanup, which throws "is not a function".
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, busy, error]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending.current) return;
    sending.current = true;
    const next: Turn[] = [...turns, { role: 'user', text: trimmed }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError('');
    try {
      trace('POST /api/chat · tools=ledger-readonly');
      const reply = await api.chat(account.id, next.slice(-10));
      for (const c of reply.toolCalls ?? []) {
        trace(`tool · ${c.tool} · ${c.ms}ms`);
      }
      setTurns([...next, { role: 'assistant', text: reply.answer, toolCalls: reply.toolCalls, model: reply.model }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <aside className="chat pane chat-terminal" aria-label={`Assistant for ${name}`}>
      <div className="pane-hd">
        <strong>support@ledger</strong> · read-only · scoped to {shortId(account.id)}
      </div>
      <div className="pane-bd chat-log">
        {turns.length === 0 && (
          <p className="dim chat-prompt">
            &gt; ask about balances, declines, or activity — tools hit GET /api/accounts only for this wallet.
          </p>
        )}
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="t-btn-inline" onClick={() => void send(s)}>{`> ${s}`}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'line-user' : 'line-bot'}>
            <span className="chat-prefix">{t.role === 'user' ? 'you%' : 'sys#'}</span>
            <div className="chat-body">
              <p>{t.text}</p>
              {t.toolCalls && t.toolCalls.length > 0 && (
                <details className="tool-trace">
                  <summary>{t.toolCalls.length} tool call{t.toolCalls.length > 1 ? 's' : ''}</summary>
                  {t.toolCalls.map((c, j) => (
                    <div key={j} className="tool-line">
                      <code>{c.tool}</code> <span className="dim">{c.ms}ms</span>
                      <pre>{JSON.stringify(c.result, null, 2)}</pre>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="dim chat-thinking">&gt; querying ledger…</p>}
        {error && <p className="err" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <span className="chat-prefix" aria-hidden="true">&gt;</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`message (${name})`}
          aria-label="Message"
          maxLength={2000}
          className="chat-input"
        />
        <button type="submit" className="t-btn-inline" disabled={busy || !input.trim()}>[ send ]</button>
      </form>
    </aside>
  );
}
