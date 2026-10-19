import { useEffect, useState } from 'react';
import { api, type AccountRef, type Integrity, type ReplayResult, type TamperReport } from '../api.js';
import type { WalletData } from './data.js';
import { isLedgerItem, buildFeed } from './feed.js';
import { dateTimeLabel } from './format.js';
import { Icon, Skeleton } from './ui.js';

type Run<T> = { state: 'idle' } | { state: 'running' } | { state: 'done'; value: T } | { state: 'error'; message: string };

function useRun<T>(fn: () => Promise<T>): [Run<T>, () => void] {
  const [run, setRun] = useState<Run<T>>({ state: 'idle' });
  const start = () => {
    setRun({ state: 'running' });
    fn().then((value) => setRun({ state: 'done', value })).catch((e: Error) => setRun({ state: 'error', message: e.message }));
  };
  return [run, start];
}

function Demo<T>({ title, plain, button, run, onRun, children }: {
  title: string;
  plain: string;
  button: string;
  run: Run<T>;
  onRun: () => void;
  children: (value: T) => React.ReactNode;
}) {
  return (
    <section className="card stack-sm">
      <h2>{title}</h2>
      <p className="muted">{plain}</p>
      <div><button type="button" className="btn btn-sm" onClick={onRun} disabled={run.state === 'running'}>{run.state === 'running' ? 'Running…' : button}</button></div>
      {run.state === 'error' ? <p className="error-text" role="alert">{run.message}</p> : null}
      {run.state === 'done' ? <div className="card-flat" aria-live="polite">{children(run.value)}</div> : null}
    </section>
  );
}

export function TrustTab({ me, data, embedded = false }: { me: AccountRef; data: WalletData | null; embedded?: boolean }) {
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.integrity().then((i) => { if (!cancelled) setIntegrity(i); }).catch((e: Error) => { if (!cancelled) setIntegrityError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // The demos need a real, completed ledger entry to act on.
  const completed = data ? buildFeed(data.view).find((i) => isLedgerItem(i) && i.transferId && i.kind !== 'declined') : undefined;
  const transferId = completed?.transferId ?? null;

  const [replay, runReplay] = useRun<ReplayResult>(() => api.replay(me.id, transferId!));
  const [tamper, runTamper] = useRun<TamperReport>(() => api.tamper(me.id, transferId!));

  return (
    <div className={embedded ? 'trust-embedded stack' : 'stack'}>
      {!embedded ? (
        <div>
          <h1 className="page-title">Trust</h1>
          <p className="page-sub">What keeps your balance honest, and how to check it yourself.</p>
        </div>
      ) : null}

      <section className="card" aria-labelledby="health">
        <h2 id="health">Ledger health</h2>
        {integrityError ? <p className="muted" style={{ marginTop: 8 }}>{integrityError}</p> : !integrity ? <Skeleton height={60} /> : (
          <div className={`notice ${integrity.balanced ? 'notice-good' : 'notice-bad'}`} style={{ marginTop: 10 }}>
            <div className="row">
              <Icon name={integrity.balanced ? 'shield' : 'alert'} />
              <strong>{integrity.balanced ? 'Every payment balances' : 'Something does not add up'}</strong>
            </div>
            <p style={{ marginTop: 6 }} className="muted">
              {integrity.entryCount.toLocaleString()} ledger lines across {integrity.transferCount.toLocaleString()} payments sum to {integrity.entriesSum}.
              {' '}{integrity.unbalancedTransfers} unbalanced, {integrity.accountsDrifted} wallets out of step. Checked {dateTimeLabel(integrity.checkedAt)}.
              {integrity.source === 'practice' ? ' This is the in-memory practice ledger.' : ''}
            </p>
          </div>
        )}
      </section>

      {!transferId ? (
        <div className="notice">Make a deposit first. These checks run against a real ledger entry in your history.</div>
      ) : null}

      <div className="grid-2">
        <Demo title="Paying twice by accident" button="Retry the same payment" run={replay} onRun={runReplay} plain="Phones drop connections, so apps retry. Every payment carries a unique key, and sending it again returns the original result instead of charging again.">
          {(r) => <p>{r.replayed ? 'The ledger recognised the retry and returned the original payment.' : 'This was the first attempt.'} Ledger lines: {r.entriesBefore} before, {r.entriesAfter} after. Balance stayed {r.balanceAfter}.</p>}
        </Demo>
        <Demo title="Editing history" button="Try to rewrite a payment" run={tamper} onRun={runTamper} plain="Ledger lines are append-only. We attempt to change and delete a real payment using SQL, and the database itself refuses.">
          {(t) => <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>{t.attempts.map((a) => <li key={a.attempt}><strong>{a.attempt}:</strong> {a.refused ? 'refused' : 'allowed'}. <span className="faint">{a.databaseSaid}</span></li>)}</ul>}
        </Demo>
      </div>

      <section className="card stack-sm">
        <h2>What the assistant can see</h2>
        <p className="muted">The Ask tab answers questions using read-only tools scoped to the wallet you are viewing. It can look things up and explain them. It cannot send money, change a balance or read another wallet.</p>
      </section>

      <section className="card stack-sm">
        <h2>What this demo is not</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="muted">
          <li>Not a bank. No real money moves and nothing here is regulated.</li>
          <li>No passwords or sign-in yet. A wallet is identified by its id, so anyone with the id could act as that wallet.</li>
          <li>The hosted version publishes events to a log, not to a message broker.</li>
        </ul>
        <div className="row-wrap">
          <a className="btn btn-sm" href="/ops">Engineering console</a>
          <a className="btn btn-sm" href="https://github.com/developer-az/p2p-ledger" target="_blank" rel="noreferrer">Source on GitHub</a>
        </div>
      </section>
    </div>
  );
}
