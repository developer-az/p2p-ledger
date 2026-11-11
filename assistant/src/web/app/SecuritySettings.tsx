import { useEffect, useRef, useState } from 'react';
import {
  api,
  isApiError,
  type AuditEventRow,
  type AuthSessionRow,
  type MfaStatus,
} from '../api.js';
import { relativeTime } from './format.js';

/** Plain words for each security event type the server records. */
const AUDIT_LABELS: Record<string, string> = {
  login: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  logout: 'Signed out',
  mfa_challenge: 'Two-factor challenge sent',
  mfa_enabled: 'Two-factor turned on',
  mfa_disabled: 'Two-factor turned off',
  recovery_code_used: 'Recovery code used',
  step_up: 'Confirmed with a second factor',
  session_revoked: 'Session signed out',
  password_changed: 'Password changed',
  password_reset_requested: 'Password reset requested',
  export: 'Data exported',
  account_deleted: 'Account deleted',
};

function auditLabel(type: string): string {
  return AUDIT_LABELS[type] ?? type.replace(/_/g, ' ');
}

/** A base32 secret is easier to type when it is split into groups of four. */
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** True when the server wants a fresh second factor before the action runs. */
export function needsStepUp(error: unknown): boolean {
  return isApiError(error) && error.code === 'step_up_required';
}

/** Settings → Security: set up or turn off TOTP sign-in. */
export function TwoFactorRow({ real }: { real: boolean }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<'idle' | 'setup' | 'codes' | 'disable'>('idle');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!real) return;
    let live = true;
    api.mfa()
      .then((next) => { if (live) setStatus(next); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [real, version]);

  useEffect(() => {
    if (mode === 'setup' || mode === 'disable') codeRef.current?.focus();
    if (mode === 'codes') savedRef.current?.focus();
  }, [mode]);

  function reset() {
    setMode('idle');
    setSetup(null);
    setRecoveryCodes([]);
    setCode('');
    setError('');
  }

  async function beginSetup() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await api.mfaSetup();
      setSetup(next);
      setCode('');
      setMode('setup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    const value = code.trim();
    if (!value) {
      setError('Enter the code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.mfaEnable(value);
      setRecoveryCodes(result.recoveryCodes);
      setCode('');
      setMode('codes');
      setMessage('');
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    const value = code.trim();
    if (!value) {
      setError('Enter the code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.mfaDisable(value);
      reset();
      setMessage('Two-factor sign-in is off.');
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function finishCodes() {
    reset();
    setMessage('Two-factor sign-in is on.');
    setVersion((v) => v + 1);
  }

  async function copy(value: string, what: string) {
    const copied = await copyText(value);
    if (copied) {
      setError('');
      setMessage(`${what} copied.`);
    } else {
      setMessage('');
      setError(`Could not copy. Select the ${what.toLowerCase()} and copy it by hand.`);
    }
  }

  function downloadCodes() {
    const body = `Settle recovery codes\n\n${recoveryCodes.join('\n')}\n\nEach code works once. Keep this file somewhere safe.\n`;
    saveBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), 'settle-recovery-codes.txt');
    setMessage('Recovery codes downloaded.');
  }

  const statusText = !real
    ? 'Off'
    : status === null
      ? 'Loading…'
      : status.enabled
        ? `On · ${status.recoveryCodesLeft} recovery ${status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left`
        : 'Off';

  return (
    <li className="set-row set-row-block">
      <div className="set-row-head">
        <span className="set-row-label">Two-factor sign-in</span>
        <span className="set-row-desc">A second step when signing in from a new device.</span>
        <span className="set-row-value" aria-live="polite">{statusText}</span>
      </div>

      {!real ? (
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" disabled>Set up</button>
        </div>
      ) : mode === 'idle' ? (
        <div className="row-wrap">
          {status?.enabled ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => { setMode('disable'); setCode(''); setError(''); setMessage(''); }}
            >
              Turn off
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void beginSetup()}>
              {busy ? 'Starting…' : 'Set up'}
            </button>
          )}
        </div>
      ) : null}

      {real && mode === 'setup' && setup ? (
        <div className="set-step">
          <p className="set-copy">Add this secret to your authenticator app, then enter the code it shows.</p>
          <div className="set-secret">
            <code className="set-mono">{groupSecret(setup.secret)}</code>
            <button type="button" className="btn btn-sm" onClick={() => void copy(setup.secret, 'Secret')}>
              Copy
            </button>
          </div>
          <a className="set-link" href={setup.otpauthUri}>Open in authenticator app</a>
          <form
            className="set-inline-form"
            onSubmit={(e) => { e.preventDefault(); void confirmEnable(); }}
          >
            <label htmlFor="mfa-confirm-code">Code from the app</label>
            <input
              id="mfa-confirm-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={20}
              disabled={busy}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="row-wrap">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !code.trim()}>
                {busy ? 'Checking…' : 'Turn on'}
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={reset}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}

      {real && mode === 'codes' ? (
        <div className="set-step">
          <p className="set-copy">
            Save these recovery codes somewhere safe. Each works once, and they will not be shown again.
          </p>
          <ol className="set-codes" aria-label="Recovery codes">
            {recoveryCodes.map((value) => <li key={value} className="set-mono">{value}</li>)}
          </ol>
          <div className="row-wrap">
            <button type="button" className="btn btn-sm" onClick={() => void copy(recoveryCodes.join('\n'), 'Recovery codes')}>
              Copy
            </button>
            <button type="button" className="btn btn-sm" onClick={downloadCodes}>Download .txt</button>
            <button ref={savedRef} type="button" className="btn btn-primary btn-sm" onClick={finishCodes}>
              I've saved these
            </button>
          </div>
        </div>
      ) : null}

      {real && mode === 'disable' ? (
        <form
          className="set-step"
          onSubmit={(e) => { e.preventDefault(); void confirmDisable(); }}
        >
          <p className="set-copy">Enter a current code from your authenticator app to turn off two-factor sign-in.</p>
          <div className="set-inline-form">
            <label htmlFor="mfa-disable-code">Code from the app</label>
            <input
              id="mfa-disable-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={20}
              disabled={busy}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="row-wrap">
            <button type="submit" className="btn btn-sm" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Turn off'}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={reset}>Cancel</button>
          </div>
        </form>
      ) : null}

      {message ? <p className="set-copy" role="status">{message}</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </li>
  );
}

/** Settings → Security: every browser signed in to this account. */
export function SessionsRow({ real }: { real: boolean }) {
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!real) return;
    let live = true;
    api.sessions()
      .then((result) => { if (live) setSessions(result.sessions); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [real, version]);

  async function revoke(id: string) {
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      await api.revokeSession(id);
      setMessage('That session is signed out.');
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <li className="set-row set-row-block">
      <div className="set-row-head">
        <span className="set-row-label">Active sessions</span>
        <span className="set-row-desc">See every browser signed in to this account and end one.</span>
      </div>

      {!real ? (
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" disabled>Sign out</button>
        </div>
      ) : sessions === null ? (
        <p className="set-copy muted">{error ? 'Could not load sessions.' : 'Loading sessions…'}</p>
      ) : sessions.length === 0 ? (
        <p className="set-copy muted">No sessions.</p>
      ) : (
        <ul className="set-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div className="set-session-main">
                <span className="set-session-device">
                  {session.device ?? 'Unknown device'}
                  {session.current ? <span className="set-badge">This device</span> : null}
                </span>
                <span className="set-session-meta">
                  {session.ipPrefix ?? 'IP hidden'} · Last seen {relativeTime(session.lastSeenAt)}
                </span>
              </div>
              {session.current ? null : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busyId !== null}
                  onClick={() => void revoke(session.id)}
                >
                  {busyId === session.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {message ? <p className="set-copy" role="status">{message}</p> : null}
      {error && sessions !== null ? <p className="error-text" role="alert">{error}</p> : null}
    </li>
  );
}

/** Settings → Security: the latest security events on this account. */
export function AuditRow({ real }: { real: boolean }) {
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!real) return;
    let live = true;
    api.audit()
      .then((result) => { if (live) setEvents(result.events.slice(0, 20)); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [real]);

  return (
    <li className="set-row set-row-block">
      <div className="set-row-head">
        <span className="set-row-label">Audit log</span>
        <span className="set-row-desc">A record of sign-ins, password changes and account edits.</span>
      </div>

      {!real ? (
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" disabled>Refresh</button>
        </div>
      ) : events === null ? (
        <p className="set-copy muted">{error ? 'Could not load the audit log.' : 'Loading events…'}</p>
      ) : events.length === 0 ? (
        <p className="set-copy muted">No events yet.</p>
      ) : (
        <ul className="set-list">
          {events.map((event) => (
            <li key={event.id}>
              <div className="set-session-main">
                <span className="set-session-device">{auditLabel(event.type)}</span>
                <span className="set-session-meta">
                  {relativeTime(event.at)}
                  {event.device ? ` · ${event.device}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && events !== null ? <p className="error-text" role="alert">{error}</p> : null}
    </li>
  );
}

/** Settings → Data & privacy: export and account deletion, both behind step-up. */
export function DataPrivacyPanel({ real, onSignOut }: { real: boolean; onSignOut: () => void }) {
  const [mfaOn, setMfaOn] = useState(false);
  const [busy, setBusy] = useState<'json' | 'csv' | 'delete' | null>(null);
  const [stepUpFor, setStepUpFor] = useState<'json' | 'csv' | 'delete' | null>(null);
  const [credential, setCredential] = useState('');
  const [stepUpError, setStepUpError] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const credentialRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!real) return;
    let live = true;
    api.mfa()
      .then((status) => { if (live) setMfaOn(status.enabled); })
      .catch(() => { if (live) setMfaOn(false); });
    return () => { live = false; };
  }, [real]);

  useEffect(() => {
    if (stepUpFor) credentialRef.current?.focus();
  }, [stepUpFor]);

  async function runExport(format: 'json' | 'csv') {
    setBusy(format);
    setError('');
    setMessage('');
    try {
      const file = await api.exportAccount(format);
      saveBlob(file.blob, file.filename);
      setStepUpFor(null);
      setMessage(`Export downloaded as ${file.filename}.`);
    } catch (e) {
      if (needsStepUp(e)) {
        setStepUpFor(format);
        setCredential('');
        setStepUpError('');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runDelete() {
    if (confirmText !== 'DELETE') {
      setError('Type DELETE to confirm.');
      setMessage('');
      confirmRef.current?.focus();
      return;
    }
    setBusy('delete');
    setError('');
    setMessage('');
    try {
      await api.deleteAccount();
      setMessage('Account deleted.');
      onSignOut();
    } catch (e) {
      if (needsStepUp(e)) {
        setStepUpFor('delete');
        setCredential('');
        setStepUpError('');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitStepUp() {
    const pending = stepUpFor;
    if (!pending) return;
    const value = credential.trim();
    if (!value) {
      setStepUpError(mfaOn ? 'Enter the code from your authenticator app.' : 'Enter your password.');
      return;
    }
    setStepUpBusy(true);
    setStepUpError('');
    try {
      await api.stepUp(mfaOn ? { code: value } : { password: value });
      setCredential('');
      setStepUpFor(null);
      if (pending === 'delete') await runDelete();
      else await runExport(pending);
    } catch (e) {
      setStepUpError((e as Error).message);
    } finally {
      setStepUpBusy(false);
    }
  }

  return (
    <div className="set-features">
      <div className="set-feature">
        <div className="set-row-head">
          <span className="set-row-label">Export all data</span>
          <span className="set-row-desc">Take every entry, profile field and log in one file.</span>
        </div>
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!real || busy !== null}
            onClick={() => void runExport('json')}
          >
            {busy === 'json' ? 'Exporting…' : 'Export JSON'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!real || busy !== null}
            onClick={() => void runExport('csv')}
          >
            {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      <div className="set-feature">
        <div className="set-row-head">
          <span className="set-row-label">Delete account and data</span>
          <span className="set-row-desc">Remove the account and its profile for good.</span>
        </div>
        <p className="set-copy">
          This removes your sign-in, profile, logs and history in Settle. The ledger's append-only
          financial entries are kept.
        </p>
        <div className="set-inline-form">
          <label htmlFor="delete-confirm">Type DELETE to confirm</label>
          <input
            id="delete-confirm"
            ref={confirmRef}
            autoComplete="off"
            spellCheck={false}
            disabled={!real || busy !== null}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </div>
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={!real || busy !== null || confirmText !== 'DELETE'}
            onClick={() => void runDelete()}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>

      {stepUpFor ? (
        <form
          className="set-stepup"
          onSubmit={(e) => { e.preventDefault(); void submitStepUp(); }}
        >
          <p className="set-copy">
            {mfaOn
              ? 'Enter the code from your authenticator app to continue.'
              : 'Enter your password to continue.'}
          </p>
          <label htmlFor="step-up-credential">{mfaOn ? 'Authenticator code' : 'Password'}</label>
          <input
            id="step-up-credential"
            ref={credentialRef}
            type={mfaOn ? 'text' : 'password'}
            inputMode={mfaOn ? 'numeric' : undefined}
            autoComplete={mfaOn ? 'one-time-code' : 'current-password'}
            maxLength={mfaOn ? 20 : 72}
            disabled={stepUpBusy}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
          />
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary btn-sm" disabled={stepUpBusy || !credential.trim()}>
              {stepUpBusy ? 'Checking…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={stepUpBusy}
              onClick={() => { setStepUpFor(null); setCredential(''); setStepUpError(''); }}
            >
              Cancel
            </button>
          </div>
          {stepUpError ? <p className="error-text" role="alert">{stepUpError}</p> : null}
        </form>
      ) : null}

      {message ? <p className="set-copy" role="status">{message}</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}
