import { useEffect, useRef, useState, type ReactNode } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import { money } from './format.js';
import type { Session } from './session.js';
import { CountUp, EASE_OUT, InView, RevealWords, TiltCard } from './motion-kit.js';
import { Mascot } from './Mascot.js';
import { GoogleButton } from './GoogleButton.js';
import { AuthSky, Cloud } from './AuthSky.js';
import { Icon, useToast } from './ui.js';

type AuthMode = 'signin' | 'create';

const TAPE = ['Two taps to log', 'Sign in and it stays', 'Patterns from your own history', 'Ask in plain English', 'Real double-entry ledger', 'Settle keeps watch'];

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
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('authError');
    return code === 'link-required' ? 'Sign in with your existing password first, then connect Google from your account.'
      : code === 'google' ? 'Google sign-in could not finish. Please try again.' : null;
  });
  const [forgot, setForgot] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const accountRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const howRef = useRef<HTMLElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const trustRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  const reduce = useReducedMotion();
  const live = boot?.live ?? false;
  const persistent = boot?.identity?.persistent === true;
  const accountAvailable = mode === 'create' ? boot?.identity?.signupAvailable !== false : boot?.identity?.signinAvailable !== false;
  const resetAvailable = boot?.identity?.passwordResetAvailable !== false;

  function focusAuth(next: AuthMode, focusField = false) {
    setMode(next);
    setError(null);
    accountRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    if (!focusField) return;
    // The field for the new mode may not be mounted yet; wait for the render.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const id = next === 'create' && !forgot ? 'account-name' : 'account-email';
        document.getElementById(id)?.focus({ preventScroll: true });
      });
    });
  }

  /**
   * Menu links close the panel, scroll to the section and put focus there.
   * Without this, focus stayed on the link inside the now-hidden panel.
   */
  function goToSection(id: 'how' | 'ask' | 'trust') {
    setMenuOpen(false);
    const target = { how: howRef, ask: askRef, trust: trustRef }[id].current;
    if (!target) return;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    window.history.replaceState(null, '', `#${id}`);
  }

  // The header starts as bare sky and turns to glass once the page moves.
  // rAF-throttled, passive, and it only writes when the boolean flips.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > 12);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Escape and outside clicks close the mobile menu. Pointer events, not
  // clicks, so the panel closes even when the press lands on a non-focusable
  // area of the page.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuBtnRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && headerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

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

  async function submitForgot() {
    if (busy || !resetAvailable) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    setBusy('auth');
    setError(null);
    try {
      const res = await api.requestPasswordReset(trimmedEmail);
      setResetSent(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submitAccount() {
    if (forgot) return submitForgot();
    if (!boot || busy || !accountAvailable) return;
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
          ? 'Your account is ready. Set your starting point with your own numbers.'
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
      {/* Sits above the hero rather than inside it, so it can stick: it rests
          as bare sky and turns to glass once the page scrolls. */}
      <header className={`w-header${scrolled ? ' is-scrolled' : ''}`} ref={headerRef}>
        <div className="w-header-inner">
          <a className="w-logo" href="/" aria-label="Settle home">
            <Mascot size={30} track={false} idle={false} mood="happy" />
            <span>settle</span>
          </a>
          <nav className="w-nav-links" aria-label="Settle">
            <a href="#how">How it works</a>
            <a href="#ask">Ask</a>
            <a href="#trust">Security</a>
          </nav>
          <div className="w-header-actions">
            <button type="button" className="w-nav-signin" onClick={() => focusAuth('signin')}>Sign in</button>
            <button type="button" className="w-nav-cta w-nav-cta-volt" onClick={() => focusAuth('create')} disabled={!boot || busy !== null}>
              Create account
            </button>
            <button
              ref={menuBtnRef}
              type="button"
              className={`w-menu-btn${menuOpen ? ' is-open' : ''}`}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="w-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="w-menu-icon" aria-hidden="true"><i /><i /><i /></span>            </button>
          </div>
        </div>
        <m.div
          id="w-mobile-menu"
          className="w-mobile-menu"
          hidden={!menuOpen}
          initial={false}
          animate={menuOpen ? { opacity: 1, y: 0 } : { opacity: 0, y: reduce ? 0 : 8 }}
          transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
        >
          <a
            href="#how"
            onClick={(e) => { e.preventDefault(); goToSection('how'); }}
          >How it works</a>
          <a
            href="#ask"
            onClick={(e) => { e.preventDefault(); goToSection('ask'); }}
          >Ask</a>
          <a
            href="#trust"
            onClick={(e) => { e.preventDefault(); goToSection('trust'); }}
          >Security</a>
          <button type="button" className="w-mobile-link" onClick={() => { setMenuOpen(false); focusAuth('signin', true); }}>Sign in</button>
          <button
            type="button"
            className="w-nav-cta w-nav-cta-volt"
            onClick={() => { setMenuOpen(false); focusAuth('create', true); }}
            disabled={!boot || busy !== null}
          >
            Create account
          </button>
        </m.div>
      </header>

      <section className="w-hero" aria-labelledby="w-title">
        {/* A daytime sky the page climbs out of: the sign-in scene at the
            bottom of the page is the same sky, above the clouds. */}
        <div className="sky-layer w-clouds" aria-hidden="true">
          <Cloud className="h1" tone="b" /><Cloud className="h2" /><Cloud className="h3" tone="b" /><Cloud className="h4" />
        </div>

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
              Log a spend in two taps. See your week in one glance. Settle, your pocket-sized money buddy, keeps the streak honest.
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
            <div className="w-mascot-perch"><Mascot size={96} mood="happy" greet /></div>
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

      <section className="w-section" id="how" ref={howRef} tabIndex={-1} aria-labelledby="how-title">
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
            <p>Amount, category, done. Settle hops when you keep the streak alive.</p>
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
          <div id="ask" className="w-tile-anchor" ref={askRef} tabIndex={-1}>
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
        </div>
      </section>

      <section className="w-section w-trust" id="trust" ref={trustRef} tabIndex={-1} aria-labelledby="trust-title">
        <InView>
          <p className="w-kicker">Security</p>
          <h2 id="trust-title" className="w-h2">Built like a ledger, not a toy.</h2>
        </InView>
        <div className="w-trust-grid">
          <InView as="article" className="w-trust-card" delay={0}>
            <span className="w-trust-icon" aria-hidden="true"><Icon name="lock" size={20} /></span>
            <h3>Read-only AI</h3>
            <p>Ask answers from tools scoped to your wallet. It can look, it cannot move money.</p>
          </InView>
          <InView as="article" className="w-trust-card" delay={0.08}>
            <span className="w-trust-icon" aria-hidden="true"><Icon name="wallet" size={20} /></span>
            <h3>Double-entry records</h3>
            <p>Every entry balances. Append-only, idempotent writes, with fraud rules on transfers.</p>
          </InView>
          <InView as="article" className="w-trust-card" delay={0.16}>
            <span className="w-trust-icon" aria-hidden="true"><Icon name="sparkle" size={20} /></span>
            <h3>Your account, your data</h3>
            <p>No bank login required. Export a statement any time; delete on request.</p>
          </InView>
        </div>
      </section>

      {/* #account is the footer's "Create account" landing point; #own-wallet
          stays where it was, because Google and reset links already use it. */}
      <span id="account" className="sky-anchor" aria-hidden="true" />
      <AuthSky id="own-wallet" ref={accountRef} labelledBy="own-title">
        <div className="sky-card-head">
          <p className="w-kicker">{mode === 'create' ? 'Your account' : 'Welcome back'}</p>
          <h2 id="own-title" className="sky-title">{forgot ? 'Let’s get you back in.' : mode === 'create' ? 'Make yourself at home.' : 'Good to see you again.'}</h2>
          <p className="sky-lede">{mode === 'create'
            ? 'One email, one wallet. You start empty, and the sample household never mixes with yours.'
            : 'Sign in and pick up right where you left off.'}</p>
        </div>
        <form className="sky-form" aria-busy={busy === 'auth'} onSubmit={(e) => { e.preventDefault(); void submitAccount(); }}>
          {!forgot ? (
            <div className={`sky-switch is-${mode}`} role="tablist" aria-label="Account">
              <span className="sky-switch-thumb" aria-hidden="true" />
              <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => { setMode('create'); setForgot(false); setError(null); }}>Create account</button>
              <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => { setMode('signin'); setForgot(false); setError(null); }}>Sign in</button>
            </div>
          ) : null}
          {forgot ? (
            <>
              <p className="w-fine w-forgot-intro">Enter the email on your account and we will send a link to choose a new password.</p>
              <SkyField id="account-email" label="Email" value={email}>
                <input id="account-email" required disabled={busy !== null} type="email" autoComplete="email" inputMode="email" placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)} />
              </SkyField>
              {resetSent ? <p className="w-ok" role="status">{resetSent}</p> : null}
              <button className="sky-go" type="submit" disabled={busy !== null || !resetAvailable}>
                {busy === 'auth' ? 'Sending…' : resetSent ? 'Send again' : 'Send reset link'}
              </button>
              <button type="button" className="w-link" onClick={() => { setForgot(false); setResetSent(null); setError(null); }}>Back to sign in</button>
            </>
          ) : (
            <>
              {boot?.identity?.googleAvailable ? <>
                <GoogleButton href="/google-signin" disabled={busy !== null} />
                <div className="auth-divider"><span>or continue with email</span></div>
              </> : null}
              {mode === 'create' ? (
                <SkyField id="account-name" label="What should we call you?" value={name}>
                  <input id="account-name" required disabled={busy !== null} maxLength={40} autoComplete="name" placeholder=" " value={name} onChange={(e) => setName(e.target.value)} />
                </SkyField>
              ) : null}
              <SkyField id="account-email" label="Email" value={email}>
                <input id="account-email" required disabled={busy !== null} type="email" autoComplete="email" inputMode="email" placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)} />
              </SkyField>
              <SkyField id="account-password" label={mode === 'create' ? 'Password, 8+ characters' : 'Password'} value={password}>
                <input
                  id="account-password"
                  required
                  maxLength={72}
                  disabled={busy !== null}
                  type={showPassword ? 'text' : 'password'}
                  data-secret="true"
                  autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                  minLength={8}
                  placeholder=" "
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="sky-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </SkyField>
              <button className="sky-go" type="submit" disabled={!boot || busy !== null || !accountAvailable}>
                <span>{busy === 'auth' ? 'One moment…' : mode === 'create' ? 'Create account' : 'Sign in'}</span>
                {busy === 'auth' ? null : <span className="sky-go-arrow" aria-hidden="true">→</span>}
              </button>
              {mode === 'signin' ? (
                <button type="button" className="w-link" onClick={() => { setForgot(true); setResetSent(null); setError(null); }}>Forgot password?</button>
              ) : null}
            </>
          )}
          {(!accountAvailable || (forgot && !resetAvailable)) ? <p className="w-fine" role="status">{forgot && !resetAvailable ? 'Password reset email is not connected on this deployment. No email was sent.' : boot?.identity?.unavailableReason}</p> : null}
          {error && error !== boot?.identity?.unavailableReason ? <p className="w-error" role="alert">{error}</p> : null}
          {boot && accountAvailable && !forgot ? <p className="w-fine">
            {persistent
              ? mode === 'create'
                ? 'Your account will be saved. Use this email to sign in next time.'
                : 'Sign in to return to your saved records.'
              : 'On this server the account lasts until the process restarts. A connected database keeps it.'}
          </p> : null}
        </form>
      </AuthSky>
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

/** A field whose label rests inside it and floats up once it has focus or a value. */
function SkyField({ id, label, value, children }: { id: string; label: string; value: string; children: ReactNode }) {
  return (
    <div className={`sky-field${value ? ' has-value' : ''}`}>
      {children}
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
