import { useEffect, useState } from 'react';
import { api } from '../api.js';
import './app.css';

/** Reads the one-time token from the link's fragment (never sent to the server in logs or Referer). */
function tokenFromLocation(): string {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return hash.get('token') ?? '';
}

export function ResetPassword() {
  const [token] = useState(tokenFromLocation);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Reset password · Settle';
    // Drop the token from the address bar and history as soon as it has been read.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit() {
    if (busy) return;
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.confirmPasswordReset(token, password);
      try { localStorage.removeItem('settle:session'); } catch { /* ignore */ }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app app-ready reset-page">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Settle home"><span className="brand-word">settle</span></a>
        </div>
      </header>
      <main id="main" className="main reset-main">
        <section className="card reset-card" aria-labelledby="reset-title">
          <h1 id="reset-title">{done ? 'Password updated' : 'Choose a new password'}</h1>
          {done ? (
            <>
              <p className="muted">You are signed in on this device. Other devices were signed out.</p>
              <a className="btn btn-primary" href="/">Go to my wallet</a>
            </>
          ) : !token ? (
            <>
              <p className="muted">This page needs the link from the reset email. Ask for a new link from the sign-in form.</p>
              <a className="btn" href="/#own-wallet">Back to sign in</a>
            </>
          ) : (
            <form className="reset-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <label className="field" htmlFor="new-password">New password
                <input id="new-password" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </label>
              <label className="field" htmlFor="confirm-password">Repeat it
                <input id="confirm-password" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
              {error ? <p className="reset-error" role="alert">{error}</p> : null}
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
              <a className="link-btn" href="/">Cancel</a>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
