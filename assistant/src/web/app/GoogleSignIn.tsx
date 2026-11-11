import { useState } from 'react';
import { GoogleButton } from './GoogleButton.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

export function GoogleSignIn() {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="app auth-page">
    <header className="auth-header"><a className="brand" href="/" aria-label="Settle home"><span className="brand-word">settle</span></a><a href="/signin">Use email instead</a></header>
    <main className="auth-main" id="main">
      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="auth-eyebrow">YOUR SETTLE ACCOUNT</span>
        <h1 id="auth-title">A clearer picture.<br />A place of your own.</h1>
        <p className="auth-intro">Sign in or create an account to keep your budget, spending and savings together.</p>
        <div className="auth-permissions"><span aria-hidden="true">↗</span><div><strong>You choose what to share.</strong><p>Google shares your name, email and account ID. Settle doesn’t request access to your Gmail, Drive or contacts.</p></div></div>
        <label className="auth-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>I’m 18 or older and live in the United States. I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and have read the <a href="/privacy" target="_blank" rel="noopener">Privacy notice</a>.</span></label>
        <GoogleButton disabled={!accepted} busy={busy} onClick={() => { setBusy(true); window.location.assign('/api/auth/google/start?accepted=1'); }} />
        <p className="auth-footnote">You’ll continue securely on Google to choose your account.</p>
      </section>
      <p className="auth-help">Need a hand? <a href="mailto:Az040205@gmail.com">Contact support</a></p>
    </main>
    <footer className="auth-footer"><span>Settle · A little clarity, every day.</span><nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>
  </div>;
}
