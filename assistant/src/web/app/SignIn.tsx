import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api, isApiError, isMfaChallenge, type BootstrapResponse } from '../api.js';
import { BrandMark } from './BrandMark.js';
import { GoogleButton } from './GoogleButton.js';
import {
  credentialToJson,
  isPasskeyCancelled,
  passkeySupport,
  requestOptionsFromJson,
} from './passkeys.js';
import { navigate } from './router.js';
import type { Session } from './session.js';
import { useToast } from './ui.js';
import './styles/signin.css';

type SignInMode = 'signin' | 'create';

/** OAuth callbacks return to the landing page with a code, which seeds the first error shown. */
function initialError(): string | null {
  const code = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('authError');
  if (code === 'link-required') return 'Sign in with your existing password first, then connect Google from your account.';
  if (code === 'google') return 'Google sign-in could not finish. Please try again.';
  return null;
}

/** A Google sign-in for an MFA account lands back here with a challenge to finish. */
function initialChallenge(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('mfa');
}

/** A plain left click navigates in place; every modified click keeps the browser default. */
function handleLink(route: 'signin' | 'signup') {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ kind: route });
  };
}

export function SignIn({
  mode,
  boot,
  bootError,
  onStart,
}: {
  mode: SignInMode;
  boot: BootstrapResponse | null;
  bootError: string | null;
  onStart: (session: Session) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [forgot, setForgot] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(initialChallenge);
  const [mfaCode, setMfaCode] = useState('');
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const toast = useToast();
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const hadChallenge = useRef(false);
  const persistent = boot?.identity?.persistent === true;
  const accountAvailable = mode === 'create'
    ? boot?.identity?.signupAvailable !== false
    : boot?.identity?.signinAvailable !== false;
  const resetAvailable = boot?.identity?.passwordResetAvailable !== false;

  // The challenge is read once, then dropped so a reload starts at step one.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('mfa')) return;
    params.delete('mfa');
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }, []);

  // PublicKeyCredential is a browser capability; keep SSR markup deterministic.
  useEffect(() => { setPasskeyAvailable(passkeySupport()); }, []);

  // Each new step starts at its first field; leaving the MFA step returns to email.
  useEffect(() => {
    if (challenge) {
      hadChallenge.current = true;
      codeRef.current?.focus();
    } else if (hadChallenge.current) {
      hadChallenge.current = false;
      emailRef.current?.focus();
    }
  }, [challenge]);

  async function submitForgot() {
    if (busy || !resetAvailable) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestPasswordReset(trimmedEmail);
      setResetSent(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'create'
        ? await api.register({ email: trimmedEmail, password, displayName: trimmedName })
        : await api.login({ email: trimmedEmail, password });
      if (isMfaChallenge(result)) {
        setChallenge(result.challenge);
        setMfaCode('');
        setError(null);
        return;
      }
      onStart({ account: result.account, household: [], demo: false, user: result.user });
      toast(
        mode === 'create'
          ? `Account created. Signed in as ${result.user.displayName}.`
          : `Signed in as ${result.user.displayName}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa() {
    if (!challenge || busy) return;
    const value = mfaCode.trim();
    if (!value) {
      setError('Enter the code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.mfaVerify(challenge, value);
      const session = await api.authSession();
      if (!session.user || !session.account) throw new Error('Signed in, but the account did not load. Refresh the page.');
      onStart({ account: session.account, household: [], demo: false, user: session.user });
      toast(`Signed in as ${session.user.displayName}.`);
    } catch (e) {
      if (isApiError(e) && e.code === 'challenge_expired') {
        setChallenge(null);
        setMfaCode('');
        setError('That sign-in timed out. Enter your email and password again.');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitPasskey() {
    if (!boot || busy || !accountAvailable || !passkeySupport()) return;
    setBusy(true);
    setError(null);
    try {
      const options = await api.passkeyLoginOptions();
      const credential = await navigator.credentials.get({
        publicKey: requestOptionsFromJson(options),
      }) as PublicKeyCredential | null;
      if (!credential) return;
      const result = await api.passkeyLogin(credentialToJson(credential));
      if (isMfaChallenge(result)) {
        setChallenge(result.challenge);
        setMfaCode('');
        return;
      }
      onStart({ account: result.account, household: [], demo: false, user: result.user });
      toast(`Signed in as ${result.user.displayName}.`);
    } catch (e) {
      if (isPasskeyCancelled(e)) return;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-top">
        <a className="signin-home" href="/">
          <BrandMark size={24} />
          <span>Settle</span>
        </a>
      </div>

      <div className="signin-grid">
        <div className="signin-main">
          <h1>{mode === 'create' ? 'Create your account' : 'Sign in to Settle'}</h1>
          <p className="signin-lede">
            {mode === 'create'
              ? 'One email, one wallet, kept apart from the sample household.'
              : 'Sign in to see your wallet and your logged entries.'}
          </p>

          <form className="signin-form" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void (challenge ? submitMfa() : submitAccount()); }}>
            {challenge ? (
              <>
                <p className="signin-note">Enter the 6-digit code from your authenticator app.</p>
                <div className="signin-field">
                  <label className="signin-label" htmlFor="mfa-code">Code</label>
                  <input
                    id="mfa-code"
                    ref={codeRef}
                    required
                    disabled={busy}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={20}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                </div>
                <p className="signin-note">Use a recovery code if you cannot open the app. It looks like xxxx-xxxx.</p>
                <button className="signin-submit" type="submit" disabled={busy}>
                  {busy ? 'Checking…' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="signin-text"
                  onClick={() => { setChallenge(null); setMfaCode(''); setError(null); }}
                >
                  Back to sign in
                </button>
              </>
            ) : forgot ? (
              <>
                <p className="signin-note">Enter the email on your account and we will send a link to choose a new password.</p>
                <div className="signin-field">
                  <label className="signin-label" htmlFor="account-email">Email</label>
                  <input
                    id="account-email"
                    required
                    disabled={busy}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {resetSent ? <p className="signin-note" role="status">{resetSent}</p> : null}
                <button className="signin-submit" type="submit" disabled={busy || !resetAvailable}>
                  {busy ? 'Sending…' : resetSent ? 'Send again' : 'Send reset link'}
                </button>
                <button
                  type="button"
                  className="signin-ghost"
                  onClick={() => { setForgot(false); setResetSent(null); setError(null); }}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                {boot?.identity?.googleAvailable ? (
                  <>
                    <GoogleButton href="/google-signin" disabled={busy} />
                    <div className="auth-divider"><span>or continue with email</span></div>
                  </>
                ) : null}
                {mode === 'create' ? (
                  <div className="signin-field">
                    <label className="signin-label" htmlFor="account-name">Name</label>
                    <input
                      id="account-name"
                      required
                      disabled={busy}
                      maxLength={40}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                ) : null}
                <div className="signin-field">
                  <label className="signin-label" htmlFor="account-email">Email</label>
                  <input
                    id="account-email"
                    ref={emailRef}
                    required
                    disabled={busy}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="signin-field">
                  <label className="signin-label" htmlFor="account-password">
                    {mode === 'create' ? 'Password, 8+ characters' : 'Password'}
                  </label>
                  <div className="signin-secret">
                    <input
                      id="account-password"
                      required
                      maxLength={72}
                      disabled={busy}
                      type={showPassword ? 'text' : 'password'}
                      data-secret="true"
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="signin-reveal"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <button className="signin-submit" type="submit" disabled={!boot || busy || !accountAvailable}>
                  {busy ? 'One moment…' : mode === 'create' ? 'Create account' : 'Sign in'}
                </button>
                {mode === 'signin' && passkeyAvailable ? (
                  <button
                    type="button"
                    className="signin-text"
                    disabled={!boot || busy || !accountAvailable}
                    onClick={() => { void submitPasskey(); }}
                  >
                    Sign in with a passkey
                  </button>
                ) : null}
                {mode === 'signin' ? (
                  <button
                    type="button"
                    className="signin-text"
                    onClick={() => { setForgot(true); setResetSent(null); setError(null); }}
                  >
                    Forgot password?
                  </button>
                ) : null}
              </>
            )}

            {!accountAvailable || (forgot && !resetAvailable) ? (
              <p className="signin-note" aria-live="polite">
                {forgot && !resetAvailable
                  ? 'Password reset email is not connected on this deployment. No email was sent.'
                  : boot?.identity?.unavailableReason}
              </p>
            ) : null}
            {error && error !== boot?.identity?.unavailableReason ? <p className="signin-error" role="alert">{error}</p> : null}
            {bootError ? <p className="signin-error" role="alert">{bootError}</p> : null}
            {boot && accountAvailable && !forgot ? (
              <p className="signin-note" aria-live="polite">
                {persistent
                  ? mode === 'create'
                    ? 'Your account will be saved. Use this email to sign in next time.'
                    : 'Sign in to return to your saved records.'
                  : 'On this server the account lasts until the process restarts. A connected database keeps it.'}
              </p>
            ) : null}
          </form>

          <p className="signin-switch">
            {mode === 'create' ? (
              <>Have an account? <a href="/signin" onClick={handleLink('signin')}>Sign in</a></>
            ) : (
              <>No account? <a href="/signup" onClick={handleLink('signup')}>Create one</a></>
            )}
          </p>
        </div>

        <aside className="signin-aside glass" aria-labelledby="signin-aside-title">
          <BrandMark size={40} className="signin-aside-mark" />
          <p className="signin-aside-label" id="signin-aside-title">How your data is handled</p>
          <ul className="signin-aside-list">
            <li>Passwords are stored only as salted scrypt hashes.</li>
            <li>Settle never asks for your bank password.</li>
            <li>You can download your statement at any time.</li>
            <li>Two-factor sign-in with an authenticator app.</li>
            <li>Delete your account and data.</li>
            <li>Sign in with a passkey.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
