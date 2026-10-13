import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AccountActivity, type AccountRef, type AccountView, type Turn } from './api.js';

const SUGGESTIONS = [
  'Why was my rent payment declined?',
  "What's my balance?",
  'How much have I sent to each person this month?',
  'Send $50 to sam',
];

function personName(owner: string): string {
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function directionLabel(direction: AccountActivity['direction']): string {
  if (direction === 'sent') return 'Sent';
  if (direction === 'received') return 'Received';
  return 'Deposit';
}

export function App() {
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedTransferId, setStoppedTransferId] = useState<string | null>(null);
  return (
    <div className="shell">
      <header className="top">
        <p className="mark-name">Ledger</p>
        <h1>The customer and your support team see the same reason a payment stopped.</h1>
        <p className="sub">A payments company runs this so a declined transfer is a record, not a guess. The assistant is only allowed to quote that record.</p>
      </header>
      <div hidden={account !== null}>
        <AccountPicker onPick={(a, stoppedId) => { setStoppedTransferId(stoppedId ?? null); setAccount(a); }} />
      </div>
      {account && (
        <AccountScreen
          account={account}
          stoppedTransferId={stoppedTransferId}
          onSwitch={() => { setAccount(null); setStoppedTransferId(null); }}
        />
      )}
    </div>
  );
}

function AccountPicker({ onPick }: { onPick: (a: AccountRef, stoppedTransferId?: string) => void }) {
  const [sample, setSample] = useState<AccountRef[]>([]);
  const [owner, setOwner] = useState('');
  const [found, setFound] = useState<AccountRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run<T>(fn: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setError('');
    try { then(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function watch() {
    setBusy(true);
    setError('');
    try {
      const seeded = await api.seedDemo();
      setSample(seeded.accounts);
      const sender = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
      if (sender) onPick(sender, seeded.stopped.transferId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="opening">
      <button className="text" disabled={busy} onClick={() => void watch()}>
        {busy && sample.length === 0 ? 'Opening a new account…' : 'Watch a payment get stopped'}
      </button>
      <p className="sub">A new account tries to send $1,200 on its first day. The ledger declines it and writes down the rule.</p>
      {sample.length > 0 && <AccountList accounts={sample} onPick={onPick} />}
      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); run(() => api.findAccounts(owner), setFound); }}>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner id" aria-label="Owner id" />
        <button className="text" disabled={busy || !owner.trim()}>Find</button>
      </form>
      {found && (found.length === 0
        ? <p className="muted">No accounts for that owner.</p>
        : <AccountList accounts={found} onPick={onPick} />)}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function AccountList({ accounts, onPick }: { accounts: AccountRef[]; onPick: (a: AccountRef) => void }) {
  return (
    <ul className="accounts">
      {accounts.map((a) => (
        <li key={a.id}>
          <button className="person" onClick={() => onPick(a)}>
            <strong>{personName(a.owner)}</strong>
            <span className="muted">{a.owner}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountScreen({ account, stoppedTransferId, onSwitch }: { account: AccountRef; stoppedTransferId: string | null; onSwitch: () => void }) {
  const [view, setView] = useState<AccountView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    setError('');
    try {
      setView(await api.account(account.id));
    } catch (e) {
      setView(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [account.id]);

  const name = personName(view?.owner ?? account.owner);

  return (
    <div className="workspace">
      <section className="home" aria-busy={busy}>
        <div className="home-head">
          <div>
            <h2>{name}</h2>
            <p className="muted">{view?.owner ?? account.owner}</p>
          </div>
          <button className="text" onClick={onSwitch}>Switch account</button>
        </div>
        {busy && <div className="skeleton" aria-label="Loading balance" />}
        {!busy && error && (
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
              <div>
                <dt>Sent, 30 days</dt>
                <dd>{view.summary.sent}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{view.summary.received}</dd>
              </div>
              <div>
                <dt>Stopped by checks</dt>
                <dd>{view.summary.stopped}</dd>
              </div>
            </dl>
            <p className="model">
              {view.summary.declinedCount > 0
                ? `This is the product. The books stopped ${view.summary.stopped}. The sentence on that payment is the rule that did it. Support does not get a different number or a different reason.`
                : 'The totals are summed in cents on the ledger. The assistant is only allowed to quote them.'}
            </p>
            <h3>Statement</h3>
            {view.transfers.length === 0
              ? <p className="muted">No payments yet.</p>
              : <Statement transfers={orderStoppedFirst(view.transfers, stoppedTransferId)} />}
          </>
        )}
      </section>
      <Chat account={account} name={name} />
    </div>
  );
}

function orderStoppedFirst(transfers: AccountActivity[], stoppedTransferId: string | null): AccountActivity[] {
  return [...transfers].sort((a, b) => rank(a, stoppedTransferId) - rank(b, stoppedTransferId));
}

function rank(transfer: AccountActivity, stoppedTransferId: string | null): number {
  if (stoppedTransferId && transfer.transferId === stoppedTransferId) return 0;
  if (transfer.status === 'REJECTED') return 1;
  return 2;
}

function Statement({ transfers }: { transfers: AccountActivity[] }) {
  const [stopped, ...rest] = transfers;
  return (
    <>
      {stopped && <ActivityRow transfer={stopped} />}
      {stopped?.status === 'REJECTED' && (
        <div className="proof">
          <p>The decline was stored with the transfer.</p>
          <p>The assistant quotes that record. It does not invent an amount.</p>
          <p>The assistant cannot send money.</p>
          <p className="muted">Measured on a 512 MB container: at 500 req/s the JVM ran out of memory, so the service now returns 503 instead of dying. That figure is a measurement, not a customer’s dashboard.</p>
        </div>
      )}
      {rest.map((t) => <ActivityRow key={t.transferId} transfer={t} />)}
    </>
  );
}

function ActivityRow({ transfer }: { transfer: AccountActivity }) {
  return (
    <div className={transfer.status === 'REJECTED' ? 'activity-row declined' : 'activity-row'}>
      <span className="activity-copy">
        <strong>{transfer.memo || directionLabel(transfer.direction)}</strong>
        <span className="muted">{directionLabel(transfer.direction)} {personName(transfer.counterparty)} · {when(transfer.createdAt)}</span>
        {transfer.declineExplanation && <span className="reason">{transfer.declineExplanation}</span>}
      </span>
      <span className={`amount ${transfer.direction}`}>
        {transfer.status === 'REJECTED' ? 'Declined' : transfer.amount}
        {transfer.status === 'REJECTED' && <span className="muted">{transfer.amount}</span>}
      </span>
    </div>
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
    end.current?.scrollIntoView({ behavior: 'smooth' });
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
        <h2>Ask why</h2>
        <p className="muted">Questions are answered from {name}&apos;s books. It cannot send money, and it cannot invent a number that is not already in the statement.</p>
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
