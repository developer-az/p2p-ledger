import { useEffect, useRef, useState } from 'react';
import { api, type BootstrapResponse, type ToolCall, type Turn } from '../api.js';
import { Icon } from './ui.js';

const TOOL_WORDS: Record<string, string> = {
  get_account_overview: 'your balance',
  list_transfers: 'your recent payments',
  get_transfer: 'one payment',
  summarize_activity: 'a summary of your activity',
  explain_decline_reason: 'the decline rules',
  list_peers: 'your friends',
  peer_ledger: 'payments with one friend',
  list_spends: 'what you logged',
  summarize_spending: 'your spending summary',
  weekly_spending_story: 'this week against last week',
};

const SUGGESTIONS = [
  'Why was my payment declined?',
  'How much did I spend this week?',
  'Who have I sent the most money to?',
];

interface Message extends Turn {
  checked?: string[];
  note?: string;
}

export function AskTab({ accountId, boot }: { accountId: string; boot: BootstrapResponse }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [accountId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Turn[] = [...messages.map(({ role, text: t }) => ({ role, text: t })), { role: 'user', text: q }];
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const r = await api.chat(accountId, history);
      const checked = [...new Set((r.toolCalls as ToolCall[]).map((c) => TOOL_WORDS[c.tool] ?? c.tool.replace(/_/g, ' ')))];
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: r.answer,
          checked,
          note: r.route === 'ledger-fallback' ? 'Answered straight from your records.' : undefined,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const modelOn = boot.chat?.configured ?? false;

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Ask</h1>
        <p className="page-sub">
          Ask about your payments, declines or spending. The assistant can read your wallet and nothing else, and it cannot move money.
        </p>
      </div>
      <section className="card stack" aria-label="Conversation">
        {!modelOn ? (
          <p className="notice notice-warn" style={{ fontSize: '0.92rem' }}>
            The language model is not connected on this server, so answers are built directly from your records. They are accurate but plainer.
          </p>
        ) : null}
        <div className="chat" aria-live="polite">
          {messages.length === 0 ? (
            <div className="stack-sm">
              <p className="muted">Try one of these:</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => void ask(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'grid' }}>
              <div className={`bubble ${m.role === 'user' ? 'bubble-user' : 'bubble-ai'}`}>{m.text}</div>
              {m.role === 'assistant' && m.checked && m.checked.length > 0 ? (
                <p className="faint" style={{ fontSize: '0.82rem', margin: '4px 6px 0' }}>
                  Looked at: {m.checked.join(', ')}.{m.note ? ` ${m.note}` : ''}
                </p>
              ) : null}
            </div>
          ))}
          {busy ? <div className="bubble bubble-ai faint">Looking through your records…</div> : null}
          <div ref={endRef} />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <form className="chat-form" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
          <label className="sr-only" htmlFor="ask-input">Your question</label>
          <input id="ask-input" className="input" placeholder="Ask about your money" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} aria-label="Send question"><Icon name="send" /></button>
        </form>
      </section>
    </div>
  );
}
