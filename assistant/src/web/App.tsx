import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AccountActivity, type AccountRef, type AccountView, type Turn } from './api.js';

const SUGGESTIONS = [
  "What's my balance?",
  'Why was my rent payment declined?',
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
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">L</span>
          <div>
            <h1>Ledger</h1>
            <p className="sub">Your payments, with answers from the ledger.</p>
          </div>
        </div>
      </header>
      <div hidden={account !== null}>
        <AccountPicker onPick={setAccount} />
      </div>
      {account && <AccountScreen account={account} onSwitch={() => setAccount(null)} />}
    </div>
  );
}

function AccountPicker({ onPick }: { onPick: (a: AccountRef) => void }) {
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

  return (
    <section className="card">
      <h2>Choose an account</h2>
      <p className="sub">Open someone already on the ledger, or load a sample set of people and payments.</p>
      <button className="secondary" disabled={busy} onClick={() => run(api.seedDemo, (r) => setSample(r.accounts))}>
        {busy && sample.length === 0 ? 'Loading…' : 'Load sample accounts'}
      </button>
      {sample.length > 0 && <AccountList accounts={sample} onPick={onPick} />}
      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); run(() => api.findAccounts(owner), setFound); }}>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner id" aria-label="Owner id" />
        <button disabled={busy || !owner.trim()}>Find</button>
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
            <span className="avatar" aria-hidden="true">{personName(a.owner).charAt(0)}</span>
            <span>
              <strong>{personName(a.owner)}</strong>
              <span className="muted">{a.owner}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountScreen({ account, onSwitch }: { account: AccountRef; onSwitch: () => void }) {
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
      <section className="card home" aria-busy={busy}>
        <div className="home-head">
          <div className="who">
            <span className="avatar" aria-hidden="true">{name.charAt(0)}</span>
            <div>
              <h2>{name}</h2>
              <p className="muted">{view?.owner ?? account.owner}</p>
            </div>
          </div>
          <button className="link" onClick={onSwitch}>Switch account</button>
        </div>
        {busy && <div className="skeleton" aria-label="Loading balance" />}
        {!busy && error && (
          <div className="home-error">
            <p className="error" role="alert">{error}</p>
            <button onClick={() => void load()}>Try again</button>
          </div>
        )}
        {!busy && view && (
          <>
            <p className="eyebrow">Available balance</p>
            <p className="balance">{view.balance}</p>
            <h3>Recent activity</h3>
            {view.transfers.length === 0
              ? <p className="muted">No payments yet.</p>
              : (
                <ul className="activity">
                  {view.transfers.map((t) => (
                    <li key={t.transferId} className={t.status === 'REJECTED' ? 'declined' : ''}>
                      <span className="avatar small" aria-hidden="true">{personName(t.counterparty).charAt(0)}</span>
                      <span className="activity-copy">
                        <strong>{directionLabel(t.direction)} · {personName(t.counterparty)}</strong>
                        <span className="muted">{t.memo || 'No memo'} · {when(t.createdAt)}</span>
                      </span>
                      <span className={`amount ${t.direction}`}>
                        {t.status === 'REJECTED' ? 'Declined' : t.amount}
                        {t.status === 'REJECTED' && <span className="muted">{t.amount}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </>
        )}
      </section>
      <Chat account={account} name={name} />
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
    <section className="card chat" aria-label={`Assistant for ${name}`}>
      <div className="chat-head">
        <h2>Assistant</h2>
        <p className="muted">Answers come from {name}&apos;s ledger. It can look, not send.</p>
      </div>
      <div className="log">
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>)}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            <div className="bubble">{t.text}</div>
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
        {busy && <div className="msg assistant"><div className="bubble muted">Looking through the ledger…</div></div>}
        {error && <p className="error in-log" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${name}'s account`} aria-label="Message" maxLength={2000} />
        <button disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
