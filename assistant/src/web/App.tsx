import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AccountRef, type Turn } from './api.js';

const SUGGESTIONS = [
  "What's my balance?",
  'Why was my rent payment declined?',
  'How much have I sent to each person this month?',
  'Send $50 to sam',
];

export function App() {
  const [account, setAccount] = useState<AccountRef | null>(null);
  return (
    <div className="shell">
      <header>
        <h1>Ledger Assistant</h1>
        <p className="sub">Ask questions about a payments account. The answers come from live ledger data through tool calls.</p>
      </header>
      {account
        ? <Chat account={account} onSwitch={() => setAccount(null)} />
        : <AccountPicker onPick={setAccount} />}
    </div>
  );
}

function AccountPicker({ onPick }: { onPick: (a: AccountRef) => void }) {
  const [demo, setDemo] = useState<AccountRef[]>([]);
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
      <h2>Pick an account</h2>
      <p>Create a demo world: three people with payments between them and a couple of declined transfers.</p>
      <button disabled={busy} onClick={() => run(api.seedDemo, (r) => setDemo(r.accounts))}>
        {busy && demo.length === 0 ? 'Creating…' : 'Create demo accounts'}
      </button>
      {demo.length > 0 && (
        <ul className="accounts">
          {demo.map((a) => (
            <li key={a.id}><button className="link" onClick={() => onPick(a)}>Chat as {a.owner}</button></li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); run(() => api.findAccounts(owner), setFound); }}>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="…or find by owner id" aria-label="Owner id" />
        <button disabled={busy || !owner.trim()}>Find</button>
      </form>
      {found && (found.length === 0
        ? <p className="muted">No accounts for that owner.</p>
        : <ul className="accounts">{found.map((a) => (
            <li key={a.id}><button className="link" onClick={() => onPick(a)}>{a.owner} · {a.id.slice(0, 8)}…</button></li>
          ))}</ul>)}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Chat({ account, onSwitch }: { account: AccountRef; onSwitch: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [turns, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: 'user', text: text.trim() }];
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
      setBusy(false);
    }
  }

  return (
    <section className="card chat">
      <div className="chat-head">
        <span>Signed in as <strong>{account.owner}</strong></span>
        <button className="link" onClick={onSwitch}>Switch account</button>
      </div>
      <div className="log">
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            <div className="bubble">{t.text}</div>
            {t.toolCalls && t.toolCalls.length > 0 && (
              <details className="trace">
                <summary>{t.toolCalls.length} tool call{t.toolCalls.length > 1 ? 's' : ''} · {t.model}</summary>
                {t.toolCalls.map((c, j) => (
                  <div key={j} className="call">
                    <code>{c.tool}({JSON.stringify(c.args)})</code> <span className="muted">{c.ms} ms</span>
                    <pre>{JSON.stringify(c.result, null, 2)}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble muted">Thinking…</div></div>}
        <div ref={end} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your account" aria-label="Message" maxLength={2000} />
        <button disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
