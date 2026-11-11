import { useEffect, useMemo, useState } from 'react';
import './styles/views.css';
import './styles/risk.css';
import { api, type MonthlyReport } from '../api.js';
import { categoryLabel, incomeSourceLabel } from './categories.js';
import { money } from './format.js';
import { ErrorNotice, Skeleton } from './ui.js';

function monthNow(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, index! - 1 + delta, 1)).toISOString().slice(0, 7);
}

function pctLabel(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value}%`;
}

export function ReportsView({ accountId }: { accountId: string }) {
  const [month, setMonth] = useState(monthNow);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError(null);
    api.monthlyReport(accountId, month).then((next) => {
      if (alive) setReport(next);
    }).catch((reason: Error) => {
      if (alive) setError(reason.message);
    });
    return () => { alive = false; };
  }, [accountId, month, attempt]);

  const barMax = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.byCategory.map((row) => Math.max(row.inMinor, row.outMinor)));
  }, [report]);

  if (error) return <ErrorNotice message={error} onRetry={() => setAttempt((current) => current + 1)} />;
  if (!report) return <Skeleton height={460} />;

  return (
    <div className="v-view risk-page">
      <header className="risk-head">
        <div className="v-head">
          <h1 className="v-title">Reports</h1>
          <p className="v-sub">A monthly close from your logged income and spending.</p>
        </div>
        <div className="risk-month-nav">
          <button type="button" className="btn btn-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
          <span>{report.label}</span>
          <button type="button" className="btn btn-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
          <a
            className="btn btn-sm"
            href={api.monthlyReportCsvUrl(accountId, month)}
            download={`settle-report-${month}.csv`}
          >
            Download CSV
          </a>
        </div>
      </header>

      <section className="v-figs" aria-label="Monthly totals">
        <div className="v-fig glass">
          <p className="v-fig-label">Income</p>
          <p className="v-fig-value num risk-pos">{money(report.incomeMinor, report.currency)}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">Spend</p>
          <p className="v-fig-value num">{money(report.spendMinor, report.currency)}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">Net</p>
          <p className={`v-fig-value num ${report.netMinor < 0 ? 'risk-neg' : ''}`}>{money(report.netMinor, report.currency)}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">Logged rows</p>
          <p className="v-fig-value num">{report.transactionCount}</p>
        </div>
      </section>

      <section className="risk-panel glass" aria-labelledby="report-compare-title">
        <div className="risk-panel-head">
          <div>
            <p className="risk-kicker">Month over month</p>
            <h2 id="report-compare-title">Against {report.previous.label}</h2>
          </div>
        </div>
        <div className="report-compare">
          <div>
            <span>Income</span>
            <strong>{money(report.previous.incomeMinor, report.currency)} → {money(report.incomeMinor, report.currency)}</strong>
            <em className={report.change.incomePct !== null && report.change.incomePct < 0 ? 'risk-neg' : 'risk-pos'}>
              {pctLabel(report.change.incomePct)}
            </em>
          </div>
          <div>
            <span>Spend</span>
            <strong>{money(report.previous.spendMinor, report.currency)} → {money(report.spendMinor, report.currency)}</strong>
            <em className={report.change.spendPct !== null && report.change.spendPct > 0 ? 'risk-neg' : 'risk-pos'}>
              {pctLabel(report.change.spendPct)}
            </em>
          </div>
          <div>
            <span>Net</span>
            <strong>{money(report.previous.netMinor, report.currency)} → {money(report.netMinor, report.currency)}</strong>
            <em className={report.change.netPct !== null && report.change.netPct < 0 ? 'risk-neg' : 'risk-pos'}>
              {pctLabel(report.change.netPct)}
            </em>
          </div>
        </div>
      </section>

      <div className="risk-grid risk-grid-2">
        <section className="risk-panel glass" aria-labelledby="report-categories-title">
          <div className="risk-panel-head">
            <div>
              <p className="risk-kicker">In and out</p>
              <h2 id="report-categories-title">By category</h2>
            </div>
          </div>
          {report.byCategory.length === 0 ? (
            <p className="hint">No rows in {report.label}. Pick another month or log a spend.</p>
          ) : (
            <ul className="report-bars">
              {report.byCategory.map((row) => {
                const value = Math.max(row.inMinor, row.outMinor);
                const label = row.kind === 'income' ? incomeSourceLabel(row.key) : categoryLabel(row.key);
                return (
                  <li key={`${row.kind}:${row.key}`}>
                    <span className="report-bar-label">
                      <span>{label}</span>
                      <b>{money(value, report.currency)}</b>
                    </span>
                    <span className="report-bar-track">
                      <span
                        className={row.kind === 'income' ? 'report-bar-in' : 'report-bar-out'}
                        style={{ width: `${Math.round((value / barMax) * 100)}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="risk-panel glass" aria-labelledby="report-merchants-title">
          <div className="risk-panel-head">
            <div>
              <p className="risk-kicker">Where it went</p>
              <h2 id="report-merchants-title">Top merchants</h2>
            </div>
          </div>
          {report.topMerchants.length === 0 ? (
            <p className="hint">No merchant spending in this month.</p>
          ) : (
            <ul className="risk-list">
              {report.topMerchants.map((merchant) => (
                <li key={merchant.merchantKey}>
                  <span>
                    <strong>{merchant.merchant}</strong>
                    <small>{merchant.count} {merchant.count === 1 ? 'charge' : 'charges'} · {merchant.sharePct}% of spend</small>
                  </span>
                  <b>{money(merchant.spendMinor, report.currency)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
