import { useState } from 'react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { loadSavedWallets, rememberWallet } from '../wallet-store.js';
import { displayName, money } from './format.js';
import type { Session } from './session.js';
import { CategoryBars } from './CategoryBars.js';
import { Avatar, Icon, PunchRow, useToast, type PunchSlot } from './ui.js';

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
          <h1>Know your money. Keep the habit.</h1>
          <p className="welcome-lede">
            A money app that works like a punch card. Log what you spend in two taps, get today stamped,
            and watch the week fill in. No bank login.
          </p>
          <div className="row-wrap welcome-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
              {busy === 'demo' ? 'Setting up…' : 'Start the guided demo'}
            </button>
            <a className="btn btn-lg" href="#own-wallet">Start my own wallet</a>
          </div>
          <p className="welcome-demo-note">The demo has a sample history, five steps to try and a real double-entry ledger underneath. Pretend dollars only.</p>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {bootError ? <div className="notice notice-warn">{bootError}</div> : null}
          {boot && !live ? (
            <div className="notice notice-warn">
              The live ledger is asleep, so this is practice mode. Everything works, but it resets when the server restarts.
            </div>
          ) : null}
        </div>

        <figure className="welcome-visual" aria-label="Example of the Settle Today screen">
          <div className="hero-card" data-ui>
            <div className="hero-top">
              <div>
                <p className="hero-label">Net position</p>
                <p className="hero-amount num">{money(284_750)}</p>
                <p className="hero-sub">$3,120.00 cash · <span className="hero-debt">$272.50 on cards</span></p>
              </div>
              <div className="hero-side">
                <span className="hero-mini-label">Left this week</span>
                <strong className="hero-mini num">$38.00</strong>
                <span className="hero-mini-sub">of $250.00</span>
              </div>
            </div>
            <div className="hero-bottom">
              <div className="hero-week">
                <p className="hero-week-title">This week&apos;s card <span className="num">5/7</span></p>
                <PunchRow slots={EXAMPLE_WEEK} size="lg" label="Example week: 5 of 7 days logged" />
              </div>
              <span className="btn btn-on-stock btn-lg" aria-hidden="true"><Icon name="plus" size={18} /> Log a spend</span>
            </div>
          </div>
          <ul className="list example-list" data-ui>
            {EXAMPLE_LOGS.map((row) => (
              <li key={row.title} className="item">
                <span className={`icon-circle${row.in ? ' icon-in' : ''}`}><Icon name={row.icon} size={18} /></span>
                <span className="item-body"><span className="item-title">{row.title}</span><span className="item-sub">{row.sub}</span></span>
                <span className={`amount num${row.in ? ' amount-in' : ''}`}>{row.amount}</span>
              </li>
            ))}
          </ul>
          <figcaption className="hint">Example week. Your own wallet starts empty.</figcaption>
        </figure>
      </section>

      {saved.length > 0 ? (
        <section className="card saved-card" aria-labelledby="back">
          <div className="card-head">
            <h2 id="back">Wallets on this device</h2>
          </div>
          <ul className="list">
            {saved.slice(0, 4).map((w) => (
              <li key={w.id}>
                <button type="button" className="item" onClick={() => onStart({ account: { id: w.id, owner: w.owner }, household: [] })}>
                  <Avatar owner={w.owner} />
                  <span className="item-body"><span className="item-title">{displayName(w.owner)}</span><span className="item-sub">Open this wallet</span></span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="welcome-features" id="how" aria-labelledby="how-title">
        <h2 id="how-title" className="welcome-section-title">How it works</h2>
        <article className="feature">
          <div className="feature-ui" data-ui>
            <dl className="example-numbers">
              <div><dt>Cash</dt><dd className="num">$3,120.00</dd></div>
              <div><dt>Cards</dt><dd className="num">$272.50</dd></div>
              <div><dt>Weekly pace</dt><dd className="num">$250.00</dd></div>
            </dl>
          </div>
          <h3>Three numbers, once</h3>
          <p>Cash, card balance and a weekly pace. Thirty seconds, no bank connection, editable any time.</p>
        </article>
        <article className="feature">
          <div className="feature-ui" data-ui>
            <p className="example-amount num">$4.50</p>
            <div className="example-cats">
              {(['dining', 'cart', 'bus', 'ticket'] as const).map((icon, i) => (
                <span key={icon} className={`cat-tile${i === 0 ? ' is-picked' : ''}`}>
                  <span className="cat-icon"><Icon name={icon} size={20} /></span>
                  <span>{['Dining', 'Groceries', 'Transport', 'Fun'][i]}</span>
                </span>
              ))}
            </div>
          </div>
          <h3>Two taps to log</h3>
          <p>Amount, category, done. Each log stamps the day, and your recent spends come back as one-tap repeats.</p>
        </article>
        <article className="feature">
          <div className="feature-ui" data-ui>
            <CategoryBars categories={EXAMPLE_CATEGORIES} max={EXAMPLE_CATEGORIES[0]!.totalMinor} />
          </div>
          <h3>Patterns from your own logs</h3>
          <p>Eight weeks of cards, where the money went, your expensive weekday and a card payoff plan.</p>
        </article>
      </section>

      <section className="welcome-bottom" id="own-wallet" aria-labelledby="own-title">
        <div>
          <h2 id="own-title">Start your own wallet</h2>
          <p className="muted">Your cash, cards and logs live on your own wallet id, apart from the demo household. It opens with a $500 simulated deposit so the ledger is never empty.</p>
        </div>
        <form className="welcome-create" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="label" htmlFor="wallet-name">Your first name</label>
          <div className="welcome-create-row">
            <input id="wallet-name" className="input" maxLength={40} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={!name.trim() || busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create my wallet'}
            </button>
          </div>
          <p className="hint">
            {live
              ? 'Saved in PostgreSQL. No password yet: this is a demo identity, not a bank login.'
              : 'Practice mode: this wallet lives in memory and resets when the server restarts.'}
          </p>
        </form>
      </section>
    </div>
  );
}

const EXAMPLE_WEEK: PunchSlot[] = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => ({
  key: `example-${i}`,
  label,
  stamped: [true, true, false, true, true, true, false][i]!,
  today: i === 6,
  title: `Example day ${i + 1}`,
}));

const EXAMPLE_LOGS = [
  { title: 'Coffee', sub: 'Dining · today', amount: '−$4.50', icon: 'dining' as const, in: false },
  { title: 'Paycheck', sub: 'Income · Friday', amount: '+$2,100.00', icon: 'arrowDown' as const, in: true },
  { title: 'Groceries', sub: 'Groceries · Thursday', amount: '−$42.10', icon: 'cart' as const, in: false },
];

const EXAMPLE_CATEGORIES = [
  { category: 'groceries', totalMinor: 31_240, sharePct: 41 },
  { category: 'dining', totalMinor: 18_450, sharePct: 24 },
  { category: 'transport', totalMinor: 9_800, sharePct: 13 },
];
