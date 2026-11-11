import { useState } from 'react';
import './app.css';

export function AccountAccess() {
  const [authError] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('authError'));
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="app"><main className="main" style={{ maxWidth: 640, padding: '48px 24px' }}>
    <a href="/">Back to Settle</a>
    <h1>Account access</h1>
    {authError === 'google-link' && <p role="alert">Google could not be connected to this account. Try Connect Google again.</p>}
    <p>Connect Google to your signed-in account, or disconnect it using your Settle password.</p>
    <p><a href="/api/auth/google/start?link=1">Connect Google</a></p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setMessage('');
      try {
        const response = await fetch('/api/auth/google/disconnect', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not disconnect Google.');
        localStorage.removeItem('settle:session');
        setPassword(''); setMessage('Google disconnected. You have been signed out on all devices. Sign in with your password.');
      } catch (error) { setMessage((error as Error).message); }
      finally { setBusy(false); }
    }}>
      <label className="w-field">Settle password<input type="password" autoComplete="current-password" required maxLength={72} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p>If you joined with Google, use Forgot password on the sign-in page to set a password first.</p>
      <button className="w-btn w-btn-ink" disabled={busy}>Disconnect Google and sign out</button>
      <p role="status">{message}</p>
    </form>
    <h2>Delete your account or request your data</h2>
    <p>Email <a href="mailto:Az040205@gmail.com?subject=Settle%20account%20request">Az040205@gmail.com</a> from your account email. We will verify ownership before processing your request. Do not send your password or financial documents.</p>
  </main></div>;
}
