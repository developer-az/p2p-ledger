import { useState } from 'react';
import './styles/insights.css';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { PatternCategory, PatternDay, SpendingPatterns } from '../api.js';
import { categoryMeta } from './categories.js';
import { areaPath, linePath, niceMax, scaleX, scaleY } from './chart-geometry.js';
import { money } from './format.js';
import { categoryMovers, cumulativeMonth, rollingAverage } from './pattern-insights.js';

const WIDTH = 320;
const TOP = 8;
const PLOT = 116;
const BASE = 124;

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Month-to-date cumulative spend with the straight-line projection to month end. */
export function MonthPaceChart({
  days,
  month,
  previous30Minor,
}: {
  days: PatternDay[];
  month: SpendingPatterns['month'];
  previous30Minor: number;
}) {
  const m = cumulativeMonth(days, month);
  if (m.points.length === 0) return null;

  const count = month.daysInMonth;
  const last = m.points[m.points.length - 1]!;
  const lastDay = last.day;

  const values: number[] = [];
  let running = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const point = m.points.find((p) => p.day === day);
    if (point) running = point.cumulativeMinor;
    values.push(running);
  }

  const max = niceMax(Math.max(m.projectedMinor, previous30Minor, last.cumulativeMinor));
  const lastX = scaleX(lastDay - 1, count, WIDTH);
  const lastY = TOP + scaleY(last.cumulativeMinor, max, PLOT);
  const projY = TOP + scaleY(m.projectedMinor, max, PLOT);
  const refY = TOP + scaleY(previous30Minor, max, PLOT);

  return (
    <figure className="pchart">
        <svg
          viewBox="0 0 320 140"
          width="100%"
          role="img"
          aria-label={`Spending so far in ${month.label}: ${money(last.cumulativeMinor)}. On pace for ${money(m.projectedMinor)} by day ${month.daysInMonth}.`}
        >
          <line className="pchart-base" x1={0} y1={BASE} x2={WIDTH} y2={BASE} />
          <g transform="translate(0 8)">
            <path className="pchart-area" d={areaPath(values, WIDTH, PLOT, max, count)} />
            <path className="pchart-line" d={linePath(values, WIDTH, PLOT, max, count)} />
          </g>
          <line className="pchart-proj" x1={lastX} y1={lastY} x2={WIDTH} y2={projY} />
          {previous30Minor > 0 ? (
            <>
              <line className="pchart-ref" x1={0} y1={refY} x2={WIDTH} y2={refY} />
              <text className="pchart-label" x={318} y={refY - 4} textAnchor="end">Previous 30 days</text>
            </>
          ) : null}
          <circle className="pchart-dot" cx={lastX} cy={lastY} r={4} />
          <text className="pchart-axis" x={0} y={137} textAnchor="start">1</text>
          <text className="pchart-axis" x={WIDTH} y={137} textAnchor="end">{String(count)}</text>
        </svg>
      <figcaption>
        <strong>On pace for {money(m.projectedMinor)}</strong>
        {` · ${money(m.paceMinorPerDay)} a day so far`}
      </figcaption>
    </figure>
  );
}

/** The five biggest category swings over the last 30 days as diverging bars. */
export function CategoryMoversChart({ categories }: { categories: PatternCategory[] }) {
  const movers = categoryMovers(categories).slice(0, 5);
  if (movers.length === 0) {
    return <p className="hint">No changes from the previous 30 days yet.</p>;
  }

  const max = Math.max(...movers.map((m) => Math.abs(m.changeMinor)));

  return (
    <ul className="movers" aria-label="Biggest changes from the previous 30 days">
      {movers.map((m) => {
        const meta = categoryMeta(m.category);
        const width = max > 0 ? Math.max(4, Math.round((Math.abs(m.changeMinor) / max) * 50)) : 4;
        return (
          <li
            key={m.category}
            className={`mover ${m.changeMinor > 0 ? 'is-up' : 'is-down'}`}
            aria-label={`${meta.label}: ${m.changeMinor > 0 ? 'up' : 'down'} ${money(Math.abs(m.changeMinor))} from the previous 30 days`}
          >
            <span className="mover-name">
              <span className="cat-dot" style={{ background: meta.color }} />
              {meta.label}
            </span>
            <span className="mover-track">
              <span className="mover-bar" style={{ width: `${width}%` }} />
            </span>
            <span className="mover-value num">
              {`${m.changeMinor > 0 ? '+' : '−'}${money(Math.abs(m.changeMinor))}`}
              {m.changePct !== null
                ? ` (${m.changePct > 0 ? '+' : m.changePct < 0 ? '−' : ''}${Math.abs(m.changePct)}%)`
                : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Last 30 days of spend as bars with the 7-day average drawn across them. */
export function DailyTrendChart({ days }: { days: PatternDay[] }) {
  const rows = rollingAverage(days, 7).slice(-30);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const found = selectedDate === null ? -1 : rows.findIndex((r) => r.date === selectedDate);
  const active = found === -1 ? rows.length - 1 : found;
  const row = rows[active]!;
  const slot = WIDTH / rows.length;
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.spendMinor, r.averageMinor))));
  const label = dayLabel(row.date);

  const first = rows[0]!;
  const latest = rows[rows.length - 1]!;
  const diff = latest.averageMinor - first.averageMinor;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'steady';
  const takeaway =
    direction === 'steady'
      ? 'Your 7-day average is steady.'
      : `Your 7-day average is ${direction} ${money(Math.abs(diff))} over ${rows.length} days.`;
  const chartLabel = `Daily spending for the last ${rows.length} days with a 7-day average line.`;
  const readout = `${label} · ${money(row.spendMinor)} · 7-day avg ${money(row.averageMinor)}`;

  function pick(index: number) {
    setSelectedDate(rows[index]!.date);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    let next: number;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, active - 1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(rows.length - 1, active + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else return;
    e.preventDefault();
    pick(next);
  }

  function handlePointer(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const index = Math.floor(((e.clientX - rect.left) / rect.width) * rows.length);
    pick(Math.min(Math.max(index, 0), rows.length - 1));
  }

  return (
    <figure className="pchart">
      <p className="pchart-readout" aria-live="polite">
        {readout}
      </p>
      <div
        className="pchart-scrub"
        role="slider"
        tabIndex={0}
        aria-label="Day by day: choose a day"
        aria-valuemin={1}
        aria-valuemax={rows.length}
        aria-valuenow={active + 1}
        aria-valuetext={readout}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
      >
        <svg
          className="pchart-svg-trend"
          viewBox="0 0 320 140"
          width="100%"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            className="pchart-base"
            x1={0}
            y1={BASE}
            x2={WIDTH}
            y2={BASE}
            vectorEffect="non-scaling-stroke"
          />
          {rows.map((r, i) => {
            const y = TOP + scaleY(r.spendMinor, max, PLOT);
            const height = r.spendMinor > 0 ? Math.max(1, BASE - y) : i === active ? 2 : 0;
            return (
              <rect
                key={r.date}
                className={i === active ? 'pchart-bar pchart-bar-active' : 'pchart-bar'}
                x={i * slot + slot * 0.15}
                y={BASE - height}
                width={slot * 0.7}
                height={height}
              />
            );
          })}
          <g transform={`translate(${slot / 2} 8)`}>
            <path
              className="pchart-avg"
              d={linePath(rows.map((r) => r.averageMinor), WIDTH - slot, PLOT, max)}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      </div>
      <figcaption>
        <span className="sr-only">{chartLabel} </span>
        {takeaway}
      </figcaption>
    </figure>
  );
}
