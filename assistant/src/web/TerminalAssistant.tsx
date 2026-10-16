import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Turn } from './api.js';
import { useTrace } from './activity-log.js';

const PROMPTS = [
  'What is my balance?',
  'Why was my rent payment declined?',
  'How much did I send this month?',
];

export function TerminalAssistant({
  accountId,
  owner,
  llmReady,
  llmProvider,
}: {
  accountId: string;
  owner: string;
  llmReady: boolean;
  llmProvider: string;
}) {
  const trace = useTrace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lastRoute, setLastRoute] = useState<string | null>(null);
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
    trace(`POST /api/chat · question for ${owner}`);
    try {
      const reply = await api.chat(accountId, next.slice(-12));
      const route = reply.provider === 'ledger' ? 'internal ledger tools' : `${reply.provider} (${reply.model})`;
      setLastRoute(route);
      trace(`chat routed · ${route}`);
      for (const c of reply.toolCalls ?? []) trace(`tool · ${c.tool} · ${c.ms}ms`);
      setTurns([...next, {
        role: 'assistant',
        text: reply.answer,
        toolCalls: reply.toolCalls,
        model: reply.model,
        provider: reply.provider,
      }]);
    } catch (e) {
      setErr((e as Error).message);
      trace(`chat error · ${(e as Error).message}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <aside className="pane terminal-aside" aria-label="Support terminal">
      <div className="pane-hd">
        <strong>support@ledger</strong> · read-only · {owner}
        <span className="route-pill">
          {llmReady ? `${llmProvider} on` : `${llmProvider} off → ledger tools`}
        </span>
      </div>
      <div className="pane-bd terminal-aside-bd">
        {lastRoute && (
          <p className="dim route-line">last answer via <strong>{lastRoute}</strong></p>
        )}
        <div className="chat-log terminal-chat-log">
          {turns.length === 0 && (
            <p className="dim">&gt; ask about this wallet — balances, declines, activity. No separate tab.</p>
          )}
          {turns.map((t, i) => (
            <div key={i}>
              <div className={t.role === 'user' ? 'line-user' : 'line-bot'}>{t.text}</div>
              {t.role === 'assistant' && t.provider && (
                <p className="dim provider-tag">
                  via {t.provider === 'ledger' ? 'internal ledger API' : t.provider}
                  {t.model ? ` · ${t.model}` : ''}
                </p>
              )}
              {t.toolCalls?.map((c, j) => (
                <details key={j} className="tool-block">
                  <summary>{c.tool}</summary>
                  <pre>{JSON.stringify(c.result, null, 2)}</pre>
                </details>
              ))}
            </div>
          ))}
          {busy && <p className="dim wait">routing question…</p>}
          {err && <p className="err">{err}</p>}
          <div ref={end} />
        </div>
        <div className="prompt-grid">
          {turns.length === 0 && PROMPTS.map((p) => (
            <button key={p} type="button" className="t-btn-inline" onClick={() => void send(p)}>{`> ${p}`}</button>
          ))}
        </div>
        <form className="input-row" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }}>
          <label htmlFor="terminal-ask">›</label>
          <input
            id="terminal-ask"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="message…"
            maxLength={2000}
          />
          <button type="submit" className="t-btn-inline" disabled={busy || !input.trim()}>[ send ]</button>
        </form>
      </div>
    </aside>
  );
}
