import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type AccountActivity,
  type AccountRef,
  type AccountView,
  type Integrity,
  type PaymentTrail,
  type RaceResult,
  type ReplayResult,
  type TamperReport,
  type Turn,
} from './api.js';

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

function directionLabel(direction: AccountActivity['direction']): string {
  if (direction === 'sent') return 'Sent to';
  if (direction === 'received') return 'From';
  return 'Deposit';
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

export function App() {
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedTransferId, setStoppedTransferId] = useState<string | null>(null);
  const [booksVersion, setBooksVersion] = useState(0);
  return (
    <div className="shell">
      <header className="top">
        <nav className="masthead">
          <p className="mark-name">Ledger</p>
          <a className="quiet" href={REPO} target="_blank" rel="noreferrer">Source</a>
        </nav>
        <h1>A payments ledger that can prove every number it shows.</h1>
        <p className="sub">
          Double-entry books in PostgreSQL behind a Java service. A retried payment cannot charge twice,
          the database itself refuses edits to posted money, and every payment emits an event for the
          systems downstream. Everything on this page runs against the live service.
        </p>
        <Books version={booksVersion} />
      </header>
      <div hidden={account !== null}>
        <AccountPicker onPick={(a, stoppedId) => { setStoppedTransferId(stoppedId ?? null); setAccount(a); }} />
      </div>
      {account && (
        <AccountScreen
          account={account}
          stoppedTransferId={stoppedTransferId}
          onChanged={() => setBooksVersion((v) => v + 1)}
          onSwitch={() => { setAccount(null); setStoppedTransferId(null); }}
        />
      )}
      <Stack />
    </div>
  );
}

function Books({ version }: { version: number }) {
  const [books, setBooks] = useState<Integrity | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setBooks(await api.integrity());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void check(); }, [version]);

  if (failed && !books) {
    return (
      <p className="books muted">
        Reconciliation is unavailable while the ledger wakes up.{' '}
        <button className="text" onClick={() => void check()} disabled={busy}>Check again</button>
      </p>
    );
  }
  if (!books) return <p className="books muted">Reconciling the books…</p>;
  const delivery = books.outbox.p95DeliveryMs;
  return (
    <div className="books" aria-busy={busy}>
      <p className={books.balanced ? 'books-verdict ok' : 'books-verdict bad'}>
        {books.balanced ? 'Books balanced' : 'Books out of balance'}
        <span className="muted"> · recomputed from raw entries at {clock(books.checkedAt)}</span>
      </p>
      <dl className="books-figures">
        <div><dt>All {books.entryCount.toLocaleString()} entries sum to</dt><dd>{books.entriesSum}</dd></div>
        <div><dt>Accounts whose balance drifts from its entries</dt><dd>{books.accountsDrifted} of {books.accountCount.toLocaleString()}</dd></div>
        <div><dt>Declined payments that moved money</dt><dd>{books.rejectedWithEntries}</dd></div>
        <div>
          <dt>Events delivered{delivery === null ? '' : ', p95 latency'}</dt>
          <dd>
            {(books.outbox.total - books.outbox.pending).toLocaleString()}
            {delivery !== null && <span className="muted"> · {Math.round(delivery)} ms</span>}
            {books.outbox.pending > 0 && <span className="muted"> · {books.outbox.pending} waiting</span>}
          </dd>
        </div>
      </dl>
      <button className="text small" onClick={() => void check()} disabled={busy}>{busy ? 'Reconciling…' : 'Run reconciliation again'}</button>
    </div>
  );
}

function AccountPicker({ onPick }: { onPick: (a: AccountRef, stoppedTransferId?: string) => void }) {
  const [owner, setOwner] = useState('');
  const [found, setFound] = useState<AccountRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function watch() {
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
    <section className="opening">
      <p className="eyebrow">Start here</p>
      <button className="text big" disabled={busy} onClick={() => void watch()}>
        {busy ? 'Opening three accounts on the live ledger…' : 'Open a customer and watch a payment get stopped →'}
      </button>
      <p className="sub">
        Creates three real accounts, funds them, and sends a few payments. One of them is $1,200 from an
        account opened seconds ago, which the fraud rules decline inside the same database transaction.
      </p>
      <form className="row" onSubmit={(e) => void find(e)}>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Or look up an owner id" aria-label="Owner id" />
        <button className="text" disabled={busy || !owner.trim()}>Find</button>
      </form>
      {found && (found.length === 0
        ? <p className="muted">No accounts for that owner.</p>
        : (
          <ul className="accounts">
            {found.map((a) => (
              <li key={a.id}>
                <button className="person" onClick={() => onPick(a)}>
                  <strong>{personName(a.owner)}</strong>
                  <span className="muted">{a.owner}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
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
    <div className="workspace">
      <section className="home" aria-busy={busy}>
        <div className="home-head">
          <div>
            <p className="eyebrow">Customer</p>
            <h2>{name}</h2>
            <p className="muted mono">{view?.owner ?? account.owner}</p>
          </div>
          <button className="text" onClick={onSwitch}>Switch customer</button>
        </div>
        {busy && <div className="skeleton" aria-label="Loading balance" />}
        {!busy && error && !view && (
          <div className="home-error">
            <p className="error" role="alert">{error}</p>
            <button className="text" onClick={() => void load()}>Try again</button>
          </div>
        )}
        {!busy && view && (
          <>
            <p className="eyebrow">Available balance</p>
            <p className="balance">{view.balance}</p>
            <dl className="figures">
              <div><dt>Sent, 30 days</dt><dd>{view.summary.sent}</dd></div>
              <div><dt>Received</dt><dd>{view.summary.received}</dd></div>
              <div><dt>Stopped by checks</dt><dd>{view.summary.stopped}</dd></div>
            </dl>

            <h3>Payments</h3>
            <p className="muted hint">Open any payment to see what the database holds for it.</p>
            {transfers.length === 0
              ? <p className="muted">No payments yet.</p>
              : transfers.map((t) => (
                <div key={t.transferId} className="payment">
                  <ActivityRow transfer={t} open={open === t.transferId} onToggle={() => setOpen(open === t.transferId ? null : t.transferId)} />
                  {open === t.transferId && (
                    <PaymentDetail
                      accountId={account.id}
                      transferId={t.transferId}
                      onChanged={() => { void load(true); onChanged(); }}
                    />
                  )}
                </div>
              ))}

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
      </section>
      <Chat account={account} name={name} />
    </div>
  );
}

function orderStoppedFirst(transfers: AccountActivity[], stoppedTransferId: string | null): AccountActivity[] {
  if (!stoppedTransferId) return transfers;
  return [...transfers].sort((a, b) => Number(b.transferId === stoppedTransferId) - Number(a.transferId === stoppedTransferId));
}

function ActivityRow({ transfer, open, onToggle }: { transfer: AccountActivity; open: boolean; onToggle: () => void }) {
  const declined = transfer.status === 'REJECTED';
  return (
    <button className={declined ? 'activity-row declined' : 'activity-row'} onClick={onToggle} aria-expanded={open}>
      <span className="activity-copy">
        <strong>{transfer.memo || (transfer.direction === 'deposit' ? 'Bank deposit' : 'Payment')}</strong>
        <span className="muted">
          {transfer.direction === 'deposit' ? 'Deposit' : `${directionLabel(transfer.direction)} ${personName(transfer.counterparty)}`} · {when(transfer.createdAt)}
        </span>
        {declined && transfer.declineExplanation && <span className="reason">{transfer.declineExplanation}</span>}
      </span>
      <span className={`amount ${transfer.direction}`}>
        {declined ? 'Declined' : `${transfer.direction === 'sent' ? '−' : '+'}${transfer.amount}`}
        {declined && <span className="muted">{transfer.amount}</span>}
        <span className="chevron muted" aria-hidden>{open ? 'Close' : 'Open'}</span>
      </span>
    </button>
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

  if (error) return <p className="error detail">{error}</p>;
  if (!trail) return <p className="muted detail">Reading this payment from Postgres…</p>;

  const declined = trail.status === 'REJECTED';
  const event = trail.events[0];
  const curl = [
    `${trail.request.method} ${trail.request.path}`,
    `Idempotency-Key: ${trail.request.idempotencyKey}`,
    '',
    JSON.stringify(trail.request.body, null, 2),
  ].join('\n');

  return (
    <div className="detail">
      <section>
        <p className="step">1 · Decision</p>
        {declined ? (
          <p>
            Declined by <code>{trail.decline?.code}</code>. {trail.decline?.explanation}
            <span className="muted"> The rule ran while both account rows were locked, so a burst of parallel requests cannot slip past it together.</span>
          </p>
        ) : (
          <p>
            Completed. {trail.amount} moved from {personName(trail.from)} to {personName(trail.to)}.
            <span className="muted"> Both account rows were locked in id order first, so two people paying each other at the same moment cannot deadlock.</span>
          </p>
        )}
      </section>

      <section>
        <p className="step">2 · Double-entry</p>
        {trail.legs.length === 0 ? (
          <p>
            No entries. A declined payment moves no money, so nothing was posted to either account.
            <span className="muted"> The reconciliation above counts any declined payment with entries; it stays at zero.</span>
          </p>
        ) : (
          <>
            <table className="legs">
              <thead><tr><th>Entry</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance after</th></tr></thead>
              <tbody>
                {trail.legs.map((l) => (
                  <tr key={l.entryId}>
                    <td className="mono muted">#{l.entryId}</td>
                    <td>{personName(l.account)}</td>
                    <td className="num">{l.side === 'debit' ? l.amount : ''}</td>
                    <td className="num">{l.side === 'credit' ? l.amount : ''}</td>
                    <td className="num muted">{l.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td /><td>Sum of legs</td><td colSpan={3} className="num">{trail.legsSum}</td></tr></tfoot>
            </table>
            <p className="muted small">A deferred Postgres trigger refuses to commit any payment whose legs do not sum to zero.</p>
          </>
        )}
      </section>

      <section>
        <p className="step">3 · Event</p>
        {event ? (
          <p>
            <code>{event.type}</code> was written to the outbox in the same transaction as the money,
            {event.publishedAt
              ? <> and the relay delivered it to the queue {event.deliveryMs} ms later.</>
              : <> and is waiting for the relay.</>}
            <span className="muted"> If the commit had failed, no event would exist; if the broker had been down, it would be retried, never lost.</span>
          </p>
        ) : <p className="muted">No event recorded.</p>}
      </section>

      <section>
        <p className="step">4 · The request</p>
        <pre className="request">{curl}</pre>
        <p className="muted small mono">SHA-256 of the body: {trail.request.requestHash.slice(0, 16)}… · same key with a different body returns 422</p>
        <button className="text" disabled={replay.busy} onClick={() => void replay.run(async () => {
          const r = await api.replay(accountId, transferId);
          onChanged();
          return r;
        })}>
          {replay.busy ? 'Sending…' : 'Send this exact request again'}
        </button>
        {replay.error && <p className="error">{replay.error}</p>}
        {replay.result && (
          <p className="outcome">
            <span className={replay.result.replayed && replay.result.sameTransfer ? 'ok' : 'bad'}>
              {replay.result.httpStatus} · Idempotent-Replayed: {String(replay.result.replayed)}
            </span>
            {' '}Same transfer returned{declined ? ', same decline, not re-evaluated' : ''}. Entries {replay.result.entriesBefore} → {replay.result.entriesAfter},
            balance {replay.result.balanceBefore} → {replay.result.balanceAfter}.
          </p>
        )}
      </section>

      {!declined && (
        <section>
          <p className="step">5 · Try to change the books</p>
          <p className="muted">Runs four forbidden writes against these entries in transactions that are always rolled back. What you see is Postgres refusing, not the Java code.</p>
          <button className="text" disabled={tamper.busy} onClick={() => void tamper.run(() => api.tamper(accountId, transferId))}>
            {tamper.busy ? 'Trying…' : 'Attempt the writes'}
          </button>
          {tamper.error && <p className="error">{tamper.error}</p>}
          {tamper.result && (
            <ul className="attempts">
              {tamper.result.attempts.map((a) => (
                <li key={a.attempt}>
                  <strong>{a.attempt}</strong>
                  <code className="sql">{a.sql}</code>
                  <span className={a.refused ? 'ok' : 'bad'}>{a.refused ? 'Refused: ' : 'Not refused: '}{a.databaseSaid}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
      <h3>Retry storm</h3>
      <p>
        {fromName}&apos;s phone loses signal mid-payment and the app fires the same $5.00 request five times at once.
        Each copy carries the same idempotency key. Postgres lets one through and makes the other four wait, then hand back the stored result.
      </p>
      <button className="text" disabled={race.busy} onClick={() => void race.run(async () => {
        const result = await api.race(accountId, fromAccountId);
        onDone(result.transferId);
        return result;
      })}>
        {race.busy ? 'Sending five copies…' : `Send ${fromName}'s payment five times at once`}
      </button>
      {race.error && <p className="error">{race.error}</p>}
      {r && (
        <>
          <ol className="copies">
            {r.attempts.map((a, i) => (
              <li key={i}>
                <span className="mono">{a.httpStatus}</span>
                <span>{a.replayed ? 'returned the stored payment' : a.status === 'REJECTED' ? 'processed: declined' : 'processed: money moved'}</span>
                <span className="muted mono">{a.ms} ms</span>
              </li>
            ))}
          </ol>
          <p className="outcome">
            <span className={r.distinctTransfers === 1 ? 'ok' : 'bad'}>
              {r.copies} requests, {r.distinctTransfers} payment{r.distinctTransfers === 1 ? '' : 's'}
            </span>
            {r.entriesPosted !== null && <>, {r.entriesPosted} ledger entries.</>}
            {r.declineExplanation && <> It was declined: {r.declineExplanation}</>}
          </p>
        </>
      )}
    </section>
  );
}

function Stack() {
  return (
    <footer className="stack">
      <h3>How it is built</h3>
      <dl className="stack-list">
        <div><dt>Ledger service</dt><dd>Java 21, Spring Boot, plain SQL over JDBC, compiled to a GraalVM native image. Deployed as a container on Render.</dd></div>
        <div><dt>Database</dt><dd>PostgreSQL. Append-only entries, a deferred balance trigger, non-negative balance constraint, idempotency key as a unique column.</dd></div>
        <div><dt>Events</dt><dd>Transactional outbox relayed to AWS SQS FIFO (Kafka locally) with at-least-once delivery and per-transfer ordering. Queue, DLQ and IAM in Terraform.</dd></div>
        <div><dt>This app</dt><dd>React and TypeScript, served with a Hono API on Vercel. The assistant calls read-only tools scoped to the open account, and evals check its amounts against the ledger.</dd></div>
      </dl>
      <h3>Measured under load</h3>
      <p className="muted small">k6, open-model arrival rate, 10% replayed keys, one container limited to 1 CPU and 512 MB. Totals summed to exactly zero after every run.</p>
      <table className="legs perf">
        <thead><tr><th>Run</th><th className="num">p50</th><th className="num">p99</th><th className="num">Errors</th><th className="num">Memory</th></tr></thead>
        <tbody>
          <tr><td>Native, 500 req/s</td><td className="num">4.5 ms</td><td className="num">30 ms</td><td className="num">0%</td><td className="num">54 MB</td></tr>
          <tr><td>Native, 800 req/s</td><td className="num">6.3 ms</td><td className="num">109 ms</td><td className="num">0%</td><td className="num">80 MB</td></tr>
          <tr><td>Native, 1,000 req/s</td><td className="num">224 ms</td><td className="num">518 ms</td><td className="num">10.9% shed as 503</td><td className="num">181 MB</td></tr>
        </tbody>
      </table>
      <p className="muted small">
        The first JVM build was killed for running out of memory at 500 req/s: virtual threads queued every request on the heap.
        The service now caps in-flight requests and answers the overflow with a fast 503 and Retry-After, which is safe to retry because every write is idempotent.
        Native startup is 3.6 s against 144 s for the JVM on a 0.1 CPU instance.
      </p>
      <p className="small"><a className="quiet" href={REPO} target="_blank" rel="noreferrer">Read the code and the design notes on GitHub</a></p>
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
    <section className="chat" aria-label={`Assistant for ${name}`}>
      <div className="chat-head">
        <p className="eyebrow">Support assistant</p>
        <h2>Ask why</h2>
        <p className="muted">Answers come from {name}&apos;s records through read-only lookups scoped to this account. It cannot send money or read anyone else&apos;s payments, and a memo cannot instruct it.</p>
      </div>
      <div className="log">
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} className="ask" onClick={() => void send(s)}>{s}</button>)}
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
        {busy && <p className="muted thinking">Looking through the ledger…</p>}
        {error && <p className="error in-log" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${name}'s account`} aria-label="Message" maxLength={2000} />
        <button className="text" disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
