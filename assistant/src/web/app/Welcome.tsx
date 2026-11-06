import { useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { api, type AccountRef, type BootstrapResponse } from '../api.js';
import type { Session } from './session.js';
import { Pip } from './Pip.js';
import { useToast } from './ui.js';

type AuthMode = 'signin' | 'create';

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
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const accountRef = useRef<HTMLElement>(null);
  const toast = useToast();
  const reduce = useReducedMotion();

  function focusAuth(next: AuthMode) {
    setMode(next);
    setForgot(false);
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

  async function submitForgot() {
    if (busy) return;
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

  const accountAvailable = mode === 'create' ? boot?.identity?.signupAvailable !== false : boot?.identity?.signinAvailable !== false;
  const resetAvailable = boot?.identity?.passwordResetAvailable !== false;
  const available = forgot ? resetAvailable : accountAvailable;
  return (
    <div className="welcome workbench-welcome">
      <header className="entry-header"><a href="/" className="entry-brand"><Pip size={28} track={false} mood="calm" /> settle</a><span className="muted">A little clarity for your money.</span></header>
      <div className="entry-layout">
        <section className="entry-intro">
          <p className="eyebrow">Your everyday money desk</p>
          <h1>Less to manage.<br />More room to live.</h1>
          <p>Keep track of what you spend, see what is left, and make shared bills easier to follow.</p>
          <button type="button" className="btn btn-primary" onClick={() => void tryDemo()} disabled={!boot || busy !== null}>{busy === 'demo' ? 'Opening…' : 'Explore the sample'} <span aria-hidden="true">→</span></button>
          <p className="hint">No signup. Sample money. Try a log and undo it.</p>
          <ol className="entry-steps"><li><b>Pick</b> what you spent on.</li><li><b>Check</b> the amount.</li><li><b>Carry on.</b> Your week stays in view.</li></ol>
          {demoError || bootError ? <p className="error-text" role="alert">{demoError || bootError}</p> : null}
        </section>
        <section className="entry-account" ref={accountRef} aria-labelledby="account-title">
          <h2 id="account-title">{forgot ? 'Reset your password' : mode === 'create' ? 'Make it yours' : 'Welcome back'}</h2>
          {!forgot ? <div className="entry-tabs" role="group" aria-label="Account"><button type="button" aria-pressed={mode === 'create'} onClick={() => focusAuth('create')}>Create account</button><button type="button" aria-pressed={mode === 'signin'} onClick={() => focusAuth('signin')}>Sign in</button></div> : null}
          {!available ? <div className="entry-status" role="status"><strong>{forgot ? 'Email recovery is not connected' : 'Accounts are not ready here yet'}</strong><p>{forgot ? 'This deployment cannot send reset emails yet. No email has been sent.' : boot?.identity?.unavailableReason || 'The account service needs to be connected before you can sign in.'}</p><button type="button" className="link-btn" onClick={() => void tryDemo()}>Use the sample instead →</button></div> : null}
          <form className="stack" onSubmit={e => { e.preventDefault(); if (available) void submitAccount(); }}>
            {!forgot && mode === 'create' ? <div className="field"><label className="label" htmlFor="account-name">Name</label><input className="input" id="account-name" autoComplete="name" required value={name} disabled={!available || busy !== null} onChange={e => setName(e.target.value)} /></div> : null}
            <div className="field"><label className="label" htmlFor="account-email">Email</label><input className="input" id="account-email" type="email" autoComplete="email" required value={email} disabled={!available || busy !== null} onChange={e => setEmail(e.target.value)} /></div>
            {!forgot ? <div className="field"><label className="label" htmlFor="account-password">Password</label><input className="input" id="account-password" type="password" minLength={8} maxLength={72} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required value={password} disabled={!available || busy !== null} onChange={e => setPassword(e.target.value)} /></div> : null}
            {resetSent ? <p className="notice" role="status">{resetSent}</p> : null}
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <button className="btn btn-primary btn-block" type="submit" disabled={!boot || !available || busy !== null}>{busy === 'auth' ? 'Working…' : forgot ? 'Send reset link' : mode === 'create' ? 'Create account' : 'Sign in'}</button>
            <button type="button" className="link-btn" onClick={() => { setForgot(!forgot); setResetSent(null); setError(null); }}>{forgot ? 'Back to sign in' : 'Forgot password?'}</button>
          </form>
          <p className="hint entry-privacy">Your own records stay separate from the sample. Settle does not connect to your bank.</p>
        </section>
      </div>
    </div>
  );
}
