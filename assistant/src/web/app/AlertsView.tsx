import { useCallback, useEffect, useState } from 'react';
import './styles/views.css';
import './styles/risk.css';
import { api, type RiskAlert } from '../api.js';
import { dayLabel } from './format.js';
import { EmptyState, ErrorNotice, Icon, Skeleton } from './ui.js';

const RULE_COPY: Record<RiskAlert['rule'], string> = {
  LOW_PROJECTED_BALANCE: 'Low projected balance',
  LARGE_SPEND: 'Unusual large spend',
  WEEKLY_PLAN_OVERSPEND: 'Weekly plan overspend',
  UPCOMING_LARGE_CHARGE: 'Upcoming large charge',
};

export function AlertsView({ accountId }: { accountId: string }) {
  const [alerts, setAlerts] = useState<RiskAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api.alerts(accountId);
      setAlerts(next.alerts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [accountId]);

  useEffect(() => {
    setAlerts(null);
    void load();
  }, [load]);

  const dismiss = async (alert: RiskAlert) => {
    setDismissing(alert.id);
    setError(null);
    try {
      await api.dismissAlert(accountId, alert.id);
      setAlerts((current) => current?.filter((row) => row.id !== alert.id) ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDismissing(null);
    }
  };

  if (error && alerts === null) return <ErrorNotice message={error} onRetry={() => void load()} />;
  if (!alerts) return <Skeleton height={420} />;

  const high = alerts.filter((alert) => alert.severity === 'high').length;
  const medium = alerts.filter((alert) => alert.severity === 'medium').length;

  return (
    <div className="v-view risk-page">
      <header className="risk-head">
        <div className="v-head">
          <h1 className="v-title">Alerts</h1>
          <p className="v-sub">Rules evaluated on the server from your logs, plan and recurring charges.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          <Icon name="repeat" size={16} /> Refresh
        </button>
      </header>

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      <section className="v-figs v-figs-3" aria-label="Alert counts">
        <div className="v-fig glass">
          <p className="v-fig-label">Open</p>
          <p className="v-fig-value num">{alerts.length}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">High</p>
          <p className="v-fig-value num risk-neg">{high}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">Medium</p>
          <p className="v-fig-value num">{medium}</p>
        </div>
      </section>

      {alerts.length === 0 ? (
        <section className="risk-panel glass">
          <EmptyState icon="check" title="Nothing needs attention">
            No rule fires right now. Alerts appear when projected cash drops, a charge is far above its category median,
            the weekly plan is overspent, or a large recurring charge is due soon.
          </EmptyState>
        </section>
      ) : (
        <ul className="risk-alerts">
          {alerts.map((alert) => (
            <li key={alert.id} className={`risk-alert glass risk-alert-${alert.severity}`}>
              <span className="risk-alert-rail" aria-hidden="true" />
              <div className="risk-alert-body">
                <div className="risk-alert-top">
                  <span className={`risk-severity risk-severity-${alert.severity}`}>{alert.severity}</span>
                  <span className="risk-rule">{RULE_COPY[alert.rule]}</span>
                  {alert.occurredAt ? <span className="risk-when">{dayLabel(alert.occurredAt)}</span> : null}
                </div>
                <h2>{alert.title}</h2>
                <p>{alert.detail}</p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                disabled={dismissing === alert.id}
                onClick={() => void dismiss(alert)}
              >
                {dismissing === alert.id ? 'Dismissing…' : 'Dismiss'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
