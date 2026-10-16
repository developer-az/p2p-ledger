import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  api,
  dollarsToMinor,
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
import { parseTerminalInput } from './terminal-command.js';
import { loadSavedWallets, rememberWallet } from './wallet-store.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';
const OPENING_DEPOSIT_MINOR = 500_00;

function personName(owner: string): string {
  if (owner.startsWith('Bank funding')) return 'Bank';
  const base = owner.split('-')[0] || owner;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function BbLink({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="bb-link" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function TerminalApp() {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatLock = useRef(false);

  const [boot, setBoot] = useState<BootstrapResponse>(OFFLINE_BOOTSTRAP);
  const [account, setAccount] = useState<AccountRef | null>(null);
  const [stoppedTransferId, setStoppedTransferId] = useState<string | null>(null);
  const [view, setView] = useState<AccountView | null>(null);
  const [peers, setPeers] = useState<AccountRef[]>([]);
  const [busy, setBusy] = useState('');
  const [input, setInput] = useState('');
  const [chatTurns, setChatTurns] = useState<Turn[]>([]);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [selectedPay, setSelectedPay] = useState<string | null>(null);
  const [trail, setTrail] = useState<PaymentTrail | null>(null);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [tamper, setTamper] = useState<TamperReport | null>(null);
  const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [clock, setClock] = useState(() => new Date());

  const append = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLog((prev) => [...prev.slice(-80), `${ts} ${line}`]);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    append('BOOT /api/bootstrap');
    void api.bootstrap().then((b) => {
      setBoot(b);
      append(`BOOT live=${b.live} audit=${b.ledger?.auditCapabilities ? 'POSTGRES' : 'PENDING'}`);
    }).catch(() => setBoot(OFFLINE_BOOTSTRAP));
  }, [append]);

  const chatMeta = boot.chat ?? { provider: 'gemini', configured: false };

  async function loadAccount(id: string) {
    setBusy('SYNC');
    append(`GET /api/accounts ${shortId(id)}`);
    try {
      const v = await api.account(id);
      setView(v);
      const p = await api.peers(id);
      setPeers(p);
      append(`SYNC bal=${v.balance} tx=${v.transfers.length} peers=${p.length}`);
    } catch (e) {
      setView(null);
      setPeers([]);
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (account) void loadAccount(account.id);
    else {
      setView(null);
      setPeers([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  function signIn(a: AccountRef, stoppedId?: string) {
    setAccount(a);
    setStoppedTransferId(stoppedId ?? null);
    setChatTurns([]);
    setIntegrity(null);
    setRaceResult(null);
    setSelectedPay(null);
    setTrail(null);
    rememberWallet({ id: a.id, owner: a.owner, live: true, savedAt: new Date().toISOString() });
    append(`SESS ${personName(a.owner)} ${shortId(a.id)}`);
  }

  function signOut() {
    setAccount(null);
    setStoppedTransferId(null);
    append('SESS OUT');
  }

  async function fundAccount(accountId: string, amountMinor: number, label: string) {
    append(`POST /api/accounts/.../deposits ${label}`);
    await api.deposit(accountId, amountMinor);
    append(`FUND +${(amountMinor / 100).toFixed(2)} USD`);
  }

  async function openWallet(ownerRaw: string, fund = true) {
    const ownerId = ownerRaw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!ownerId || !boot.live) {
      append(boot.live ? 'ERR empty owner id' : 'ERR ledger offline');
      return;
    }
    setBusy('OPEN');
    try {
      const existing = await api.findAccounts(ownerId);
      const prior = existing[0];
      if (prior) {
        signIn(prior);
        append(`OPEN existing ${ownerId}`);
        return;
      }
      append(`POST /api/accounts ${ownerId}`);
      const a = await api.openAccount(ownerId);
      signIn(a);
      if (fund) await fundAccount(a.id, OPENING_DEPOSIT_MINOR, 'opening ACH');
      await loadAccount(a.id);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function onboard() {
    setBusy('ONBOARD');
    append('POST /api/demo treasury scenario');
    try {
      const seeded = await api.seedDemo();
      const focus = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
      if (focus) signIn(focus, seeded.stopped.transferId);
      append(`ONBOARD ${seeded.accounts.length} accounts + payments on PostgreSQL`);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runIntegrity() {
    setBusy('AUDIT');
    append('GET /api/integrity');
    try {
      const result = await api.integrity();
      setIntegrity(result);
      if (result.auditAvailable === false || result.source === 'audit-unavailable') {
        append('AUDIT pending on ledger host (404) — balances in WATCH/BLOTTER are still live Postgres');
      } else {
        append(`AUDIT live balanced=${result.balanced} entries=${result.entryCount}`);
      }
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runDeposit(amountStr: string) {
    if (!account) return;
    const minor = dollarsToMinor(amountStr);
    if (minor === null) {
      append('ERR amount — use :deposit 100 or :deposit 25.50');
      return;
    }
    setBusy('DEP');
    try {
      await fundAccount(account.id, minor, 'user deposit');
      await loadAccount(account.id);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runPay(args: string) {
    if (!account) return;
    const m = /^(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(args.trim());
    if (!m) {
      append('ERR :pay <peer> <amount> [memo]');
      return;
    }
    const peerTok = m[1];
    const amtTok = m[2];
    const memo = m[3];
    if (!peerTok || !amtTok) {
      append('ERR :pay <peer> <amount> [memo]');
      return;
    }
    const minor = dollarsToMinor(amtTok);
    if (minor === null) {
      append('ERR bad amount');
      return;
    }
    let dest = peers.find((p) => p.id === peerTok || p.owner === peerTok || p.owner.startsWith(peerTok));
    if (!dest) {
      const found = await api.findAccounts(peerTok);
      dest = found[0] ?? undefined;
    }
    if (!dest) {
      append('ERR unknown peer — try ONBOARD (F2) or :pay <uuid>');
      return;
    }
    setBusy('PAY');
    append(`POST /api/transfers → ${dest.owner}`);
    try {
      const t = await api.transfer({
        sourceAccountId: account.id,
        destinationAccountId: dest.id,
        amountMinor: minor,
        currency: 'USD',
        memo: memo?.trim() || undefined,
      });
      append(`PAY ${t.status} id=${shortId(t.id)}`);
      await loadAccount(account.id);
      setSelectedPay(t.id);
      void loadTrail(account.id, t.id);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function loadTrail(accountId: string, transferId: string) {
    setBusy('TRAIL');
    setTrail(null);
    setReplay(null);
    setTamper(null);
    try {
      const t = await api.trail(accountId, transferId);
      setTrail(t);
      append(`TRAIL ${t.status} legs=${t.legs.length}`);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function pickPayment(transferId: string) {
    setSelectedPay(transferId);
    if (account) void loadTrail(account.id, transferId);
  }

  async function runRace() {
    if (!account) return;
    let fromId: string | null = null;
    if (view) {
      const fromTx = view.transfers.find((t) => t.kind === 'TRANSFER' && t.direction === 'received' && t.status === 'COMPLETED');
      if (fromTx) fromId = fromTx.counterpartyAccountId;
    }
    if (!fromId && peers[0]) fromId = peers[0].id;
    if (!fromId) {
      append('ERR no sender — F2 ONBOARD or :pay a peer first');
      return;
    }
    setBusy('RACE');
    append('POST /api/race ×5 same Idempotency-Key');
    try {
      const r = await api.race(account.id, fromId);
      setRaceResult(r);
      append(`RACE ${r.distinctTransfers} payment(s) from ${r.from}`);
      await loadAccount(account.id);
      if (r.transferId) {
        setSelectedPay(r.transferId);
        void loadTrail(account.id, r.transferId);
      }
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function sendChat(text: string) {
    if (!account || chatLock.current) return;
    chatLock.current = true;
    const next = [...chatTurns, { role: 'user' as const, text }];
    setChatTurns(next);
    setInput('');
    setBusy('CHAT');
    try {
      const reply = await api.chat(account.id, next.slice(-12));
      append(`CHAT via ${reply.route ?? reply.provider}`);
      if (reply.fallbackReason) append(`CHAT ${reply.fallbackReason}`);
      setChatTurns([...next, {
        role: 'assistant',
        text: reply.answer,
        toolCalls: reply.toolCalls,
        model: reply.model,
        provider: reply.provider,
      }]);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      chatLock.current = false;
      setBusy('');
    }
  }

  function runCommand(raw: string) {
    const action = parseTerminalInput(raw);
    switch (action.kind) {
      case 'help':
        append('CMD F1 help | F2 onboard | F3 audit | F4 race | pay sam 10 lunch | deposit 100 | :open name');
        return;
      case 'onboard':
        void onboard();
        return;
      case 'audit':
        void runIntegrity();
        return;
      case 'race':
        void runRace();
        return;
      case 'deposit':
        void runDeposit(action.amount);
        return;
      case 'pay':
        void runPay(action.args);
        return;
      case 'open':
        void openWallet(action.owner, true);
        return;
      case 'signout':
        signOut();
        return;
      case 'refresh':
        if (account) void loadAccount(account.id);
        return;
      case 'chat':
        if (!action.text) return;
        if (account) void sendChat(action.text);
        else append('ERR sign in — F2 ONBOARD or open name');
        return;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    runCommand(input);
    setInput('');
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'F1') { e.preventDefault(); runCommand(':help'); }
    if (e.key === 'F2') { e.preventDefault(); void onboard(); }
    if (e.key === 'F3') { e.preventDefault(); void runIntegrity(); }
    if (e.key === 'F4') { e.preventDefault(); void runRace(); }
  }

  const saved = loadSavedWallets().filter((w) => w.live);
  const transfers = view ? orderStoppedFirst(view.transfers, stoppedTransferId) : [];
  const liveTag = boot.live ? 'LIVE' : 'OFFLINE';
  const auditTag = boot.ledger?.auditCapabilities ? 'AUDIT OK' : 'AUDIT PENDING';

  return (
    <div className="bb" onKeyDown={onKeyDown}>
      <header className="bb-top">
        <span className="bb-logo">P2P</span>
        <span className="bb-ticker">
          <span className={boot.live ? 'bb-up' : 'bb-down'}>{liveTag}</span>
          <span>{auditTag}</span>
          <span>PG</span>
          {account && view && (
            <>
              <span className="bb-hi">{personName(view.owner)}</span>
              <span className="bb-hi">{view.balance}</span>
            </>
          )}
          <span className="bb-dim">{clock.toLocaleTimeString()}</span>
        </span>
        <span className="bb-fn">F1 HELP · F2 ONBOARD · F3 AUDIT · F4 RACE</span>
        <a className="bb-dim" href={REPO} target="_blank" rel="noreferrer">SRC</a>
      </header>

      {!account && (
        <div className="bb-landing">
          <p>This is a real double-entry ledger on PostgreSQL — not a slideshow.</p>
          <p className="bb-dim">
            <BbLink onClick={() => void onboard()} disabled={!boot.live || busy !== ''}>ONBOARD</BbLink>
            loads three treasury accounts, deposits, transfers, and one declined payment you can inspect.
            <BbLink onClick={() => void openWallet('treasurer', true)} disabled={!boot.live || busy !== ''}>OPEN</BbLink>
            creates your wallet with a $500 simulated bank deposit.
          </p>
          {saved.length > 0 && (
            <p>
              Resume:{' '}
              {saved.map((w) => (
                <BbLink key={w.id} onClick={() => signIn({ id: w.id, owner: w.owner })} disabled={busy !== ''}>
                  {personName(w.owner)}
                </BbLink>
              ))}
            </p>
          )}
          <p className="bb-dim">
            Assistant: {chatMeta.configured ? `${chatMeta.provider} ready` : `ledger-only — ${chatMeta.configHint ?? 'set GEMINI_API_KEY'}`}
          </p>
        </div>
      )}

      {account && view && (
        <div className="bb-grid">
          <section className="bb-panel bb-watch">
            <h2 className="bb-hd">WATCH</h2>
            <table className="bb-tbl">
              <tbody>
                <tr><td className="bb-k">OWNER</td><td>{view.owner}</td></tr>
                <tr><td className="bb-k">ID</td><td className="bb-mono">{shortId(account.id)}</td></tr>
                <tr><td className="bb-k">BAL</td><td className="bb-hi">{view.balance}</td></tr>
                <tr><td className="bb-k">30D OUT</td><td>{view.summary.sent}</td></tr>
                <tr><td className="bb-k">30D IN</td><td>{view.summary.received}</td></tr>
                <tr><td className="bb-k">STOPPED</td><td>{view.summary.stopped}</td></tr>
              </tbody>
            </table>
            <h3 className="bb-subhd">PEERS</h3>
            {peers.length === 0
              ? <p className="bb-dim">None yet — ONBOARD or receive a payment.</p>
              : (
                <ul className="bb-list">
                  {peers.map((p) => (
                    <li key={p.id}>
                      <BbLink onClick={() => runCommand(`:pay ${p.owner} 5 tip`)} disabled={busy !== ''}>
                        {personName(p.owner)}
                      </BbLink>
                      <span className="bb-dim"> {shortId(p.id)}</span>
                    </li>
                  ))}
                </ul>
              )}
            <div className="bb-actions">
              <BbLink onClick={() => void runDeposit('100')} disabled={busy !== ''}>+DEP $100</BbLink>
              <BbLink onClick={() => void runRace()} disabled={busy !== ''}>RACE</BbLink>
              <BbLink onClick={signOut}>OUT</BbLink>
            </div>
          </section>

          <section className="bb-panel bb-blotter">
            <h2 className="bb-hd">BLOTTER</h2>
            <table className="bb-tbl bb-blotter-tbl">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>MEMO</th>
                  <th>CP</th>
                  <th>STS</th>
                  <th className="bb-r">AMT</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 && (
                  <tr><td colSpan={5} className="bb-dim">No movements — :deposit 500 or F2 ONBOARD</td></tr>
                )}
                {transfers.map((t) => (
                  <tr
                    key={t.transferId}
                    className={selectedPay === t.transferId ? 'bb-row-on' : undefined}
                    onClick={() => void pickPayment(t.transferId)}
                  >
                    <td>{when(t.createdAt)}</td>
                    <td>{t.memo || '—'}</td>
                    <td>{t.direction === 'deposit' ? 'BANK' : personName(t.counterparty)}</td>
                    <td>{t.status === 'REJECTED' ? 'REJ' : 'OK'}</td>
                    <td className="bb-r">{t.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedPay && trail && (
              <div className="bb-detail">
                <p className="bb-mono">{trail.from} → {trail.to} · {trail.amount} · {trail.status}</p>
                <pre className="bb-pre">{trail.legs.map((l) =>
                  `#${l.entryId} ${l.account} ${l.side} ${l.amount}`,
                ).join('\n') || '(no entries)'}</pre>
                {trail.audited && (
                  <p>
                    <BbLink onClick={() => account && void api.replay(account.id, selectedPay).then((r) => {
                      setReplay(r);
                      append(`REPLAY ${r.httpStatus}`);
                    })} disabled={busy !== ''}>REPLAY</BbLink>
                    {trail.status === 'COMPLETED' && (
                      <>
                        {' · '}
                        <BbLink onClick={() => account && void api.tamper(account.id, selectedPay).then((r) => {
                          setTamper(r);
                          append('TAMPER checks');
                        })} disabled={busy !== ''}>TAMPER</BbLink>
                      </>
                    )}
                  </p>
                )}
                {replay && <p className="bb-dim">Replay {replay.httpStatus} replayed={replay.replayed}</p>}
                {tamper && (
                  <pre className="bb-pre">{tamper.attempts.map((a) => `${a.attempt}: ${a.refused ? 'REFUSED' : 'FAIL'}`).join('\n')}</pre>
                )}
              </div>
            )}
          </section>

          <section className="bb-panel bb-audit">
            <h2 className="bb-hd">AUDIT / MSG</h2>
            <BbLink onClick={() => void runIntegrity()} disabled={busy !== ''}>RUN COMPANY RECONCILIATION</BbLink>
            {integrity && (
              <div className="bb-audit-body">
                {integrity.source === 'audit-unavailable' || integrity.auditAvailable === false ? (
                  <p className="bb-warn">{integrity.message ?? 'Audit API not deployed on ledger host.'}</p>
                ) : (
                  <pre className="bb-pre">
                    {[
                      `BALANCED  ${integrity.balanced}`,
                      `ENTRIES   ${integrity.entryCount}`,
                      `SUM       ${integrity.entriesSum}`,
                      `DRIFT     ${integrity.accountsDrifted}`,
                      `OUTBOX    ${integrity.outbox.p95DeliveryMs ?? '—'} ms p95`,
                    ].join('\n')}
                  </pre>
                )}
              </div>
            )}
            {raceResult && (
              <>
                <p className="bb-dim">
                  {raceResult.attempts.filter((a) => !a.replayed).length} processed ·
                  {raceResult.attempts.filter((a) => a.replayed).length} replays ·
                  {raceResult.distinctTransfers} payment(s)
                  <span className="bb-dim"> — copy # is launch order, not who won first</span>
                </p>
                <pre className="bb-pre">{raceResult.attempts.map((a) =>
                  `copy ${a.copyIndex}  HTTP ${a.httpStatus}  ${a.replayed ? 'REPLAY' : 'PROCESSED'}  ${a.ms}ms`,
                ).join('\n')}</pre>
              </>
            )}
            <div className="bb-chat">
              {chatTurns.slice(-4).map((t, i) => (
                <p key={i} className={t.role === 'user' ? 'bb-chat-u' : 'bb-chat-a'}>
                  {t.role === 'user' ? 'Q: ' : 'A: '}{t.text}
                </p>
              ))}
            </div>
            <pre className="bb-log">{log.slice(-6).join('\n')}</pre>
          </section>
        </div>
      )}

      <form className="bb-cmd" onSubmit={onSubmit}>
        <span className="bb-cmd-label">CMD&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={account ? ':pay sam 10 lunch · or ask a question' : ':open name · F2 onboard'}
          disabled={busy === 'CHAT'}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="bb-go" disabled={!input.trim()}>GO</button>
      </form>
      {busy && <div className="bb-status">{busy}</div>}
    </div>
  );
}

function orderStoppedFirst(transfers: AccountActivity[], stoppedTransferId: string | null): AccountActivity[] {
  if (!stoppedTransferId) return transfers;
  return [...transfers].sort((a, b) => Number(b.transferId === stoppedTransferId) - Number(a.transferId === stoppedTransferId));
}
