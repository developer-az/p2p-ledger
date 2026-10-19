import { useState } from 'react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { loadSavedWallets, rememberWallet } from '../wallet-store.js';
import { displayName, money } from './format.js';
import type { Session } from './session.js';
import { Avatar, Icon, useToast } from './ui.js';

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
  const toast = useToast();
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
        onStart({ account, household: seeded.accounts, demo: true });
      } else {
        let accounts: AccountRef[];
        let focusId: string;
        try {
          const seeded = await api.seedPracticeDemo();
          accounts = seeded.accounts;
          focusId = seeded.focusAccountId;
        } catch {
          accounts = boot.practice.accounts.map(({ id, owner }) => ({ id, owner }));
          focusId = boot.practice.focusAccountId;
        }
        const account = accounts.find((a) => a.id === focusId) ?? accounts[0];
        if (!account) throw new Error('No practice wallets are available.');
        onStart({ account, household: accounts, demo: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!name.trim() || !boot) return;
    setBusy('create');
    setError(null);
    try {
      const account = await api.openAccount(ownerIdFor(name));
      let funded = false;
      try {
        await api.bankWelcome(account.id);
        funded = true;
      } catch {
        /* The wallet still works; the person can add money manually. */
      }
      rememberWallet({ id: account.id, owner: account.owner, live, savedAt: new Date().toISOString() });
      onStart({ account, household: [], demo: false });
      toast(funded
        ? 'Your wallet is ready, with a $500 demo deposit and a first friend.'
        : 'Your wallet is ready. Add money whenever you like.', { tone: 'good' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="welcome">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow">Settle · money with intention</p>
          <h1>Know your money.<br /><em>Keep</em> the habit.</h1>
          <p className="welcome-lede">
            One calm place for your cash, your cards, and what you actually spend.
            Log in two taps and watch the week take shape.
          </p>
          <div className="row-wrap welcome-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
              {busy === 'demo' ? 'Setting up…' : 'Start the guided demo'}
              {busy !== 'demo' ? <Icon name="sparkle" size={18} /> : null}
            </button>
            <a className="btn btn-lg" href="#how">See how it works</a>
          </div>
          <p className="welcome-demo-note">Sample history, five habits to try, and a real ledger underneath. No setup required.</p>
          <p className="legal">Demo only. Pretend dollars between demo wallets. No bank login, no real money.</p>
          <a className="welcome-own-link" href="#own-wallet">Or start with your own clean wallet →</a>
          {error ? <p className="error-text" role="alert" style={{ marginTop: 10 }}>{error}</p> : null}
          {bootError ? <div className="notice notice-warn" style={{ marginTop: 12 }}>{bootError}</div> : null}
          {boot && !live ? (
            <div className="notice notice-warn" style={{ marginTop: 12 }}>
              The live ledger is asleep, so this is practice mode. Everything works, but it resets when the server restarts.
            </div>
          ) : null}
        </div>

        <div className="welcome-visual" aria-label="A preview of the Settle app">
          <div className="phone">
            <div className="phone-top">
              <span className="phone-dot" /><span className="phone-dot" /><span className="phone-dot" />
              <span className="phone-title">Settle</span>
            </div>
            <div className="phone-card">
              <p>Net position</p>
              <strong>{money(284_750)}</strong>
              <span>$3,120 cash · $272 on cards</span>
              <div className="phone-ring">
                <span>72%</span>
                <small>of weekly pace</small>
              </div>
            </div>
            <div className="phone-row">
              <span className="phone-icon">☕</span>
              <span><strong>Coffee</strong><small>Logged · Dining</small></span>
              <strong>−$4.50</strong>
            </div>
            <div className="phone-row">
              <span className="phone-icon is-in">↙</span>
              <span><strong>Salary</strong><small>Logged · Income</small></span>
              <strong className="is-in">+$2,100</strong>
            </div>
            <div className="phone-row">
              <span className="phone-icon">🛒</span>
              <span><strong>Groceries</strong><small>Logged · Groceries</small></span>
              <strong>−$42.10</strong>
            </div>
            <div className="phone-fab">+ Log spend</div>
          </div>
          <div className="float-card float-one">
            <span>🔥</span><strong>6-day streak</strong><small>One tap keeps it alive</small>
          </div>
          <div className="float-card float-two">
            <span>🎯</span><strong>$38 left this week</strong><small>You&apos;re on pace</small>
          </div>
        </div>
      </section>

      {saved.length > 0 ? (
        <section className="card saved-card" aria-labelledby="back">
          <div className="card-head">
            <div><p className="eyebrow">This device</p><h2 id="back">Welcome back</h2></div>
          </div>
          <ul className="list">
            {saved.slice(0, 4).map((w) => (
              <li key={w.id}>
                <button type="button" className="item" onClick={() => onStart({ account: { id: w.id, owner: w.owner }, household: [] })}>
                  <Avatar owner={w.owner} />
                  <span className="item-body"><span className="item-title" style={{ display: 'block' }}>{displayName(w.owner)}</span><span className="item-sub" style={{ display: 'block' }}>Open this wallet</span></span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="welcome-features" id="how" aria-label="How it works">
        <article className="feature">
          <span className="feature-icon">💵</span>
          <h2>Three numbers, once</h2>
          <p>Cash, card balance, a weekly pace. Thirty seconds — no bank connection, no spreadsheet.</p>
        </article>
        <article className="feature">
          <span className="feature-icon">✌️</span>
          <h2>Two taps to log</h2>
          <p>Amount, category, done. The app turns small logs into a week you can actually see.</p>
        </article>
        <article className="feature">
          <span className="feature-icon">📈</span>
          <h2>Patterns, not guesswork</h2>
          <p>A calendar heatmap, category shifts and a weekly pace that shows where the month is heading.</p>
        </article>
      </section>

      <section className="welcome-bottom" id="own-wallet">
        <div>
          <p className="eyebrow">Your own wallet</p>
          <h2>Start clean. Keep it yours.</h2>
          <p className="muted">Your cash, cards and logs live on your wallet id — the demo household never touches them. You start with a $500 simulated deposit and a funded ledger balance, so the wallet is never empty.</p>
        </div>
        <form className="welcome-create" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="sr-only" htmlFor="wallet-name">Your first name</label>
          <input id="wallet-name" className="input" maxLength={40} placeholder="Your first name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!name.trim() || busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create my wallet'}
          </button>
          <p className="hint">
            {live
              ? 'Persists in PostgreSQL. No password yet — this is a demo identity, not a bank login.'
              : 'Practice mode: this wallet lives in memory and resets when the server restarts.'}
          </p>
        </form>
      </section>
    </div>
  );
}
