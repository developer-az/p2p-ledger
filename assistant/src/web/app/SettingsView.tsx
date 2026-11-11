import { lazy, Suspense, useState } from 'react';
import './styles/settings.css';
import { api, type AccountRef } from '../api.js';
import { settingsTabLabel } from './AppShell.js';
import type { WalletData } from './data.js';
import { densityLabel, type DensityPref } from './density.js';
import { money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { navigate, routeHref, SETTINGS_TABS, type SettingsTab } from './router.js';
import type { ThemePref } from './theme.js';
import { TrustTab } from './TrustTab.js';
import { Skeleton } from './ui.js';

/**
 * The security panels pull in passkeys, TOTP, session and audit code that most
 * settings visits never open. They load as one chunk when the security or
 * privacy tab renders.
 */
const TwoFactorRow = lazy(() => import('./SecuritySettings.js').then((mod) => ({ default: mod.TwoFactorRow })));
const PasskeysRow = lazy(() => import('./SecuritySettings.js').then((mod) => ({ default: mod.PasskeysRow })));
const SessionsRow = lazy(() => import('./SecuritySettings.js').then((mod) => ({ default: mod.SessionsRow })));
const AuditRow = lazy(() => import('./SecuritySettings.js').then((mod) => ({ default: mod.AuditRow })));
const DataPrivacyPanel = lazy(() => import('./SecuritySettings.js').then((mod) => ({ default: mod.DataPrivacyPanel })));

function SecurityFallback() {
  return (
    <div className="set-rows" role="status" aria-live="polite">
      <p className="set-copy muted">Loading security settings…</p>
      <Skeleton height={44} />
      <Skeleton height={44} />
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const DENSITY_OPTIONS: { value: DensityPref; label: string }[] = [
  { value: 'comfortable', label: densityLabel('comfortable') },
  { value: 'compact', label: densityLabel('compact') },
];

export interface SettingsViewProps {
  tab: SettingsTab;
  name: string;
  email?: string;
  demo: boolean;
  me: AccountRef;
  data: WalletData | null;
  statementHref: string;
  theme: ThemePref;
  density: DensityPref;
  onTheme: (pref: ThemePref) => void;
  onDensity: (pref: DensityPref) => void;
  onSignOut: () => void;
  onEditBalances: () => void;
  onReload: () => Promise<void>;
}

/** `/app/settings/<tab>`: one tab list, one panel stack per tab. */
export function SettingsView({
  tab,
  name,
  email,
  demo,
  me,
  data,
  statementHref,
  theme,
  density,
  onTheme,
  onDensity,
  onSignOut,
  onEditBalances,
  onReload,
}: SettingsViewProps) {
  const real = !demo;
  return (
    <div className="v-view">
      <header className="v-head">
        <h1 className="v-title">Settings</h1>
      </header>

      <div className="set-layout">
        <nav className="set-tabs" aria-label="Settings">
          <div className="set-tab-list">
            {SETTINGS_TABS.map((entry) => (
              <a
                key={entry}
                className="set-tab"
                href={routeHref({ kind: 'app', section: 'settings', tab: entry })}
                aria-current={entry === tab ? 'page' : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  navigate({ kind: 'app', section: 'settings', tab: entry });
                }}
              >
                {settingsTabLabel(entry)}
              </a>
            ))}
          </div>
        </nav>

        <div className="set-content">
          {tab === 'profile' ? (
            <>
              <section className="v-panel set-panel glass" aria-labelledby="set-profile">
                <h2 id="set-profile">Profile</h2>
                <dl className="set-facts">
                  <div><dt>Name</dt><dd>{name}</dd></div>
                  <div>
                    <dt>Email</dt>
                    <dd>{demo ? <span className="muted">Sample household</span> : email ?? <span className="muted">Not set</span>}</dd>
                  </div>
                  <div><dt>Account id</dt><dd className="set-mono">{me.id}</dd></div>
                </dl>
              </section>

              <section className="v-panel set-panel glass" aria-labelledby="set-profile-edit">
                <h2 id="set-profile-edit">Your details</h2>
                <ul className="set-rows">
                  <PlannedRow label="Edit profile" description="Change the name and email on this account." milestone="M3" />
                </ul>
              </section>
            </>
          ) : null}

          {tab === 'security' ? (
            <>
              <section className="v-panel set-panel glass" aria-labelledby="set-session">
                <h2 id="set-session">Current session</h2>
                <p className="set-copy">
                  {demo ? 'Exploring the sample household.' : email ? `Signed in as ${email}` : 'Signed in on this browser.'}
                </p>
                <div className="row-wrap">
                  <button type="button" className="btn btn-sm" onClick={onSignOut}>
                    {demo ? 'Exit sample' : 'Sign out'}
                  </button>
                </div>
              </section>

              <section className="v-panel set-panel glass" aria-labelledby="set-signin">
                <h2 id="set-signin">Sign-in protection</h2>
                {!real ? <p className="set-copy muted">Sign in to a real account to use this.</p> : null}
                <Suspense fallback={<SecurityFallback />}>
                  <ul className="set-rows">
                    <TwoFactorRow real={real} />
                    <PasskeysRow real={real} />
                    <SessionsRow real={real} />
                    <AuditRow real={real} />
                  </ul>
                </Suspense>
                {demo ? (
                  <p className="set-copy muted">Google sign-in connects to an account, so it starts after you create one.</p>
                ) : (
                  <p className="set-copy">
                    <a className="set-link" href="/account-access">Connect or disconnect Google</a>
                  </p>
                )}
              </section>
            </>
          ) : null}

          {tab === 'privacy' ? (
            <>
              <section className="v-panel set-panel glass" aria-labelledby="set-data">
                <h2 id="set-data">Your data</h2>
                <p className="set-copy">Every ledger entry on this account, in a text file you can keep.</p>
                <div className="row-wrap">
                  <a className="btn btn-sm" href={statementHref}>Download statement</a>
                </div>
              </section>

              <section className="v-panel set-panel glass" aria-labelledby="set-integrity">
                <h2 id="set-integrity">Ledger integrity</h2>
                <p className="set-copy">
                  Run the checks against a real payment in your history, or open the console to read the ledger yourself.
                </p>
                <p className="set-copy"><a className="set-link" href="/ops">Open the engine console</a></p>
                <div className="set-embed">
                  <TrustTab me={me} data={data} embedded />
                </div>
              </section>

              <section className="v-panel set-panel glass" aria-labelledby="set-retention">
                <h2 id="set-retention">Control and removal</h2>
                {!real ? <p className="set-copy muted">Sign in to a real account to use this.</p> : null}
                <Suspense fallback={<SecurityFallback />}>
                  <DataPrivacyPanel real={real} onSignOut={onSignOut} />
                </Suspense>
                <ul className="set-rows">
                  <PlannedRow label="Retention settings" description="Choose how long logs and backups are kept." milestone="M3" />
                </ul>
              </section>
            </>
          ) : null}

          {tab === 'integrations' ? (
            <>
              <section className="v-panel set-panel glass" aria-labelledby="set-import">
                <h2 id="set-import">Import spend logs from CSV</h2>
                {demo ? (
                  <p className="set-copy muted">
                    CSV import works for connected accounts. Create an account to import your own spend logs.
                    {' '}<a className="set-link" href="/signup">Create an account</a>
                  </p>
                ) : (
                  <SpendImport accountId={me.id} onChanged={onReload} />
                )}
              </section>

              <section className="v-panel set-panel glass" aria-labelledby="set-integrations">
                <h2 id="set-integrations">Connections</h2>
                <ul className="set-rows">
                  <PlannedRow label="Bank statement import" description="Read a statement export without editing it first." milestone="M3" />
                  <PlannedRow label="Bring your own API keys" description="Point Settle at the model provider you already pay for." milestone="M4" />
                  <PlannedRow label="Bank connector" description="Read balances and transactions directly from a bank." milestone="M3" />
                </ul>
              </section>
            </>
          ) : null}

          {tab === 'categories' ? (
            <section className="v-panel set-panel glass" aria-labelledby="set-categories">
              <h2 id="set-categories">Categories &amp; rules</h2>
              <p className="set-copy">
                Rules set a category when the descriptor contains a merchant and, optionally, when the amount is under a cap.
              </p>
              <p className="set-copy">
                Preview the affected spends before saving, then apply the rule to past spends in one step. Earlier versions stay in history.
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => navigate({ kind: 'app', section: 'rules' })}
              >
                Open rules
              </button>
            </section>
          ) : null}

          {tab === 'appearance' ? (
            <section className="v-panel set-panel glass" aria-labelledby="set-appearance" data-tour="settings-appearance">
              <h2 id="set-appearance">Appearance</h2>
              <fieldset className="set-fieldset">
                <legend className="set-legend">Theme</legend>
                <div className="set-choices">
                  {THEME_OPTIONS.map((option) => (
                    <label key={option.value} className="set-choice">
                      <input
                        type="radio"
                        name="settle-theme"
                        value={option.value}
                        checked={theme === option.value}
                        onChange={() => onTheme(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="set-fieldset">
                <legend className="set-legend">Density</legend>
                <div className="set-choices">
                  {DENSITY_OPTIONS.map((option) => (
                    <label key={option.value} className="set-choice">
                      <input
                        type="radio"
                        name="settle-density"
                        value={option.value}
                        checked={density === option.value}
                        onChange={() => onDensity(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="set-copy muted">Changes apply as soon as you pick them.</p>
            </section>
          ) : null}

          {tab === 'balances' ? (
            <section className="v-panel set-panel glass" aria-labelledby="set-balances">
              <h2 id="set-balances">Balances &amp; budget</h2>
              {data ? <BalanceFigures data={data} /> : <p className="v-empty">Loading your wallet…</p>}
              <div className="row-wrap">
                <button type="button" className="btn btn-primary btn-sm" onClick={onEditBalances}>Edit balances</button>
              </div>
              <p className="set-copy muted">
                Cash and card balance you set, plus the weekly pace the overview measures against.
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlannedRow({ label, description, milestone }: { label: string; description: string; milestone: string }) {
  return (
    <li className="set-row">
      <span className="set-row-label">{label}</span>
      <span className="set-row-desc">{description}</span>
      <span className="planned">Planned · {milestone}</span>
    </li>
  );
}

function BalanceFigures({ data }: { data: WalletData }) {
  const plan = moneyPlan(data.view);
  return (
    <div className="v-figs v-figs-3">
      <div className="v-fig glass">
        <p className="v-fig-label">Cash</p>
        <p className="v-fig-value num">{plan.cashMinor === null ? 'Not set' : money(plan.cashMinor)}</p>
      </div>
      <div className="v-fig glass">
        <p className="v-fig-label">On cards</p>
        <p className="v-fig-value num">{money(plan.creditMinor)}</p>
      </div>
      <div className="v-fig glass">
        <p className="v-fig-label">Weekly plan</p>
        <p className="v-fig-value num">{plan.budgetMinor === null ? 'Not set' : money(plan.budgetMinor)}</p>
      </div>
    </div>
  );
}

function SpendImport({ accountId, onChanged }: { accountId: string; onChanged?: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function importFile() {
    if (!file) return;
    setError(''); setMessage(''); setBusy(true);
    try {
      if (file.size > 1_000_000) throw new Error('Choose a CSV smaller than 1 MB.');
      const result = await api.importSpends(accountId, await file.text());
      setMessage(`Imported ${result.imported} expenses. Skipped ${result.duplicates} duplicates.`);
      await onChanged?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="set-import">
      <p className="set-copy">Bring spending into Transactions and Insights. These logs do not move money. Requires a live wallet.</p>
      <p className="set-copy muted">Use YYYY-MM-DD dates and positive amounts such as 12.50. Include transactionId to catch duplicates across statements.</p>
      <a className="link-btn" download="settle-expenses.csv" href={'data:text/csv;charset=utf-8,' + encodeURIComponent('date,amount,category,note,transactionId\n2026-01-01,12.50,groceries,Weekly groceries,EXAMPLE-1\n')}>Download CSV template</a>
      <label htmlFor="expense-csv">Expense CSV (up to 2,000 rows)</label>
      <input id="expense-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => {
        setFile(e.target.files?.[0] ?? null); setError(''); setMessage('');
      }} />
      <div className="row-wrap">
        <button className="btn btn-sm" type="button" disabled={!file || busy} onClick={() => void importFile()}>
          {busy ? 'Importing…' : 'Import expenses'}
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}
