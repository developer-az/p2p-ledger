import { useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { loadSavedWallets, rememberWallet } from '../wallet-store.js';
import { displayName, money } from './format.js';
import type { Session } from './session.js';
import { CountUp, EASE_OUT, InView, RevealWords, TiltCard } from './motion-kit.js';
import { Pip } from './Pip.js';
import { Avatar, Icon, useToast } from './ui.js';

/** Letters and digits only, so the owner id is safe to put in a URL. */
function ownerIdFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug || 'me'}-${tag}`;
}

const TAPE = ['Two taps to log', 'No bank login', 'Patterns from your own history', 'Ask in plain English', 'Real double-entry ledger', 'Pip is watching'];

/** Deterministic 8×7 heat pattern for the illustration, so it never flickers between renders. */
const HEAT = Array.from({ length: 56 }, (_, i) => ((i * 37 + (i % 7) * 11) % 9) % 5);

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
  const reduce = useReducedMotion();
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

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, transform: 'translateY(16px)' },
    animate: { opacity: 1, transform: 'translateY(0px)' },
    transition: { duration: 0.7, ease: EASE_OUT, delay },
  } as const);

  return (
    <div className="welcome">
      <section className="w-hero" aria-labelledby="w-title">
        <div className="w-hero-grain" aria-hidden="true" />
        <nav className="w-nav" aria-label="Settle">
          <a className="w-logo" href="/" aria-label="Settle home">
            <Pip size={30} track={false} mood="happy" />
            <span>settle</span>
          </a>
          <span className="w-nav-links">
            <a href="#how">How it works</a>
            <a href="/ops">Console</a>
            <a href="https://github.com/developer-az/p2p-ledger" target="_blank" rel="noreferrer">GitHub ↗</a>
          </span>
          <button type="button" className="w-nav-cta" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
            {busy === 'demo' ? 'Loading…' : 'Try demo'}
          </button>
        </nav>

        <div className="w-hero-body">
          <div className="w-copy">
            <m.p className="w-status" {...rise(0.05)}>
              <span className={`w-status-dot${live ? ' is-live' : ''}`} aria-hidden="true" />
              {boot ? (live ? 'Live ledger online' : 'Practice mode · resets on restart') : 'Connecting…'}
              <span className="w-status-extra"><span className="w-status-sep">/</span> no bank login</span>
            </m.p>
            <h1 id="w-title" className="w-title">
              <RevealWords text="Your money," delay={0.1} />
              <br />
              <RevealWords text="minus the" delay={0.22} />{' '}
              <span className="w-scribble">
                <RevealWords text="mess." delay={0.34} />
                <svg viewBox="0 0 220 60" preserveAspectRatio="none" aria-hidden="true">
                  <m.path
                    d="M6 38 C40 18 70 46 104 30 S170 14 214 34"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.95 }}
                  />
                </svg>
              </span>
            </h1>
            <m.p className="w-lede" {...rise(0.5)}>
              Log a spend in two taps. See your week in one glance. A tiny bean named Pip keeps the streak honest.
            </m.p>
            <m.div className="w-actions" {...rise(0.62)}>
              <button type="button" className="w-btn w-btn-volt" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
                {busy === 'demo' ? 'Setting up…' : 'Try the 60-second demo'}
                <span className="w-btn-arrow" aria-hidden="true">→</span>
              </button>
              <a className="w-btn w-btn-ghost" href="#own-wallet">Start my own</a>
            </m.div>
            <m.p className="w-fine" {...rise(0.72)}>Pretend dollars. Real double-entry ledger underneath.</m.p>
            {error ? <p className="w-error" role="alert">{error}</p> : null}
            {bootError ? <p className="w-error" role="alert">{bootError}</p> : null}
          </div>

          <m.div
            className="w-stage"
            aria-label="A preview of the Settle card"
            initial={reduce ? false : { opacity: 0, transform: 'translateY(40px) scale(0.96)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
            transition={{ duration: 1, ease: EASE_OUT, delay: 0.25 }}
          >
            <div className="w-pip-perch"><Pip size={92} mood="happy" /></div>
            <TiltCard className="s-card s-card-lg">
              <div className="s-card-top">
                <span className="s-card-brand">settle</span>
                <span className="s-card-chip" aria-hidden="true" />
              </div>
              <p className="s-card-label">Net position</p>
              <p className="s-card-amount"><CountUp minor={284_750} /></p>
              <div className="s-card-foot">
                <div>
                  <p className="s-card-label">Left this week</p>
                  <p className="s-card-mid">{money(12_850)} <span>of {money(45_000)}</span></p>
                </div>
                <MiniRing value={0.72} />
              </div>
              <ol className="s-card-dots" aria-hidden="true">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <li key={i} className={i < 6 ? 'is-on' : ''}>{d}</li>)}
              </ol>
            </TiltCard>
            <m.div className="w-float w-float-a" {...rise(1.1)}>
              <span aria-hidden="true">☕</span><strong>Coffee</strong><em>−$4.50</em>
            </m.div>
            <m.div className="w-float w-float-b" {...rise(1.25)}>
              <span aria-hidden="true">🔥</span><strong>13-day streak</strong>
            </m.div>
          </m.div>
        </div>

        <div className="w-tape" aria-hidden="true">
          <div className="w-tape-track">
            {[0, 1].map((n) => (
              <span key={n}>{TAPE.map((t) => <span key={t}>{t}<i>✺</i></span>)}</span>
            ))}
          </div>
        </div>
      </section>

      {saved.length > 0 ? (
        <section className="w-section w-back" aria-labelledby="back">
          <p className="w-kicker">This device</p>
          <h2 id="back">Welcome back.</h2>
          <ul className="w-back-list">
            {saved.slice(0, 4).map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => onStart({ account: { id: w.id, owner: w.owner }, household: [] })}>
                  <Avatar owner={w.owner} />
                  <span>{displayName(w.owner)}</span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="w-section" id="how" aria-labelledby="how-title">
        <InView>
          <p className="w-kicker">How it works</p>
          <h2 id="how-title" className="w-h2">Less app. More awareness.</h2>
        </InView>
        <div className="w-bento">
          <InView as="article" className="w-tile" delay={0}>
            <span className="w-tile-n">01</span>
            <h3>Three numbers, once.</h3>
            <p>Cash, card balance, a weekly pace. Thirty seconds, no bank connection.</p>
            <div className="w-mini w-mini-setup" aria-hidden="true">
              <span><small>Cash</small>$3,200</span>
              <span><small>Cards</small>$450</span>
              <span className="is-pace"><small>Pace</small>$450/wk</span>
            </div>
          </InView>
          <InView as="article" className="w-tile" delay={0.08}>
            <span className="w-tile-n">02</span>
            <h3>Two taps to log.</h3>
            <p>Amount, category, done. Pip hops when you keep the streak alive.</p>
            <div className="w-mini w-mini-log" aria-hidden="true">
              <strong>$4.50</strong>
              <span className="chips-row"><i className="is-on">☕ Dining</i><i>🛒 Groceries</i><i>🚌 Transit</i></span>
            </div>
          </InView>
          <InView as="article" className="w-tile" delay={0.16}>
            <span className="w-tile-n">03</span>
            <h3>Patterns, not guesswork.</h3>
            <p>Eight weeks of your own logs as a heatmap. Spot the Friday problem.</p>
            <div className="w-mini w-mini-heat" aria-hidden="true">
              {HEAT.map((h, i) => <i key={i} className={`h${h}`} />)}
            </div>
          </InView>
          <InView as="article" className="w-tile w-tile-wide w-tile-dark" delay={0.24}>
            <span className="w-tile-n">04</span>
            <h3>Ask in plain English.</h3>
            <p>Read-only answers grounded in your records. It can look, it can’t move money.</p>
            <div className="w-ask" aria-hidden="true">
              <div className="w-ask-q"><Icon name="sparkle" size={15} />Can I afford a $60 night out this week?</div>
              <div className="w-ask-a">
                Yes. You have <b>$128.50</b> left of your weekly pace and you usually spend <b>$22</b> on Saturdays.
                <span className="w-cite">1</span><span className="w-cite">2</span>
              </div>
            </div>
          </InView>
        </div>
      </section>

      <section className="w-section w-own" id="own-wallet" aria-labelledby="own-title">
        <InView className="w-own-card">
          <div className="w-own-copy">
            <p className="w-kicker">Your own wallet</p>
            <h2 id="own-title" className="w-h2">Start clean.<br />Keep it yours.</h2>
            <p>Your logs live on your wallet id. The demo household never touches them. You start with a $500 simulated deposit so it’s never empty.</p>
          </div>
          <form className="w-own-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <label htmlFor="wallet-name">First name</label>
            <div className="w-own-row">
              <input id="wallet-name" maxLength={40} placeholder="e.g. Sam" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="w-btn w-btn-volt" type="submit" disabled={!name.trim() || busy !== null}>
                {busy === 'create' ? 'Creating…' : 'Create wallet'}
              </button>
            </div>
            <p className="w-fine">
              {live
                ? 'Persists in PostgreSQL. No password yet: this is a demo identity, not a bank login.'
                : 'Practice mode: this wallet lives in memory and resets when the server restarts.'}
            </p>
          </form>
        </InView>
      </section>
    </div>
  );
}

function MiniRing({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg className="s-ring" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} className="s-ring-track" />
      <m.circle
        cx="28" cy="28" r={r} className="s-ring-value"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.min(1, value)) }}
        transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.6 }}
      />
      <text x="28" y="32" textAnchor="middle">{Math.round(value * 100)}%</text>
    </svg>
  );
}
