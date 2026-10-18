import { useState } from 'react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { loadSavedWallets } from '../wallet-store.js';
import { rememberWallet } from '../wallet-store.js';
import { displayName } from './format.js';
import type { Session } from './session.js';
import { Avatar, Icon } from './ui.js';

/** Letters and digits only, so the owner id is safe to put in a URL. */
function ownerIdFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug || 'me'}-${tag}`;
}

export function Welcome({
  boot,
  bootError,
  onStart,
}: {
  boot: BootstrapResponse | null;
  bootError: string | null;
  onStart: (session: Session) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'demo' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = loadSavedWallets().filter((w) => boot?.live ? w.live : !w.live);
  const live = boot?.live ?? false;

  async function tryDemo() {
    if (!boot) return;
    setBusy('demo');
    setError(null);
    try {
      if (live) {
        const seeded = await api.seedDemo();
        const account = seeded.accounts.find((a) => a.id === seeded.focusAccountId) ?? seeded.accounts[0];
        if (!account) throw new Error('The demo did not create any wallets.');
        onStart({ account, household: seeded.accounts });
      } else {
        const accounts: AccountRef[] = boot.practice.accounts.map(({ id, owner }) => ({ id, owner }));
        const account = accounts.find((a) => a.id === boot.practice.focusAccountId) ?? accounts[0];
        if (!account) throw new Error('No practice wallets are available.');
        onStart({ account, household: accounts });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!name.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const account = await api.openAccount(ownerIdFor(name));
      rememberWallet({ id: account.id, owner: account.owner, live: true, savedAt: new Date().toISOString() });
      onStart({ account, household: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 32 }}>
      <section className="hero">
        <div>
          <p className="eyebrow">Settle · a demo money app</p>
          <h1>Split the bill. Pay a friend. See where it went.</h1>
          <p className="hero-lede">
            Send money, ask friends to chip in, and keep track of what you spend. Every payment is recorded in a
            double-entry ledger that cannot be edited afterwards, and you can open the proof on any of them.
          </p>
          <div className="row-wrap" style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-primary" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
              {busy === 'demo' ? 'Setting up…' : 'Try the demo'}
            </button>
            <a className="btn" href="/ops">See the engineering console</a>
          </div>
          <p className="legal" style={{ marginTop: 12 }}>
            Demo only. This moves pretend dollars between demo wallets. It is not a bank and never touches real money.
          </p>
          {error ? <p className="error-text" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
          {bootError ? <div className="notice notice-warn" style={{ marginTop: 12 }}>{bootError}</div> : null}
          {boot && !live ? (
            <div className="notice notice-warn" style={{ marginTop: 12 }}>
              The live ledger is asleep, so you are looking at practice mode. Everything works, but it runs in memory
              and resets when the server restarts.
            </div>
          ) : null}
        </div>
        <div className="card stack-sm" aria-label="Preview">
          <div className="row between"><strong>Dinner at Luigi&apos;s</strong><span className="pill pill-warn">3 asked</span></div>
          <div className="row between"><span className="muted">Sam pays</span><strong className="num">$18.00</strong></div>
          <div className="row between"><span className="muted">Jordan pays</span><strong className="num">$18.00</strong></div>
          <div className="row between faint"><span>Your share</span><span className="num">$18.00</span></div>
          <p className="hint">Shares always add up to the bill. Money moves only when each friend accepts.</p>
        </div>
      </section>

      {saved.length > 0 ? (
        <section className="card" aria-labelledby="back">
          <h2 id="back" style={{ marginBottom: 8 }}>Welcome back</h2>
          <ul className="list">
            {saved.slice(0, 4).map((w) => (
              <li key={w.id}>
                <button type="button" className="item" onClick={() => onStart({ account: { id: w.id, owner: w.owner }, household: [] })}>
                  <Avatar owner={w.owner} />
                  <span className="item-body"><span className="item-title">{displayName(w.owner)}</span></span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="steps" aria-label="How it works">
        {[
          ['Send and split', 'Pay a friend in a few taps, or split a bill and ask each person for an equal share.'],
          ['Know where it goes', 'Log what you spend and see your week against last week, by category.'],
          ['Check the receipts', 'Open any payment to see the two ledger lines behind it and the checks that guard it.'],
        ].map(([title, body], i) => (
          <div className="card" key={title}>
            <div className="step-num">{i + 1}</div>
            <h2>{title}</h2>
            <p className="muted" style={{ marginTop: 4 }}>{body}</p>
          </div>
        ))}
      </section>

      {live ? (
        <section className="card stack-sm" aria-labelledby="mine">
          <h2 id="mine">Or make your own wallet</h2>
          <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <label className="sr-only" htmlFor="wallet-name">Your first name</label>
            <input id="wallet-name" className="input" style={{ flex: 1, minWidth: 180 }} maxLength={40} placeholder="Your first name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" type="submit" disabled={!name.trim() || busy !== null}>{busy === 'create' ? 'Creating…' : 'Create wallet'}</button>
          </form>
          <p className="hint">There are no passwords yet. A wallet is identified by its id on this device, so treat this as a demo.</p>
        </section>
      ) : null}
    </div>
  );
}
