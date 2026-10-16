import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { OFFLINE_BOOTSTRAP } from './practice-fixture.js';
import { loadSavedWallets, rememberWallet } from './wallet-store.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';

function personName(owner: string): string {
  if (owner.startsWith('Bank funding')) return 'Bank';
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function TermLink({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="term-link" onClick={onClick} disabled={disabled}>
      [{children}]
    </button>
  );
}

export function TerminalApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatLock = useRef(false);
  const lineId = useId();

  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedTransferId, setStoppedTransferId] = useState<string | null>(null);
  const [view, setView] = useState<AccountView | null>(null);
  const [household, setHousehold] = useState<AccountRef[]>([]);
  const [busy, setBusy] = useState('');
  const [input, setInput] = useState('');
  const [chatTurns, setChatTurns] = useState<Turn[]>([]);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [trailCache, setTrailCache] = useState<Record<string, PaymentTrail>>({});
  const [replayCache, setReplayCache] = useState<Record<string, ReplayResult>>({});
  const [tamperCache, setTamperCache] = useState<Record<string, TamperReport>>({});
  const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const append = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLog((prev) => [...prev.slice(-120), `${ts}  ${line}`]);
  }, []);

  const scrollEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
  }, []);

  useEffect(() => { scrollEnd(); }, [log, chatTurns, expanded, integrity, view, raceResult, scrollEnd]);

  useEffect(() => {
    append('GET /api/bootstrap');
    void api.bootstrap().then((b) => {
      setBoot(b);
      append(`bootstrap · live=${b.live} · audit=${b.ledger?.auditCapabilities ? 'postgres' : 'mirror-or-offline'}`);
    }).catch(() => setBoot(OFFLINE_BOOTSTRAP));
  }, [append]);

  const chatMeta = boot.chat ?? { provider: 'gemini', configured: false };

  async function loadAccount(id: string, quiet = false) {
    if (!quiet) setBusy('account');
    append(`GET /api/accounts?id=${id.slice(0, 8)}…`);
    try {
      const v = await api.account(id);
      setView(v);
      append(`account · balance=${v.balance} · payments=${v.transfers.length}`);
    } catch (e) {
      setView(null);
      append(`error · ${(e as Error).message}`);
    } finally {
      if (!quiet) setBusy('');
    }
  }

  useEffect(() => {
    if (account) void loadAccount(account.id);
    else setView(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- account id only
  }, [account?.id]);

  function signIn(a: AccountRef, stoppedId?: string) {
    setAccount(a);
    setStoppedTransferId(stoppedId ?? null);
    setChatTurns([]);
    setExpanded({});
    rememberWallet({ id: a.id, owner: a.owner, live: true, savedAt: new Date().toISOString() });
    append(`session · ${personName(a.owner)} · ${shortId(a.id)}`);
  }

  function signOut() {
    setAccount(null);
    setStoppedTransferId(null);
    setView(null);
    setChatTurns([]);
    setIntegrity(null);
    setRaceResult(null);
    append('session · signed out');
  }

  async function runIntegrity() {
    setBusy('integrity');
    append('GET /api/integrity');
    try {
      const result = await api.integrity();
      setIntegrity(result);
      setExpanded((e) => ({ ...e, integrity: true }));
      append(
        `integrity · source=${result.source ?? '?'} · balanced=${result.balanced} · entries=${result.entryCount} · sum=${result.entriesSum}`,
      );
    } catch (e) {
      append(`integrity failed · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function seedHousehold() {
    setBusy('seed');
    append('POST /api/demo');
    try {
      const seeded = await api.seedDemo();
      setHousehold(seeded.accounts);
      const focus = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
      if (focus) signIn(focus, seeded.stopped.transferId);
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function createWallet(ownerRaw: string) {
    const ownerId = ownerRaw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!ownerId) return;
    if (!boot.live) {
      append('error · live ledger not reachable');
      return;
    }
    setBusy('create');
    append(`POST /api/accounts · ownerId=${ownerId}`);
    try {
      signIn(await api.openAccount(ownerId));
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function openPayment(transferId: string) {
    if (!account) return;
    const key = `pay:${transferId}`;
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
    if (trailCache[transferId]) return;
    setBusy('trail');
    append(`GET /api/trail · ${transferId.slice(0, 8)}…`);
    try {
      const trail = await api.trail(account.id, transferId);
      setTrailCache((c) => ({ ...c, [transferId]: trail }));
      append(`trail · ${trail.status} · legs=${trail.legs.length}`);
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runReplay(transferId: string) {
    if (!account) return;
    setBusy('replay');
    append('POST /api/replay');
    try {
      const r = await api.replay(account.id, transferId);
      setReplayCache((c) => ({ ...c, [transferId]: r }));
      append(`replay · ${r.httpStatus} · replayed=${r.replayed}`);
      void loadAccount(account.id, true);
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runTamper(transferId: string) {
    if (!account) return;
    setBusy('tamper');
    append('POST /api/tamper');
    try {
      const report = await api.tamper(account.id, transferId);
      setTamperCache((c) => ({ ...c, [transferId]: report }));
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runRace() {
    if (!account || !view) return;
    const people = view.transfers.filter((t) => t.kind === 'TRANSFER');
    const payer = people.find((t) => t.direction === 'received' && t.status === 'COMPLETED')
      ?? people.find((t) => t.status === 'COMPLETED')
      ?? people[0];
    if (!payer) {
      append('error · no counterparty for race demo');
      return;
    }
    setBusy('race');
    append('POST /api/race · 5 parallel transfers · one idempotency key');
    try {
      const r = await api.race(account.id, payer.counterpartyAccountId);
      setRaceResult(r);
      setExpanded((e) => ({ ...e, race: true }));
      append(`race · distinct=${r.distinctTransfers}`);
      void loadAccount(account.id, true);
      if (r.transferId) setExpanded((e) => ({ ...e, [`pay:${r.transferId}`]: true }));
    } catch (e) {
      append(`error · ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function sendChat(text: string) {
    if (!account || chatLock.current) return;
    const q = text.trim();
    if (!q) return;
    chatLock.current = true;
    const next = [...chatTurns, { role: 'user' as const, text: q }];
    setChatTurns(next);
    setInput('');
    setBusy('chat');
    append(`POST /api/chat · ${q.slice(0, 48)}${q.length > 48 ? '…' : ''}`);
    try {
      const reply = await api.chat(account.id, next.slice(-12));
      const routeLabel = reply.route === 'ledger-fallback' || reply.provider === 'ledger'
        ? 'ledger tools (no Gemini)'
        : `${reply.provider} · ${reply.model}`;
      append(`chat · route=${reply.route ?? reply.provider} · ${routeLabel}`);
      if (reply.fallbackReason) append(`chat · fallback · ${reply.fallbackReason}`);
      for (const c of reply.toolCalls ?? []) append(`tool · ${c.tool} · ${c.ms}ms`);
      setChatTurns([
        ...next,
        {
          role: 'assistant',
          text: reply.answer,
          toolCalls: reply.toolCalls,
          model: reply.model,
          provider: reply.provider,
        },
      ]);
    } catch (e) {
      append(`chat error · ${(e as Error).message}`);
    } finally {
      chatLock.current = false;
      setBusy('');
    }
  }

  function handleCommand(raw: string) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (lower === ':help' || lower === 'help') {
      append(
        'commands: :seed :integrity :payments :race :refresh :signout · or type a question (needs signed-in wallet)',
      );
      return;
    }
    if (lower === ':seed') {
      void seedHousehold();
      return;
    }
    if (lower === ':integrity') {
      void runIntegrity();
      return;
    }
    if (lower === ':payments') {
      setExpanded((e) => ({ ...e, payments: true }));
      return;
    }
    if (lower === ':race') {
      void runRace();
      return;
    }
    if (lower === ':refresh' && account) {
      void loadAccount(account.id);
      return;
    }
    if (lower === ':signout') {
      signOut();
      return;
    }
    if (lower.startsWith(':wallet ')) {
      void createWallet(line.slice(8));
      return;
    }
    if (account) void sendChat(line);
    else append('error · sign in first (:seed or open a saved wallet)');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    handleCommand(input);
  }

  const saved = loadSavedWallets().filter((w) => w.live);
  const transfers = view
    ? orderStoppedFirst(view.transfers, stoppedTransferId)
    : [];

  return (
    <div className="term-root">
      <header className="term-hd">
        <span>p2p-ledger</span>
        <span className="dim"> · treasury terminal</span>
        <a className="term-link quiet" href={REPO} target="_blank" rel="noreferrer">github</a>
      </header>

      <div className="term-scroll" ref={scrollRef} role="log" aria-live="polite">
        <p className="term-line">
          One stream. Click a <span className="dim">[link]</span> to load detail inline — nothing runs until you ask.
        </p>
        <p className="term-line dim">
          Reconciliation checks whether every ledger entry nets to $0 across the company. It is not a live ticker;
          run <TermLink onClick={() => void runIntegrity()} disabled={busy !== ''}>integrity</TermLink> after transfers to refresh.
        </p>
        <p className="term-line">
          Assistant routing:{' '}
          {chatMeta.configured
            ? <><strong>{chatMeta.provider}</strong>{chatMeta.model ? ` (${chatMeta.model})` : ''} — questions go to the model with ledger tools.</>
            : <><strong>ledger tools only</strong>. {chatMeta.configHint ?? 'Set GEMINI_API_KEY on the server to use Gemini.'}</>}
        </p>
        <p className="term-line dim">ledger {boot.live ? 'live · PostgreSQL' : 'offline'} · audit API {boot.ledger?.auditCapabilities ? 'on' : 'mirror or not deployed'}</p>

        {!account && (
          <section className="term-block">
            <p className="term-line">Start:</p>
            <p className="term-line">
              <TermLink onClick={() => void seedHousehold()} disabled={busy !== '' || !boot.live}>seed demo household</TermLink>
              {' '}
              <TermLink onClick={() => inputRef.current?.focus()} disabled={!boot.live}>new wallet</TermLink>
              <span className="dim"> → type </span>
              <code>:wallet alex.finance</code>
            </p>
            {saved.length > 0 && (
              <p className="term-line">
                Saved:{' '}
                {saved.map((w) => (
                  <TermLink key={w.id} onClick={() => signIn({ id: w.id, owner: w.owner })} disabled={busy !== ''}>
                    {personName(w.owner)}
                  </TermLink>
                ))}
              </p>
            )}
            {household.length > 0 && (
              <p className="term-line">
                Open role:{' '}
                {household.map((a) => (
                  <TermLink key={a.id} onClick={() => signIn(a)} disabled={busy !== ''}>
                    {personName(a.owner)}
                  </TermLink>
                ))}
              </p>
            )}
          </section>
        )}

        {account && view && (
          <section className="term-block">
            <p className="term-line">
              <strong>{personName(view.owner)}</strong>
              <span className="dim"> · {view.owner} · {shortId(account.id)} · balance {view.balance}</span>
              {' '}
              <TermLink onClick={signOut}>sign out</TermLink>
              {' '}
              <TermLink onClick={() => void loadAccount(account.id)} disabled={busy !== ''}>refresh</TermLink>
            </p>
            <p className="term-line">
              <TermLink onClick={() => void runIntegrity()} disabled={busy !== ''}>integrity</TermLink>
              {' '}
              <TermLink onClick={() => setExpanded((e) => ({ ...e, payments: !e.payments }))}>payments ({transfers.length})</TermLink>
              {' '}
              <TermLink onClick={() => void runRace()} disabled={busy !== ''}>retry storm</TermLink>
            </p>
          </section>
        )}

        {integrity && expanded.integrity && (
          <IntegrityBlock books={integrity} onClose={() => setExpanded((e) => ({ ...e, integrity: false }))} />
        )}

        {account && expanded.payments && view && (
          <section className="term-expand">
            <p className="term-line dim">payments · click id for trail / replay / tamper</p>
            {transfers.length === 0 && <p className="term-line dim">none yet</p>}
            {transfers.map((t) => (
              <PaymentLine
                key={t.transferId}
                transfer={t}
                highlight={t.transferId === stoppedTransferId}
                open={!!expanded[`pay:${t.transferId}`]}
                trail={trailCache[t.transferId]}
                replay={replayCache[t.transferId]}
                tamper={tamperCache[t.transferId]}
                onToggle={() => void openPayment(t.transferId)}
                onReplay={() => void runReplay(t.transferId)}
                onTamper={() => void runTamper(t.transferId)}
                busy={busy !== ''}
              />
            ))}
          </section>
        )}

        {raceResult && expanded.race && (
          <section className="term-expand">
            <p className="term-line">
              retry storm · {raceResult.copies} requests → {raceResult.distinctTransfers} payment(s)
              {raceResult.entriesPosted !== null ? ` · ${raceResult.entriesPosted} entries` : ''}
            </p>
            <pre className="term-pre">{raceResult.attempts.map((a, i) =>
              `#${i + 1}  HTTP ${a.httpStatus}  ${a.replayed ? 'stored replay' : a.status}  ${a.ms}ms`,
            ).join('\n')}</pre>
          </section>
        )}

        {chatTurns.map((t, i) => (
          <div key={`${lineId}-${i}`} className="term-chat-turn">
            <p className={t.role === 'user' ? 'term-line term-user' : 'term-line term-bot'}>
              {t.role === 'user' ? '› ' : '← '}{t.text}
            </p>
            {t.role === 'assistant' && t.provider && (
              <p className="term-line dim">
                via {t.provider === 'ledger' ? 'ledger tools' : `${t.provider}${t.model ? ` · ${t.model}` : ''}`}
              </p>
            )}
            {t.toolCalls?.map((c, j) => (
              <details key={j} className="term-details">
                <summary>{c.tool} · {c.ms}ms</summary>
                <pre className="term-pre">{JSON.stringify(c.result, null, 2)}</pre>
              </details>
            ))}
          </div>
        ))}

        {log.length > 0 && (
          <details className="term-details trace-details">
            <summary>trace ({log.length})</summary>
            <pre className="term-pre dim">{log.join('\n')}</pre>
          </details>
        )}
      </div>

      <form className="term-prompt" onSubmit={onSubmit}>
        <label htmlFor="term-in" className="dim">›</label>
        <input
          id="term-in"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={account ? 'question or :help' : ':seed or :wallet name'}
          maxLength={2000}
          disabled={busy === 'chat'}
          autoComplete="off"
        />
        <button type="submit" className="term-link quiet" disabled={!input.trim() || busy === 'chat'}>send</button>
      </form>
      {busy && <p className="term-busy dim" aria-live="polite">{busy}…</p>}
    </div>
  );
}

function IntegrityBlock({ books, onClose }: { books: Integrity; onClose: () => void }) {
  const source = books.source === 'live'
    ? 'live PostgreSQL audit (GET /v1/ledger/integrity)'
    : 'practice mirror — static snapshot when live audit is unavailable; numbers change only after real ledger activity + refresh';
  const delivery = books.outbox.p95DeliveryMs;
  return (
    <section className="term-expand">
      <p className="term-line">
        integrity · {books.balanced ? 'balanced' : 'OUT OF BALANCE'} · checked {clock(books.checkedAt)}
        {' '}
        <TermLink onClick={onClose}>hide</TermLink>
      </p>
      <p className="term-line dim">{source}</p>
      <pre className="term-pre">
        {[
          `entries sum     ${books.entriesSum}`,
          `entry count     ${books.entryCount}`,
          `account drift   ${books.accountsDrifted}`,
          `declines w/ $   ${books.rejectedWithEntries}`,
          `outbox p95      ${delivery === null ? '—' : `${Math.round(delivery)} ms`}`,
        ].join('\n')}
      </pre>
    </section>
  );
}

function PaymentLine({
  transfer,
  highlight,
  open,
  trail,
  replay,
  tamper,
  onToggle,
  onReplay,
  onTamper,
  busy,
}: {
  transfer: AccountActivity;
  highlight: boolean;
  open: boolean;
  trail?: PaymentTrail;
  replay?: ReplayResult;
  tamper?: TamperReport;
  onToggle: () => void;
  onReplay: () => void;
  onTamper: () => void;
  busy: boolean;
}) {
  const declined = transfer.status === 'REJECTED';
  return (
    <div className={highlight ? 'term-pay highlight' : 'term-pay'}>
      <p className="term-line">
        <TermLink onClick={onToggle} disabled={busy}>
          {shortId(transfer.transferId)}
        </TermLink>
        {' '}
        {transfer.memo || 'Payment'}
        <span className="dim"> · {declined ? 'declined' : transfer.direction} · {transfer.amount}</span>
      </p>
      {open && (
        <div className="term-expand nested">
          {!trail && <p className="term-line dim">loading trail…</p>}
          {trail && (
            <>
              <p className="term-line dim">{trail.from} → {trail.to} · {trail.status} · legs net {trail.legsSum}</p>
              <pre className="term-pre">
                {trail.legs.map((l) =>
                  `#${l.entryId}  ${l.account}  ${l.side} ${l.amount}  bal ${l.balanceAfter}`,
                ).join('\n') || '(no entries — decline with no money moved)'}
              </pre>
              {trail.audited && (
                <p className="term-line">
                  <TermLink onClick={onReplay} disabled={busy}>replay idempotency</TermLink>
                  {trail.status === 'COMPLETED' && (
                    <>
                      {' '}
                      <TermLink onClick={onTamper} disabled={busy}>tamper checks</TermLink>
                    </>
                  )}
                </p>
              )}
              {replay && (
                <p className="term-line dim">
                  replay {replay.httpStatus} · Idempotent-Replayed={replay.replayed} · entries {replay.entriesBefore}→{replay.entriesAfter}
                </p>
              )}
              {tamper && (
                <pre className="term-pre">{tamper.attempts.map((a) =>
                  `${a.attempt}: ${a.refused ? 'refused' : 'ALLOWED'} — ${a.databaseSaid}`,
                ).join('\n')}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function orderStoppedFirst(transfers: AccountActivity[], stoppedTransferId: string | null): AccountActivity[] {
  if (!stoppedTransferId) return transfers;
  return [...transfers].sort((a, b) => Number(b.transferId === stoppedTransferId) - Number(a.transferId === stoppedTransferId));
}
