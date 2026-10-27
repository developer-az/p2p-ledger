import { useRef, useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { money } from './format.js';
import type { Session } from './session.js';
import { CountUp, EASE_OUT, InView, RevealWords, TiltCard } from './motion-kit.js';
import { Pip } from './Pip.js';
import { Icon, useToast } from './ui.js';

type AuthMode = 'signin' | 'create';

const TAPE = ['Two taps to log', 'Sign in and it stays', 'Patterns from your own history', 'Ask in plain English', 'Real double-entry ledger', 'Pip is watching'];

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
  const [mode, setMode] = useState<AuthMode>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'demo' | 'auth' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const accountRef = useRef<HTMLElement>(null);
  const toast = useToast();
  const reduce = useReducedMotion();
  const live = boot?.live ?? false;
  const persistent = boot?.identity?.persistent === true;

  function focusAuth(next: AuthMode) {
    setMode(next);
    setError(null);
    accountRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  async function tryDemo() {
    if (!boot) return;
    setBusy('demo');
    setDemoError(null);
    try {
      // The sample household is always the practice household, even when the
      // live ledger is up. Seeding it through POST /api/demo used to create
      // real accounts in PostgreSQL, and since wallet routes started requiring
      // the owning sign-in session (commit 9709d6e), those unsigned demo
      // accounts were then rejected with 401 on every wallet read — the demo
      // opened, then immediately failed to load. Practice accounts are
      // explicitly exempt from that check, and they never touch the real
      // ledger. POST /api/demo stays for the /ops console only.
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
    } catch (e) {
      setDemoError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submitAccount() {
    if (!boot || busy) return;
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (mode === 'create' && !trimmedName) {
      setError('Enter the name you want on the account.');
      return;
    }
    if (!trimmedEmail.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setBusy('auth');
    setError(null);
    try {
      const result = mode === 'create'
        ? await api.register({ email: trimmedEmail, password, displayName: trimmedName })
        : await api.login({ email: trimmedEmail, password });
      onStart({ account: result.account, household: [], demo: false, user: result.user });
      toast(
        mode === 'create'
          ? (result.funded
            ? 'Your account is ready, with a $500 opening balance.'
            : 'Your account is ready. Add money whenever you like.')
          : `Welcome back, ${result.user.displayName}.`,
        { tone: 'good' },
      );
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
            <button type="button" onClick={() => focusAuth('signin')}>Sign in</button>
          </span>
          <button type="button" className="w-nav-cta w-nav-cta-volt" onClick={() => focusAuth('create')} disabled={!boot || busy !== null}>
            Create account
          </button>
        </nav>

        <div className="w-hero-body">
          <div className="w-copy">
            <m.p className="w-status" {...rise(0.05)}>
              <span className={`w-status-dot${live ? ' is-live' : ''}`} aria-hidden="true" />
              {boot ? (live ? 'Ledger online' : 'Ready') : 'Connecting…'}
              <span className="w-status-extra"><span className="w-status-sep">/</span> your own account</span>
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
              <button type="button" className="w-btn w-btn-volt" onClick={() => focusAuth('create')} disabled={!boot || busy !== null}>
                Create account
                <span className="w-btn-arrow" aria-hidden="true">→</span>
              </button>
              <button type="button" className="w-btn w-btn-ghost" onClick={() => focusAuth('signin')}>Sign in</button>
            </m.div>
            <m.p className="w-fine" {...rise(0.72)}>
              <button type="button" className="w-text-btn" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>
                {busy === 'demo' ? 'Opening the sample…' : 'Preview a sample household'}
              </button>
            </m.p>
            {demoError ? <p className="w-error" role="alert">{demoError}</p> : null}
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

      <section className="w-section w-own" id="own-wallet" ref={accountRef} aria-labelledby="own-title">
        <InView className="w-own-card">
          <div className="w-own-copy">
            <p className="w-kicker">Your account</p>
            <h2 id="own-title" className="w-h2">{mode === 'create' ? <>Start clean.<br />Keep it yours.</> : <>Welcome back.<br />Pick up where you left off.</>}</h2>
            <p>One email, one wallet. The sample household never mixes with yours. You start with a $500 opening balance so it isn’t empty.</p>
          </div>
          <form className="w-own-form" onSubmit={(e) => { e.preventDefault(); void submitAccount(); }}>
            <div className="w-auth-switch" role="tablist" aria-label="Account">
              <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => { setMode('signin'); setError(null); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => { setMode('create'); setError(null); }}>Create account</button>
            </div>
            {mode === 'create' ? (
              <label className="w-field" htmlFor="account-name">Name
                <input id="account-name" maxLength={40} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            ) : null}
            <label className="w-field" htmlFor="account-email">Email
              <input id="account-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="w-field" htmlFor="account-password">Password
              <input
                id="account-password"
                type="password"
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="w-btn w-btn-ink" type="submit" disabled={!boot || busy !== null}>
              {busy === 'auth' ? 'Working…' : mode === 'create' ? 'Create account' : 'Sign in'}
            </button>
            {error ? <p className="w-error" role="alert">{error}</p> : null}
            <p className="w-fine">
              {persistent
                ? 'Saved with the ledger. Sign in with this email next time.'
                : 'On this server the account lasts until the process restarts. A connected database keeps it.'}
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
