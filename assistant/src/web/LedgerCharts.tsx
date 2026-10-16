import { useEffect, useState } from 'react';
import { formatMoney } from '../server/money.js';
import { api, type AccountView, type LedgerEntryRow } from './api.js';
import {
  balanceSeriesFromEntries,
  cashflowFromSummary,
  transferStatusCounts,
} from './chart-data.js';

function BarChart({ values, labels, currency }: { values: number[]; labels: string[]; currency: string }) {
  const max = Math.max(...values, 1);
  const w = 280;
  const h = 100;
  const barW = w / values.length - 8;
  return (
    <svg viewBox={`0 0 ${w} ${h + 24}`} className="chart-svg" role="img" aria-label="30-day cashflow bars">
      {values.map((v, i) => {
        const bh = (v / max) * h;
        const x = i * (barW + 8) + 4;
        return (
          <g key={labels[i]}>
            <rect x={x} y={h - bh} width={barW} height={bh} fill={i === 0 ? '#3dd68c' : '#2e4a3a'} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" className="chart-label">{labels[i]}</text>
            <title>{formatMoney(v, currency)}</title>
          </g>
        );
      })}
    </svg>
  );
}

function Sparkline({ points, currency }: { points: { x: number; y: number }[]; currency: string }) {
  if (points.length < 2) return <p className="dim">Not enough ledger lines yet.</p>;
  const w = 280;
  const h = 80;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.y - minY) / range) * (h - 8) - 4;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" role="img" aria-label="Balance trend">
      <path d={path} fill="none" stroke="#3dd68c" strokeWidth="2" />
      <text x={4} y={12} className="chart-label">{formatMoney(maxY, currency)}</text>
      <text x={4} y={h - 4} className="chart-label">{formatMoney(minY, currency)}</text>
    </svg>
  );
}

export function LedgerCharts({ view, accountId }: { view: AccountView; accountId: string }) {
  const [entries, setEntries] = useState<LedgerEntryRow[]>([]);
  const cash = cashflowFromSummary(view.summary);
  const status = transferStatusCounts(view.transfers);

  useEffect(() => {
    void api.entries(accountId, 80).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [accountId]);

  const series = balanceSeriesFromEntries(entries);

  return (
    <section className="pane charts-pane">
      <div className="pane-hd"><strong>analytics</strong> · 30-day + balance trend</div>
      <div className="pane-bd charts-grid">
        <div>
          <p className="dim" style={{ fontSize: '11px', margin: '0 0 6px' }}>cashflow (minor units)</p>
          <BarChart
            currency={view.currency}
            labels={['dep', 'recv', 'sent', 'in']}
            values={[cash.deposited, cash.received, cash.sent, cash.inflow]}
          />
        </div>
        <div>
          <p className="dim" style={{ fontSize: '11px', margin: '0 0 6px' }}>balance from ledger entries</p>
          <Sparkline points={series} currency={view.currency} />
        </div>
        <div className="chart-legend">
          <span>completed: {status.completed}</span>
          <span>declined: {status.rejected}</span>
        </div>
      </div>
    </section>
  );
}
