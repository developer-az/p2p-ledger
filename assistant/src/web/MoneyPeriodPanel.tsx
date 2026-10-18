import { useEffect, useState, type FormEvent } from 'react';
import { api, dollarsToMinor, type FinanceSnapshot, type MoneyProfile } from './api.js';

function minorToInput(minor: number | null): string {
  if (minor === null) return '';
  return (minor / 100).toFixed(2);
}

export function MoneyPeriodPanel({
  accountId,
  profile,
  finance,
  busy,
  onUpdated,
}: {
  accountId: string;
  profile: MoneyProfile;
  finance: FinanceSnapshot;
  busy: boolean;
  onUpdated: () => void;
}) {
  const [cash, setCash] = useState(() => minorToInput(profile.walletCashMinor));
  const [credit, setCredit] = useState(() => minorToInput(profile.creditOwedMinor));
  const [affectWallet, setAffectWallet] = useState(profile.spendLogsAffectWallet);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCash(minorToInput(profile.walletCashMinor));
    setCredit(minorToInput(profile.creditOwedMinor));
    setAffectWallet(profile.spendLogsAffectWallet);
  }, [profile.walletCashMinor, profile.creditOwedMinor, profile.spendLogsAffectWallet]);

  async function saveBalances(e: FormEvent) {
    e.preventDefault();
    setError('');
    const walletCashMinor = cash.trim() === '' ? null : dollarsToMinor(cash);
    if (cash.trim() !== '' && walletCashMinor === null) {
      setError('Enter a valid cash balance or leave blank.');
      return;
    }
    const creditOwedMinor = credit.trim() === '' ? 0 : dollarsToMinor(credit);
    if (credit.trim() !== '' && creditOwedMinor === null) {
      setError('Enter a valid credit balance.');
      return;
    }
    setSaving(true);
    try {
      await api.updateFinance(accountId, {
        walletCashMinor,
        creditOwedMinor: creditOwedMinor ?? 0,
        spendLogsAffectWallet: affectWallet,
      });
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function newMonth() {
    setError('');
    setSaving(true);
    try {
      await api.rolloverFinancePeriod(accountId);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return (
    <div className="bb-finance bb-pad">
      <div className="bb-finance-head">
        <h3 className="bb-subhd bb-finance-title">Your books · {finance.periodLabel}</h3>
        <button type="button" className="bb-btn-chip" disabled={disabled} onClick={() => void newMonth()}>
          New month
        </button>
      </div>
      <p className="bb-dim bb-finance-hint">
        Totals count activity since {finance.periodStart.slice(0, 10)}. Older lines stay in ACTIVITY for reference.
      </p>
      <form className="bb-finance-form" onSubmit={(e) => void saveBalances(e)}>
        <div className="bb-habit-row">
          <label className="bb-finance-label">
            Cash balance
            <input
              className="bb-habit-input"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="e.g. 500.00"
              aria-label="Cash balance"
              disabled={disabled}
            />
          </label>
          <label className="bb-finance-label">
            Credit owed
            <input
              className="bb-habit-input"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              placeholder="0.00"
              aria-label="Credit card debt"
              disabled={disabled}
            />
          </label>
        </div>
        <label className="bb-check bb-finance-check">
          <input
            type="checkbox"
            checked={!affectWallet}
            onChange={(e) => setAffectWallet(!e.target.checked)}
            disabled={disabled}
          />
          My cash balance already includes spending — new spend logs are for history only
        </label>
        <button type="submit" className="bb-btn-chip" disabled={disabled}>Save balances</button>
        {error && <p className="bb-err">{error}</p>}
      </form>
      <table className="bb-tbl bb-summary-tbl bb-finance-tbl">
        <tbody>
          <tr><td className="bb-k">Net liquid</td><td className="bb-hi">{finance.netCash ?? '—'}</td></tr>
          <tr><td className="bb-k">Projected</td><td>{finance.projectedCash ?? 'Set cash above'}</td></tr>
          <tr><td className="bb-k">Logged out</td><td>{finance.periodTotals.spent}</td></tr>
          <tr><td className="bb-k">Income in</td><td>{finance.periodTotals.income}</td></tr>
          <tr><td className="bb-k">Ledger (P2P)</td><td className="bb-dim">{finance.ledgerWallet}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
