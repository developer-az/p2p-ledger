import { useEffect, useRef, useState } from 'react';
import { api, type BootstrapResponse, type ToolCall, type Turn } from '../api.js';
import { useDebouncedCallback, useOnceGuard } from './debounce.js';
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
  'Where did most of my money go this month?',
  'Can I afford a $60 night out this week?',
];

interface Message extends Turn {
  checked?: string[];
  note?: string;
}

export function AskTab({
  accountId,
  boot,
  seed,
  onSeedUsed,
}: {
  accountId: string;
  boot: BootstrapResponse;
  seed?: string | null;
  onSeedUsed?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Anti-flooding, client half. A double-tapped send, a held Enter key or two
   * suggestion taps collapse into one request here — before the network — and
   * the once-guard swallows an identical repeat inside 600ms. The server still
   * has its own layers (sliding-window limiter, LlmGuard cache, daily budget).
   */
  const askDebounced = useDebouncedCallback((question: string) => void ask(question), 260);
  const once = useOnceGuard(600);

  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [accountId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  useEffect(() => {
    if (!seed) return;
    void ask(seed);
    onSeedUsed?.();
    // The seed is a one-shot prompt from another screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy || !once(q)) return;
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
          note:
            r.route === 'ledger-fallback'
              ? 'Answered straight from your records.'
              : r.cached
                ? 'Repeated question — served from the guard cache, no model call.'
                : undefined,
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
    <div className="ask-page">
      <header className="patterns-head">
        <div>
          <p className="eyebrow">Ask</p>
          <h1>A conversation with your records.</h1>
          <p className="page-sub">Read-only answers about your wallet, your habits and your declines. It cannot move money.</p>
        </div>
        <span className="pill pill-good"><Icon name="lock" size={14} /> Read-only</span>
      </header>

      <section className="card ask-panel" aria-label="Conversation">
        {!modelOn ? (
          <p className="notice notice-warn" style={{ fontSize: '0.92rem' }}>
            The language model is not connected on this server, so answers are built directly from your records. Accurate, just plainer.
          </p>
        ) : null}
        <div className="chat" aria-live="polite">
          {messages.length === 0 ? (
            <div className="ask-empty">
              <div className="ask-orb" aria-hidden="true">✦</div>
              <h2>What do you want to know?</h2>
              <p className="muted">Start with a question, or pick one of these.</p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => askDebounced(s)}>
                    <Icon name="sparkle" size={16} />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={`chat-turn chat-${m.role}`}>
              {m.role === 'assistant' ? <span className="chat-avatar" aria-hidden="true">✦</span> : null}
              <div>
                <div className={`bubble ${m.role === 'user' ? 'bubble-user' : 'bubble-ai'}`}>{m.text}</div>
                {m.role === 'assistant' && ((m.checked && m.checked.length > 0) || m.note) ? (
                  <p className="chat-grounding">
                    {m.checked && m.checked.length > 0 ? `Looked at: ${m.checked.join(', ')}.` : ''}{m.note ? ` ${m.note}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
          {busy ? (
            <div className="chat-status" role="status">
              <span className="marque marque-sm" aria-hidden="true">S</span>
              <span className="chat-status-bars" aria-hidden="true"><i /><i /><i /></span>
              <span>The archive is reading your records…</span>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <form className="chat-form" onSubmit={(e) => { e.preventDefault(); askDebounced(text); }}>
          <label className="sr-only" htmlFor="ask-input">Your question</label>
          <input id="ask-input" className="input" placeholder="Ask about your money" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} aria-label="Send question"><Icon name="send" /></button>
        </form>
        <p className="hint ask-hint">Answers come from read-only tools scoped to this wallet. Nothing leaves your records except the question.</p>
      </section>
    </div>
  );
}
