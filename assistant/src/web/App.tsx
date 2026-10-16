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
import { GuidedLedgerStory } from './GuidedLedgerStory.js';
import { LedgerCharts } from './LedgerCharts.js';
import { PipelineStage } from './pipeline/PipelineStage.js';
import { mapTrailToPipelineSteps } from './pipeline/pipeline-script.js';
import { OFFLINE_BOOTSTRAP, PRACTICE_ALEX_ID } from './practice-fixture.js';
import { clearStoryComplete, isStoryComplete } from './tour-storage.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';

const SUGGESTIONS = [
  'Why was my rent payment declined?',
  "What's my balance?",
  'How much have I sent to each person this month?',
  'Send $50 to sam',
];

const GUARANTEES = [
  ['Double-entry, enforced by Postgres', 'Every payment posts a debit and a credit. A deferred trigger refuses any commit whose legs do not sum to zero.'],
  ['Retries cannot charge twice', 'The idempotency key is a unique column. Identical requests in flight together resolve to one payment.'],
  ['Posted money cannot be edited', 'Entries are append-only at the database level, so a bug in application code cannot rewrite history.'],
  ['Every payment emits an event', 'A transactional outbox relays events to SQS or Kafka. Nothing is lost, and nothing is sent for a rolled-back payment.'],
] as const;

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

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
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
  const [showStory, setShowStory] = useState(() => !isStoryComplete());
  const [tourHighlight, setTourHighlight] = useState<string | null>(null);
  const [auditLive, setAuditLive] = useState<boolean | null>(null);

  useEffect(() => {
    void api.bootstrap().then((b) => setAuditLive(b.ledger?.auditCapabilities ?? false)).catch(() => setAuditLive(false));
  }, []);

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); setAccount(null); setStoppedTransferId(null); }}>
            <span className="brand-mark" aria-hidden>L</span>
            Ledger
          </a>
          <nav className="nav">
            <a href="#books">Reconciliation</a>
            <a href="#workspace">Payments</a>
            <a href="#architecture">Architecture</a>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
      </header>
      <main className="shell">
        {!account && showStory && (
          <GuidedLedgerStory
            onComplete={() => setShowStory(false)}
            onHandoff={(hook) => setTourHighlight(hook)}
          />
        )}
        {!account && !showStory && (
          <Hero
            tourHighlight={tourHighlight}
            onReplayStory={() => {
              clearStoryComplete();
              setTourHighlight(null);
              setShowStory(true);
            }}
            onPick={(a, stoppedId) => { setStoppedTransferId(stoppedId ?? null); setAccount(a); }}
          />
        )}
        <Books version={booksVersion} auditLive={auditLive} />
        {account && (
          <AccountScreen
            account={account}
            stoppedTransferId={stoppedTransferId}
            onChanged={() => setBooksVersion((v) => v + 1)}
            onSwitch={() => { setAccount(null); setStoppedTransferId(null); }}
          />
        )}
        <Architecture />
      </main>
    </>
  );
}

function Hero({
  onPick,
  tourHighlight,
  onReplayStory,
}: {
  onPick: (a: AccountRef, stoppedTransferId?: string) => void;
  tourHighlight?: string | null;
  onReplayStory?: () => void;
}) {
  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [owner, setOwner] = useState('');
  const [found, setFound] = useState<AccountRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api.bootstrap().then(setBoot).catch(() => setBoot(OFFLINE_BOOTSTRAP));
  }, []);

  async function demo() {
    setBusy(true);
    setError('');
    try {
      const seeded = await api.seedDemo();
      const sender = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
      if (sender) onPick(sender, seeded.stopped.transferId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function find(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setFound(await api.findAccounts(owner));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="kicker">Payments infrastructure</p>
        <h1>A ledger that can prove every number it shows.</h1>
        <p className="lede">
          Double-entry books on PostgreSQL behind a Java service, with a support assistant that can only quote
          what the ledger recorded. Balances are not simulated in the browser.
        </p>
        {onReplayStory && (
          <p className="muted small">
            <button type="button" className="btn ghost small" onClick={onReplayStory}>Replay visual intro</button>
          </p>
        )}
        <div className="hero-actions">
          <button
            className={tourHighlight === 'tour-seed-live' ? 'btn primary tour-pulse' : 'btn primary'}
            disabled={busy || !boot.live}
            onClick={() => void demo()}
          >
            {busy ? 'Opening accounts…' : 'Run the live demo'}
          </button>
          <span className="muted small">Opens three wallets on PostgreSQL. One payment is stopped by fraud rules.</span>
        </div>
        {boot.practice?.accounts.length > 0 && (
          <ul className="found practice-pick">
            {boot.practice.accounts.map((a, i) => (
              <li key={a.id}>
                <button
                  className={tourHighlight === 'tour-practice-alex' && a.id === PRACTICE_ALEX_ID ? 'tour-pulse' : ''}
                  onClick={() => onPick(a, a.id === boot.practice.focusAccountId ? boot.practice.stoppedTransferId : undefined)}
                >
                  <strong>[{i + 1}] {personName(a.owner)}</strong>
                  <span className="mono muted">{a.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="lookup" onSubmit={(e) => void find(e)}>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Look up an existing owner id" aria-label="Owner id" />
          <button className="btn" disabled={busy || !owner.trim()}>Find</button>
        </form>
        {found && (found.length === 0
          ? <p className="muted small">No accounts for that owner.</p>
          : (
            <ul className="found">
              {found.map((a) => (
                <li key={a.id}>
                  <button onClick={() => onPick(a)}>
                    <strong>{personName(a.owner)}</strong>
                    <span className="mono muted">{a.owner}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <ol className="guarantees">
        {GUARANTEES.map(([title, body], i) => (
          <li key={title}>
            <span className="index mono">0{i + 1}</span>
            <div>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Books({ version, auditLive }: { version: number; auditLive: boolean | null }) {
  const [books, setBooks] = useState<Integrity | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setBooks(await api.integrity());
      setProblem('');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void check(); }, [version]);

  const delivery = books?.outbox.p95DeliveryMs ?? null;
  return (
    <section className="books" id="books" aria-busy={busy}>
      <div className="books-head">
        <div className="books-title">
          <h2>Reconciliation</h2>
          {books && <Badge tone={books.balanced ? 'ok' : 'bad'}>{books.balanced ? 'Balanced' : 'Out of balance'}</Badge>}
          {!books && problem && <Badge tone="neutral">Unavailable</Badge>}
          {auditLive === false && <Badge tone="neutral">Partial proof · redeploy ledger on Render</Badge>}
          {auditLive === true && <Badge tone="ok">Full live proof</Badge>}
        </div>
        <div className="books-meta">
          <span className="muted small">
            {books ? `Recomputed from raw entries at ${clock(books.checkedAt)}` : problem || 'Reconciling…'}
          </span>
          <button className="btn ghost small" onClick={() => void check()} disabled={busy}>{busy ? 'Running…' : 'Run again'}</button>
        </div>
      </div>
      {books && (
        <dl className="metrics">
          <Metric label="Sum of all entries" value={books.entriesSum} note={count(books.entryCount, 'entry', 'entries')} />
          <Metric label="Balance drift" value={`${books.accountsDrifted}`} note={`of ${count(books.accountCount, 'account')}`} />
          <Metric label="Unbalanced payments" value={`${books.unbalancedTransfers}`} note={`of ${count(books.transferCount, 'payment')}`} />
          <Metric label="Declines that moved money" value={`${books.rejectedWithEntries}`} note="must stay zero" />
          <Metric
            label="Events delivered"
            value={(books.outbox.total - books.outbox.pending).toLocaleString()}
            note={[delivery === null ? null : `p95 ${Math.round(delivery)} ms`, books.outbox.pending ? `${books.outbox.pending} queued` : null].filter(Boolean).join(' · ') || 'none yet'}
          />
        </dl>
      )}
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <span className="metric-note">{note}</span>}
    </div>
  );
}

function AccountScreen({ account, stoppedTransferId, onChanged, onSwitch }: {
  account: AccountRef;
  stoppedTransferId: string | null;
  onChanged: () => void;
  onSwitch: () => void;
}) {
  const [view, setView] = useState<AccountView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<string | null>(stoppedTransferId);

  async function load(quiet = false) {
    if (!quiet) setBusy(true);
    setError('');
    try {
      setView(await api.account(account.id));
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
        <div className="account-head">
          <div>
            <p className="kicker">Customer account</p>
            <h2 className="account-name">{name}</h2>
            <p className="mono muted small">{view?.owner ?? account.owner} · {shortId(account.id)}</p>
          </div>
          <button className="btn" onClick={onSwitch}>Switch customer</button>
        </div>

        {busy && <div className="loading" aria-label="Loading account"><span /></div>}
        {!busy && error && !view && (
          <div className="inline-error">
            <p className="error" role="alert">{error}</p>
            <button className="btn small" onClick={() => void load()}>Try again</button>
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
  const declined = transfer.status === 'REJECTED';
  const sign = transfer.direction === 'sent' ? '−' : '+';
  return (
    <button className="trow" role="row" onClick={onToggle} aria-expanded={open}>
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
  const [trail, setTrail] = useState<PaymentTrail | null>(null);
  const [error, setError] = useState('');
  const replay = useAction<ReplayResult>();
  const tamper = useAction<TamperReport>();

  useEffect(() => {
    let live = true;
    setTrail(null);
    setError('');
    api.trail(accountId, transferId)
      .then((t) => { if (live) setTrail(t); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [accountId, transferId]);

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

  const pipelineScene = mapTrailToPipelineSteps(trail);

  return (
    <div className="detail">
      <div className="detail-head">
        <span className="mono muted small">Transfer {trail.transferId}</span>
        {!trail.audited && <Badge tone="neutral">Partial view · ledger update pending deploy</Badge>}
      </div>
      <PipelineStage
        scene={pipelineScene}
        actors={[{ cast: 'alex', x: 50 }, { cast: 'sam', x: 180 }]}
        proofCaption={`GET /api/trail · ${trail.from} → ${trail.to} · ${trail.amount}`}
      />
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
                <button className="btn" disabled={replay.busy} onClick={() => void replay.run(async () => {
                  const r = await api.replay(accountId, transferId);
                  onChanged();
                  return r;
                })}>
                  {replay.busy ? 'Sending…' : 'Send this exact request again'}
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
              <button className="btn" disabled={tamper.busy} onClick={() => void tamper.run(() => api.tamper(accountId, transferId))}>
                {tamper.busy ? 'Attempting…' : 'Attempt the writes'}
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
        <button className="btn primary" disabled={race.busy} onClick={() => void race.run(async () => {
          const result = await api.race(accountId, fromAccountId);
          onDone(result.transferId);
          return result;
        })}>
          {race.busy ? 'Sending five copies…' : 'Send five identical requests'}
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

function Architecture() {
  return (
    <footer className="architecture" id="architecture">
      <div className="section-head">
        <h3>Architecture</h3>
        <a className="link small" href={REPO} target="_blank" rel="noreferrer">Design notes on GitHub →</a>
      </div>
      <dl className="stack">
        <div><dt>Ledger service</dt><dd>Java 21 and Spring Boot with plain SQL over JDBC, compiled to a GraalVM native image and deployed as a container on Render.</dd></div>
        <div><dt>Database</dt><dd>PostgreSQL. Append-only entries, a deferred balance trigger, a non-negative balance constraint, and the idempotency key as a unique column.</dd></div>
        <div><dt>Events</dt><dd>Transactional outbox relayed to AWS SQS FIFO (Kafka locally). At-least-once with per-transfer ordering. Queue, DLQ and IAM in Terraform.</dd></div>
        <div><dt>Web and assistant</dt><dd>React and TypeScript with a Hono API on Vercel. The assistant uses read-only tools scoped to the open account, with evals checking every amount.</dd></div>
      </dl>

      <div className="section-head">
        <h3>Measured under load</h3>
        <span className="muted small">k6 · open-model arrival · 10% replayed keys · 1 CPU / 512 MB container</span>
      </div>
      <table className="grid perf">
        <thead><tr><th>Build and rate</th><th className="num">p50</th><th className="num">p99</th><th className="num">Errors</th><th className="num">Memory</th></tr></thead>
        <tbody>
          <tr><td>Native · 500 req/s</td><td className="num">4.5 ms</td><td className="num">30 ms</td><td className="num">0%</td><td className="num">54 MB</td></tr>
          <tr><td>Native · 800 req/s</td><td className="num">6.3 ms</td><td className="num">109 ms</td><td className="num">0%</td><td className="num">80 MB</td></tr>
          <tr><td>Native · 1,000 req/s</td><td className="num">224 ms</td><td className="num">518 ms</td><td className="num">10.9% shed as 503</td><td className="num">181 MB</td></tr>
        </tbody>
      </table>
      <p className="muted small footnote">
        The first JVM build was killed for running out of memory at 500 req/s because virtual threads queued every request on the heap.
        The service now caps in-flight requests and answers overflow with a fast 503 and Retry-After, which is safe because every write is idempotent.
        Totals summed to exactly zero after every run.
      </p>
    </footer>
  );
}

function Chat({ account, name }: { account: AccountRef; name: string }) {
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
      const reply = await api.chat(account.id, next.slice(-10));
      setTurns([...next, { role: 'assistant', text: reply.answer, toolCalls: reply.toolCalls, model: reply.model }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <aside className="chat" aria-label={`Assistant for ${name}`}>
      <div className="chat-head">
        <h2>Support assistant</h2>
        <p className="muted small">
          Answers from {name}&apos;s records through read-only lookups scoped to this account. It cannot move money,
          read other customers, or take instructions from a memo.
        </p>
      </div>
      <div className="log">
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>)}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            <p className="line">{t.text}</p>
            {t.toolCalls && t.toolCalls.length > 0 && (
              <details className="trace">
                <summary>Checked the ledger · {t.toolCalls.length} lookup{t.toolCalls.length > 1 ? 's' : ''}</summary>
                {t.toolCalls.map((c, j) => (
                  <div key={j} className="call">
                    <code>{c.tool}</code> <span className="muted">{c.ms} ms</span>
                    <pre>{JSON.stringify(c.result, null, 2)}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <p className="muted small thinking">Looking through the ledger…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${name}'s account`} aria-label="Message" maxLength={2000} />
        <button className="btn primary small" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
