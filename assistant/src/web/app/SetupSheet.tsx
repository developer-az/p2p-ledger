import { useEffect, useMemo, useState } from 'react';
import { api, type AccountRef, type MoneyProfile } from '../api.js';
import { money } from './format.js';
import { suggestedWeeklyBudget } from './money-plan.js';
import { Sheet, useToast } from './ui.js';

type Step = 0 | 1 | 2;

function parseMinor(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 999_000) return null;
  return Math.round(value * 100);
}

function textFromMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2);
}

export function SetupSheet({
  open,
  onClose,
  me,
  profile,
  mode = 'onboarding',
  initialStep = 0,
  suggestedCashMinor,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  me: AccountRef;
  profile?: MoneyProfile;
  mode?: 'onboarding' | 'edit';
  initialStep?: 0 | 1 | 2;
  suggestedCashMinor?: number | null;
  onSaved: (step: 0 | 1 | 2) => Promise<void> | void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);
  const [cashText, setCashText] = useState('');
  const [creditText, setCreditText] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [affectsWallet, setAffectsWallet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setCashText(textFromMinor(profile?.walletCashMinor ?? suggestedCashMinor));
    setCreditText(textFromMinor(profile?.creditOwedMinor ?? 0));
    setBudgetText(textFromMinor(profile?.weeklyBudgetMinor));
    setAffectsWallet(profile?.spendLogsAffectWallet ?? true);
    setBusy(false);
    setError(null);
  }, [open, profile, mode, initialStep, suggestedCashMinor]);

  const cashMinor = parseMinor(cashText);
  const creditParsed = parseMinor(creditText);
  const creditMinor = creditParsed ?? 0;
  const budgetMinor = parseMinor(budgetText);
  const balanceForPace = cashMinor ?? profile?.walletCashMinor ?? suggestedCashMinor ?? null;
  const suggestion = useMemo(
    () => suggestedWeeklyBudget(balanceForPace, 0),
    [balanceForPace],
  );
  const suggestions = useMemo(() => {
    if (balanceForPace === null || balanceForPace <= 0) {
      return [...new Set([5_000, suggestion, 10_000, 15_000])].sort((a, b) => a - b);
    }
    const pct = (share: number) => Math.max(5_000, Math.round((balanceForPace * share) / 1000) * 1000);
    const base = suggestion;
    return [...new Set([pct(0.1), pct(0.18), base, pct(0.25)])].sort((a, b) => a - b);
  }, [balanceForPace, suggestion]);

  const canContinue = step === 0
    ? cashMinor !== null
    : step === 1
      ? creditText.trim() === '' || creditParsed !== null
      : budgetMinor !== null && budgetMinor > 0;
  const last = step === 2;

  async function save() {
    if (cashMinor === null || budgetMinor === null || budgetMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateFinance(me.id, {
        walletCashMinor: cashMinor,
        creditOwedMinor: creditMinor,
        weeklyBudgetMinor: budgetMinor,
        spendLogsAffectWallet: affectsWallet,
      });
      await onSaved(step);
      toast(mode === 'onboarding' ? 'Baseline saved. This is your starting line.' : 'Your snapshot is updated.', { tone: 'good' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title={mode === 'onboarding' ? 'Set your starting point' : 'Edit your snapshot'}
      subtitle={mode === 'onboarding' ? 'Three numbers. Thirty seconds. No bank login.' : 'Change one number without changing anything else.'}
      onClose={onClose}
    >
      <div className="setup">
        <div className="setup-steps" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`setup-step${i <= step ? ' is-on' : ''}`} />
          ))}
          <span className="setup-step-label">Step {step + 1} of 3</span>
        </div>

        {step === 0 ? (
          <div className="setup-panel">
            <div className="setup-icon">💵</div>
            <h3>What&apos;s in your spending account right now?</h3>
            <p className="muted">Checking, debit, cash in your pocket — the money you can actually spend today.</p>
            <label className="setup-amount">
              <span>$</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="0"
                value={cashText}
                onChange={(e) => setCashText(e.target.value)}
                aria-label="Cash balance"
              />
            </label>
            <div className="chips setup-chips">
              {[250, 500, 1_000, 2_500].map((value) => (
                <button key={value} type="button" className="chip" aria-pressed={cashMinor === value * 100} onClick={() => setCashText(String(value))}>
                  ${value.toLocaleString('en-US')}
                </button>
              ))}
            </div>
            <p className="hint">You can update this any time. It stays on this demo wallet.</p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-panel">
            <div className="setup-icon">💳</div>
            <h3>What do you owe on cards?</h3>
            <p className="muted">The total balance, not the minimum payment. We keep it separate from cash.</p>
            <label className="setup-amount">
              <span>$</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="0"
                value={creditText}
                onChange={(e) => setCreditText(e.target.value)}
                aria-label="Credit owed"
              />
            </label>
            <div className="chips setup-chips">
              <button type="button" className="chip" aria-pressed={creditMinor === 0} onClick={() => setCreditText('0')}>
                Nothing right now
              </button>
              {[500, 1_000, 2_500].map((value) => (
                <button key={value} type="button" className="chip" aria-pressed={creditMinor === value * 100} onClick={() => setCreditText(String(value))}>
                  ${value.toLocaleString('en-US')}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="setup-panel">
            <div className="setup-icon">🎯</div>
            <h3>What feels comfortable to spend in a week?</h3>
            <p className="muted">
              This is your weekly spending pace — how much you&apos;re okay logging before the ring fills up.
              It is not your net. Net is cash plus income minus logged spend minus card balance; each spend you log lowers net.
            </p>
            <label className="setup-amount">
              <span>$</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="0"
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
                aria-label="Weekly plan"
              />
            </label>
            <div className="chips setup-chips">
              {suggestions.map((value) => (
                <button key={value} type="button" className="chip" aria-pressed={budgetMinor === value} onClick={() => setBudgetText(textFromMinor(value))}>
                  {money(value)}/wk
                </button>
              ))}
            </div>
            {mode === 'edit' ? (
              <div className="setup-toggle-block">
                <label className="setup-toggle">
                  <input type="checkbox" checked={affectsWallet} onChange={(e) => setAffectsWallet(e.target.checked)} />
                  <span>Subtract new spends from projected cash</span>
                </label>
                <p className="hint setup-toggle-hint">
                  {affectsWallet
                    ? 'Each spend you log lowers the net number on Today until you edit cash again.'
                    : 'Spends stay as history only — your cash baseline stays where you set it.'}
                </p>
              </div>
            ) : null}
            <p className="hint">Pace chips scale from your cash balance ({balanceForPace === null ? 'set cash first' : money(balanceForPace)}). Change the plan whenever life changes.</p>
          </div>
        ) : null}

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <div className="setup-actions">
          {step > 0 ? (
            <button type="button" className="btn" onClick={() => setStep((step - 1) as Step)} disabled={busy}>
              Back
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
              {mode === 'edit' ? 'Cancel' : 'Skip for now'}
            </button>
          )}
          {last ? (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!canContinue || busy}>
              {busy ? 'Saving…' : 'See my snapshot'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setStep((step + 1) as Step)} disabled={!canContinue}>
              Continue
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
