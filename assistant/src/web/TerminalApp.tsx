import {
  Fragment,
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
import { PeerPanel } from './PeerPanel.js';
import { parseTerminalInput } from './terminal-command.js';
import {
  deleteConfirmSkipped,
  loadHiddenTransfers,
  saveHiddenTransfers,
  setDeleteConfirmSkip,
} from './blotter-store.js';
import {
  downloadStatementTxt,
  integrityLegend,
  integrityPlainEnglish,
  printStatement,
} from './integrity-display.js';
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
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [clock, setClock] = useState(() => new Date());
  const [hiddenTransferIds, setHiddenTransferIds] = useState<Set<string>>(() => new Set());
  const [pendingHideId, setPendingHideId] = useState<string | null>(null);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);

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

  useEffect(() => {
    if (account) setHiddenTransferIds(loadHiddenTransfers(account.id));
  }, [account?.id]);

  useEffect(() => {
    function onDocKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (el?.closest('button, a, [role="button"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, []);

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
    setSelectedPeerId(null);
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
      if (fund) {
        append('POST /api/bank/welcome · deposit + inbound corridor peer');
        const welcome = await api.bankWelcome(a.id);
        append(`BANK ${welcome.corridor.peer.owner} → you ${welcome.corridor.amount}`);
        setSelectedPeerId(welcome.corridor.peer.id);
      }
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

  async function runBankInbound() {
    if (!account) return;
    setBusy('BANK');
    append('POST /api/bank/inbound · new corridor peer');
    try {
      const r = await api.bankInbound(account.id);
      append(`BANK IN ${r.amount} from ${r.peer.owner} · ${r.status}`);
      setSelectedPeerId(r.peer.id);
      await loadAccount(account.id);
      setSelectedPay(r.transferId);
      void loadTrail(account.id, r.transferId);
    } catch (e) {
      append(`ERR ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function runBankOutbound() {
    if (!account) return;
    setBusy('BANK');
    append('POST /api/bank/outbound · pay vendor corridor');
    try {
      const r = await api.bankOutbound(account.id);
      append(`BANK OUT ${r.amount} → ${r.peer.owner} · ${r.status}`);
      setSelectedPeerId(r.peer.id);
      await loadAccount(account.id);
      setSelectedPay(r.transferId);
      void loadTrail(account.id, r.transferId);
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
      append(
        t.status === 'REJECTED' && t.rejectionReason
          ? `PAY REJECTED ${t.rejectionReason} id=${shortId(t.id)}`
          : `PAY ${t.status} id=${shortId(t.id)}`,
      );
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
    if (selectedPay === transferId) {
      setSelectedPay(null);
      setTrail(null);
      setReplay(null);
      setTamper(null);
      setPendingHideId(null);
      return;
    }
    setSelectedPay(transferId);
    if (account) void loadTrail(account.id, transferId);
  }

  function resolvePeer(ownerTok: string): AccountRef | undefined {
    const tok = ownerTok.trim().toLowerCase();
    return peers.find((p) => p.id === ownerTok || p.owner === tok || p.owner.startsWith(tok));
  }

  function selectPeer(ownerTok: string) {
    const p = resolvePeer(ownerTok);
    if (!p) {
      append(`ERR no peer matching ${ownerTok}`);
      return;
    }
    if (selectedPeerId === p.id) {
      setSelectedPeerId(null);
      append('PEER focus cleared');
      return;
    }
    setSelectedPeerId(p.id);
    append(`PEER focus ${p.owner}`);
  }

  async function runRaceFromPeer(peerId: string) {
    if (!account) return;
    setBusy('RACE');
    append('POST /api/race · peer as sender');
    try {
      const r = await api.race(account.id, peerId);
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

  async function runRace() {
    if (!account) return;
    if (selectedPeerId) {
      void runRaceFromPeer(selectedPeerId);
      return;
    }
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
        append('CMD F1 help | F2 onboard | bank in | bank out | peer sam | pay sam 10 lunch | split 50 sam dinner');
        return;
      case 'bank-in':
        void runBankInbound();
        return;
      case 'bank-out':
        void runBankOutbound();
        return;
      case 'peer':
        selectPeer(action.owner);
        return;
      case 'peers':
        if (peers.length === 0) append('PEERS none — ONBOARD first');
        else append(`PEERS ${peers.map((p) => p.owner).join(', ')} · peer <name> to focus`);
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
  const selectedPeer = peers.find((p) => p.id === selectedPeerId) ?? null;
  const allTransfers = view ? orderStoppedFirst(view.transfers, stoppedTransferId) : [];
  const transfers = (selectedPeer
    ? allTransfers.filter((t) =>
      t.counterpartyAccountId === selectedPeer.id
      || t.counterparty === selectedPeer.owner
      || t.counterparty.startsWith(selectedPeer.owner.split('-')[0] ?? ''),
    )
    : allTransfers).filter((t) => !hiddenTransferIds.has(t.transferId));

  function hideTransferFromBlotter(transferId: string) {
    if (!account) return;
    const next = new Set(hiddenTransferIds);
    next.add(transferId);
    setHiddenTransferIds(next);
    saveHiddenTransfers(account.id, next);
    if (selectedPay === transferId) {
      setSelectedPay(null);
      setTrail(null);
      setReplay(null);
      setTamper(null);
    }
    setPendingHideId(null);
    append(`HIDE ${shortId(transferId)} (demo view only — real ledger stays append-only)`);
  }

  function requestHideTransfer(transferId: string) {
    if (deleteConfirmSkipped()) {
      hideTransferFromBlotter(transferId);
      return;
    }
    setPendingHideId(transferId);
    setSkipDeleteConfirm(false);
  }

  function confirmHideTransfer() {
    if (!pendingHideId) return;
    if (skipDeleteConfirm) setDeleteConfirmSkip(1);
    hideTransferFromBlotter(pendingHideId);
  }
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
            <div className="bb-panel-main">
              <table className="bb-tbl bb-summary-tbl">
                <tbody>
                  <tr><td className="bb-k">BAL</td><td className="bb-hi">{view.balance}</td></tr>
                  <tr><td className="bb-k">OWNER</td><td>{personName(view.owner)}</td></tr>
                  <tr><td className="bb-k">30D</td><td className="bb-dim">out {view.summary.sent} · dep {view.summary.deposited} · in {view.summary.received}</td></tr>
                </tbody>
              </table>
              <h3 className="bb-subhd">PEERS</h3>
              {peers.length === 0
                ? <p className="bb-dim bb-pad">None yet — F2 ONBOARD or ACH IN.</p>
                : (
                  <div className="bb-peer-chips bb-pad">
                    {peers.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`bb-btn-chip${selectedPeerId === p.id ? ' bb-btn-chip-on' : ''}`}
                        disabled={busy !== ''}
                        onClick={() => selectPeer(p.owner)}
                      >
                        {personName(p.owner)}
                      </button>
                    ))}
                  </div>
                )}
              {selectedPeer && (
                <PeerPanel
                  accountId={account.id}
                  peer={selectedPeer}
                  busy={busy !== ''}
                  onPay={(amount, memo) => void runPay(`${selectedPeer.owner} ${amount} ${memo}`)}
                  onRaceFromPeer={() => void runRaceFromPeer(selectedPeer.id)}
                  onClearFocus={() => {
                    setSelectedPeerId(null);
                    append('PEER focus cleared');
                  }}
                />
              )}
            </div>
            <div className="bb-watch-dock">
              <p className="bb-dock-label">BANK &amp; ACTIONS</p>
              <div className="bb-dock-row">
                <BbLink onClick={() => void runBankInbound()} disabled={busy !== ''}>ACH IN</BbLink>
                <BbLink onClick={() => void runBankOutbound()} disabled={busy !== ''}>ACH OUT</BbLink>
                <BbLink onClick={() => void runDeposit('100')} disabled={busy !== ''}>+DEP $100</BbLink>
                <BbLink onClick={() => void runRace()} disabled={busy !== ''}>RACE</BbLink>
              </div>
              <div className="bb-dock-row">
                <BbLink onClick={() => downloadStatementTxt(account.id)} disabled={busy !== ''}>DL TXT</BbLink>
                <BbLink
                  onClick={() => void printStatement(account.id).catch((e) => append(`ERR ${(e as Error).message}`))}
                  disabled={busy !== ''}
                  title="Opens print dialog — choose Save as PDF"
                >
                  PRINT
                </BbLink>
                <BbLink onClick={() => void loadAccount(account.id)} disabled={busy !== ''}>REFRESH</BbLink>
                <BbLink onClick={signOut}>OUT</BbLink>
              </div>
            </div>
          </section>

          <section className="bb-panel bb-blotter">
            <h2 className="bb-hd">BLOTTER{selectedPeer ? ` · ${personName(selectedPeer.owner)}` : ''}</h2>
            <div className="bb-panel-main">
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
                  <Fragment key={t.transferId}>
                    <tr
                      className={selectedPay === t.transferId ? 'bb-row-on' : undefined}
                      onClick={() => void pickPayment(t.transferId)}
                    >
                      <td>{when(t.createdAt)}</td>
                      <td>{t.memo || '—'}</td>
                      <td>{t.direction === 'deposit' ? 'BANK' : personName(t.counterparty)}</td>
                      <td title={t.declineExplanation ?? t.declineReason ?? undefined}>
                        {t.status === 'REJECTED' ? `REJ${t.declineReason ? `·${t.declineReason.slice(0, 12)}` : ''}` : 'OK'}
                      </td>
                      <td className="bb-r">{t.amount}</td>
                    </tr>
                    {selectedPay === t.transferId && trail && (
                      <tr className="bb-detail-row">
                        <td colSpan={5}>
                          <div className="bb-detail bb-detail-inline">
                            <p className="bb-mono">{trail.from} → {trail.to} · {trail.amount} · {trail.status}</p>
                            {trail.status === 'REJECTED' && trail.decline && (
                              <p className="bb-warn">
                                {trail.decline.code}: {trail.decline.explanation ?? 'Declined by fraud rules.'}
                              </p>
                            )}
                            {trail.status === 'REJECTED' && trail.legs.length === 0 && (
                              <p className="bb-dim">No ledger entries — the rule ran before any money moved.</p>
                            )}
                            <pre className="bb-pre">{trail.legs.map((l) =>
                              `#${l.entryId} ${l.account} ${l.side} ${l.amount}`,
                            ).join('\n') || (trail.status === 'REJECTED' ? '' : '(no entries)')}</pre>
                            <p className="bb-actions">
                              {trail.audited && (
                                <>
                                  <BbLink onClick={() => account && void api.replay(account.id, t.transferId).then((r) => {
                                    setReplay(r);
                                    append(`REPLAY ${r.httpStatus}`);
                                  })} disabled={busy !== ''}>REPLAY</BbLink>
                                  {trail.status === 'COMPLETED' && (
                                    <>
                                      {' · '}
                                      <BbLink onClick={() => account && void api.tamper(account.id, t.transferId).then((r) => {
                                        setTamper(r);
                                        append('TAMPER checks');
                                      })} disabled={busy !== ''}>TAMPER</BbLink>
                                    </>
                                  )}
                                  {' · '}
                                </>
                              )}
                              <BbLink onClick={() => requestHideTransfer(t.transferId)} disabled={busy !== ''}>HIDE</BbLink>
                            </p>
                            {pendingHideId === t.transferId && (
                              <div className="bb-confirm">
                                <p>Hide this line from your blotter? On a real ledger you could never delete money — only append corrections.</p>
                                <label className="bb-check">
                                  <input
                                    type="checkbox"
                                    checked={skipDeleteConfirm}
                                    onChange={(e) => setSkipDeleteConfirm(e.target.checked)}
                                  />
                                  Don&apos;t ask again for 1 minute
                                </label>
                                <p className="bb-actions">
                                  <BbLink onClick={confirmHideTransfer}>Yes, hide</BbLink>
                                  {' · '}
                                  <BbLink onClick={() => setPendingHideId(null)}>Cancel</BbLink>
                                </p>
                              </div>
                            )}
                            {replay && <p className="bb-dim">Replay {replay.httpStatus} replayed={replay.replayed}</p>}
                            {tamper && (
                              <pre className="bb-pre">{tamper.attempts.map((a) => `${a.attempt}: ${a.refused ? 'REFUSED' : 'FAIL'}`).join('\n')}</pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            </div>
          </section>

          <section className="bb-panel bb-audit">
            <h2 className="bb-hd">AUDIT / MSG</h2>
            <div className="bb-panel-main bb-audit-scroll">
            <BbLink onClick={() => void runIntegrity()} disabled={busy !== ''}>CHECK ALL ACCOUNTS (F3)</BbLink>
            {integrity && (
              <div className="bb-audit-body">
                {integrity.source === 'audit-unavailable' || integrity.auditAvailable === false ? (
                  <p className="bb-warn">{integrity.message ?? 'Audit API not deployed on ledger host.'}</p>
                ) : (
                  <>
                    <p className="bb-audit-plain">
                      {integrityPlainEnglish(integrity).map((line, i) => (
                        <span key={i}>{line}<br /></span>
                      ))}
                    </p>
                    <details className="bb-audit-tech">
                      <summary>Technical details</summary>
                      <pre className="bb-pre">{integrityLegend(integrity).join('\n')}</pre>
                    </details>
                    <p className="bb-dim">This checks the whole company ledger — WATCH above is only your wallet.</p>
                  </>
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
            </div>
          </section>
        </div>
      )}

      <form className="bb-cmd" onSubmit={onSubmit}>
        <span className="bb-cmd-label">CMD&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={account ? 'peer sam · pay sam 10 lunch · split 50 sam dinner · or ask AI' : ':open name · F2 onboard'}
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
