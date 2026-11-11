import { useEffect, useMemo, useState } from 'react';
import './styles/views.css';
import './styles/risk.css';
import { api, type CashForecast, type ForecastPoint } from '../api.js';
import { areaPath, linePath, niceMax, scaleX, scaleY } from './chart-geometry.js';
import { money } from './format.js';
import { ErrorNotice, Skeleton } from './ui.js';

const HORIZONS = [30, 60, 90] as const;

function Chart({ points, horizon, currency }: { points: ForecastPoint[]; horizon: number; currency: string }) {
  const shown = points.filter((point) => point.day <= horizon);
  const width = 720;
  const height = 220;
  const balances = shown.map((point) => point.balanceMinor);
  const floor = Math.min(0, ...balances);
  const ceiling = Math.max(0, ...balances);
  const axisMax = niceMax(Math.max(1, ceiling - floor));
  const shifted = balances.map((value) => value - floor);
  const line = linePath(shifted, width, height, axisMax);
  const area = areaPath(shifted, width, height, axisMax);
  const zeroY = scaleY(0 - floor, axisMax, height);

  return (
    <div className="risk-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cash projection for the next ${horizon} days`}>
        <defs>
          <linearGradient id="forecast-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line className="risk-zero" x1="0" x2={width} y1={zeroY} y2={zeroY} />
        <path d={area} fill="url(#forecast-fill)" />
        <path d={line} className="risk-line" />
        {HORIZONS.filter((day) => day <= horizon).map((day) => {
          const point = shown.find((candidate) => candidate.day === day);
          if (!point) return null;
          const x = scaleX(shown.indexOf(point), shown.length, width);
          const y = scaleY(point.balanceMinor - floor, axisMax, height);
          return <circle key={day} className="risk-dot" cx={x} cy={y} r="3.5" />;
        })}
      </svg>
      <div className="risk-chart-axis" aria-hidden="true">
        <span>{money(floor, currency)}</span>
        <span>{money(ceiling, currency)}</span>
      </div>
    </div>
  );
}

export function ForecastView({ accountId }: { accountId: string }) {
  const [forecast, setForecast] = useState<CashForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number>(30);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setForecast(null);
    setError(null);
    api.forecast(accountId).then((next) => {
      if (alive) setForecast(next);
    }).catch((reason: Error) => {
      if (alive) setError(reason.message);
    });
    return () => { alive = false; };
  }, [accountId, attempt]);

  const selected = useMemo(() => {
    if (!forecast) return null;
    return forecast.milestones.find((milestone) => milestone.day === horizon)
      ?? forecast.milestones[forecast.milestones.length - 1]
      ?? null;
  }, [forecast, horizon]);

  if (error) return <ErrorNotice message={error} onRetry={() => setAttempt((current) => current + 1)} />;
  if (!forecast) return <Skeleton height={520} />;

  return (
    <div className="v-view risk-page">
      <header className="risk-head">
        <div className="v-head">
          <h1 className="v-title">Forecast</h1>
          <p className="v-sub">Cash out to 90 days, built from your logs and recurring charges.</p>
        </div>
        <div className="risk-seg" role="group" aria-label="Forecast horizon">
          {HORIZONS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={horizon === day}
              onClick={() => setHorizon(day)}
            >
              {day}d
            </button>
          ))}
        </div>
      </header>

      <section className="v-figs v-figs-4" aria-label="Forecast figures">
        <div className="v-fig glass">
          <p className="v-fig-label">Cash today</p>
          <p className="v-fig-value num">{money(forecast.startingBalanceMinor, forecast.currency)}</p>
        </div>
        {forecast.milestones.map((milestone) => (
          <div className="v-fig glass" key={milestone.day}>
            <p className="v-fig-label">In {milestone.day} days</p>
            <p className={`v-fig-value num ${milestone.balanceMinor < 0 ? 'risk-neg' : ''}`}>
              {money(milestone.balanceMinor, forecast.currency)}
            </p>
          </div>
        ))}
      </section>

      <section className="risk-panel glass" aria-labelledby="forecast-line-title">
        <div className="risk-panel-head">
          <div>
            <p className="risk-kicker">{horizon}-day projection</p>
            <h2 id="forecast-line-title">Cash line</h2>
          </div>
          <p className={`risk-pill ${forecast.shortfall ? 'risk-pill-bad' : 'risk-pill-ok'}`}>
            Low point {money(forecast.lowestBalanceMinor, forecast.currency)}
          </p>
        </div>
        <Chart points={forecast.points} horizon={horizon} currency={forecast.currency} />
        <p className="hint">
          Lowest point {forecast.lowestDate}. {selected ? `Outflow by day ${selected.day}: ${money(selected.outflowMinor, forecast.currency)}; income: ${money(selected.incomeMinor, forecast.currency)}.` : ''}
        </p>
      </section>

      <div className="risk-grid">
        <section className="risk-panel glass" aria-labelledby="forecast-assumptions-title">
          <div className="risk-panel-head">
            <div>
              <p className="risk-kicker">What the line assumes</p>
              <h2 id="forecast-assumptions-title">Monthly pace</h2>
            </div>
          </div>
          <dl className="risk-stats">
            <div>
              <dt>Planned income</dt>
              <dd>{money(forecast.monthlyIncomeMinor, forecast.currency)}</dd>
            </div>
            <div>
              <dt>Recurring outflows</dt>
              <dd>{money(forecast.monthlyRecurringOutflowMinor, forecast.currency)}</dd>
            </div>
            <div>
              <dt>Other spend</dt>
              <dd>{money(forecast.averageDiscretionaryMinorPerDay * 30, forecast.currency)}</dd>
            </div>
          </dl>
          <ul className="risk-notes">
            {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        </section>

        <section className="risk-panel glass" aria-labelledby="forecast-recurring-title">
          <div className="risk-panel-head">
            <div>
              <p className="risk-kicker">Detected from history</p>
              <h2 id="forecast-recurring-title">Recurring outflows</h2>
            </div>
          </div>
          {forecast.recurringOutflows.length === 0 ? (
            <p className="hint">No repeated merchant cadence yet. Log another month to surface subscriptions and bills.</p>
          ) : (
            <ul className="risk-list">
              {forecast.recurringOutflows.slice(0, 5).map((stream) => (
                <li key={stream.key}>
                  <span>
                    <strong>{stream.merchant}</strong>
                    <small>Every {stream.intervalDays} days · next {stream.nextDate}</small>
                  </span>
                  <b>{money(stream.amountMinor, forecast.currency)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
