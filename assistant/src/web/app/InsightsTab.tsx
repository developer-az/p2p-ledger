import { useMemo, useState } from 'react';
import './styles/views.css';
import './styles/insights.css';
import { categoryMeta } from './categories.js';
import { money } from './format.js';
import { moneyPlan, moneyStory, monthsToClear } from './money-plan.js';
import { CategoryMoversChart, DailyTrendChart, MonthPaceChart } from './pattern-charts.js';
import { buildActions, habitPeak, patternsState } from './pattern-insights.js';
import { Icon, ProgressRing, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Register label for each observation, in place of the old glyph marks. */
const STORY_FLAGS: Record<string, string> = {
  top: 'Leads',
  trend: 'Changed',
  weekday: 'Peak',
  streak: 'Logged',
  projection: 'Outlook',
};

export function InsightsTab({
  data,
  onLog,
  onSetup,
  onAsk,
}: {
  data: WalletData | null;
  onLog: () => void;
  onSetup: (step?: 0 | 1 | 2) => void;
  onAsk: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [weeklyPayment, setWeeklyPayment] = useState(5_000);
  const plan = data ? moneyPlan(data.view) : null;
  const patterns = plan?.patterns ?? null;
  const actions = useMemo(() => (patterns ? buildActions(patterns) : []), [patterns]);
  if (!data || !plan) return <Skeleton height={420} />;

  const stories = moneyStory(plan);
  const state = patternsState(data.view);
  const selected = patterns?.days.find((d) => d.date === selectedDay) ?? null;
  const peak = patterns ? habitPeak(patterns) : null;
  const heatMax = Math.max(0, ...(patterns?.days ?? []).map((d) => d.spendMinor));

  return (
    <div className="patterns">
      <header className="insight-head">
        <div>
          <h1 className="v-title">Insights</h1>
          <p className="v-sub">Built only from what you log, with no bank feed.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={onAsk}><Icon name="chat" size={16} /> Ask about this</button>
      </header>

      {state.kind === 'none' ? (
        <section className="ins-row" aria-labelledby="empty-title">
          <div className="ins-label">
            <p className="ins-kicker">Getting started</p>
            <h2 className="ins-title" id="empty-title">No spending logged yet.</h2>
          </div>
          <div className="ins-body">
            <p className="hint">Log a few everyday spends and this page starts showing patterns from your own logs.</p>
            <div className="ins-actions">
              <button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>
              <button type="button" className="btn" onClick={() => onSetup(0)}>Set your baseline</button>
            </div>
          </div>
        </section>
      ) : state.kind === 'stale' ? (
        <section className="ins-row" aria-labelledby="stale-title">
          <div className="ins-label">
            <p className="ins-kicker">No recent logs</p>
            <h2 className="ins-title" id="stale-title">Nothing logged in the last 30 days.</h2>
          </div>
          <div className="ins-body">
            <p className="hint">
              Your last log was {new Date(state.lastLoggedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Log a spend to bring this page up to date.
            </p>
            <div className="ins-actions">
              <button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>
              <button type="button" className="btn" onClick={() => onSetup(0)}>Set your baseline</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="ins-row" aria-labelledby="focus-title">
            <div className="ins-label">
              <p className="ins-kicker">This week</p>
              <h2 className="ins-title" id="focus-title">Weekly pace</h2>
            </div>
            <div className="ins-body">
              <div className="ins-panel">
                <div className="ins-panel-head">
                  <p className="hint">Spent against the weekly plan.</p>
                  <button type="button" className="link-btn" onClick={() => onSetup(2)}>Edit plan</button>
                </div>
                <div className="focus-body">
                  <ProgressRing
                    value={patterns ? patterns.week.budgetMinor ? Math.min(1, patterns.week.spentMinor / patterns.week.budgetMinor) : 0 : 0}
                    size={132}
                    stroke={11}
                    tone={plan.overBudget ? 'bad' : 'accent'}
                    label="Weekly plan progress"
                  >
                    <strong>{patterns?.week.remainingMinor === null || patterns?.week.remainingMinor === undefined ? '—' : money(patterns.week.remainingMinor)}</strong>
                    <span>left</span>
                  </ProgressRing>
                  <div className="focus-copy">
                    <p className="focus-big num">{money(patterns?.week.spentMinor ?? 0)}</p>
                    <p className="muted">{patterns?.week.budgetMinor ? `of ${money(patterns.week.budgetMinor)} this week` : 'No weekly plan yet'}</p>
                    <p className="hint">
                      {patterns && patterns.week.lastWeekSpentMinor > 0
                        ? `${money(Math.abs(patterns.week.spentMinor - patterns.week.lastWeekSpentMinor))} ${patterns.week.spentMinor >= patterns.week.lastWeekSpentMinor ? 'more' : 'less'} than this point last week.`
                        : 'Your first week of data. The comparison appears next week.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="ins-row" aria-labelledby="month-title" data-tour="insights-charts">
            <div className="ins-label">
              <p className="ins-kicker">{patterns?.month.label}</p>
              <h2 className="ins-title" id="month-title">Month to date</h2>
            </div>
            <div className="ins-body">
              <div className="month-grid">
                <div><span className="stat-label">Logged out</span><strong className="num">{money(patterns?.month.spentMinor ?? 0)}</strong></div>
                <div><span className="stat-label">Logged in</span><strong className="num">{money(patterns?.month.incomeMinor ?? 0)}</strong></div>
                <div><span className="stat-label">Heading toward</span><strong className="num">{money(patterns?.month.projectedSpendMinor ?? 0)}</strong></div>
              </div>
              {patterns ? (
                <MonthPaceChart days={patterns.days} month={patterns.month} previous30Minor={patterns.totals.spendPrev30dMinor} />
              ) : null}
              <div className="month-line">
                <span className="muted">Day {patterns?.month.dayOfMonth} of {patterns?.month.daysInMonth}</span>
                <span className="pill">{patterns?.totals.activeDays30d ?? 0} active days</span>
              </div>
            </div>
          </section>

          <section className="ins-row" aria-labelledby="heat-title">
            <div className="ins-label">
              <p className="ins-kicker">Eight weeks</p>
              <h2 className="ins-title" id="heat-title">Spending calendar</h2>
            </div>
            <div className="ins-body">
              <div className="ins-panel">
                <div className="ins-panel-head">
                  <p className="hint">Daily total, darkest is the highest.</p>
                  <div className="heat-legend" aria-hidden="true"><span>$0</span><i /><i /><i /><i /><span>{money(heatMax)}</span></div>
                </div>
                <div className="heat-body">
                  <Heatmap days={patterns?.days ?? []} onSelect={setSelectedDay} selected={selectedDay} />
                  <div className="heat-side">
                    <div>
                      <span className="stat-label">Biggest day</span>
                      <strong>{patterns?.totals.biggestDay ? money(patterns.totals.biggestDay.spendMinor) : '—'}</strong>
                      <small>{patterns?.totals.biggestDay ? new Date(`${patterns.totals.biggestDay.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No logs yet'}</small>
                    </div>
                    <div>
                      <span className="stat-label">Active days</span>
                      <strong>{patterns?.totals.activeDays30d ?? 0}</strong>
                      <small>in the last 30</small>
                    </div>
                    <div>
                      <span className="stat-label">On an active day</span>
                      <strong>{money(patterns?.totals.averageActiveDayMinor ?? 0)}</strong>
                      <small>average spend</small>
                    </div>
                    {selected ? (
                      <div className="heat-detail" role="status">
                        <strong>{new Date(`${selected.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
                        <span>{selected.count === 0 ? 'No logs' : `${money(selected.spendMinor)} across ${selected.count} ${selected.count === 1 ? 'log' : 'logs'}`}</span>
                        <button type="button" className="link-btn" onClick={() => setSelectedDay(null)}>Clear</button>
                      </div>
                    ) : (
                      <p className="hint heat-hint">Tap a day to see the detail.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="ins-row" aria-labelledby="trend-title">
            <div className="ins-label">
              <p className="ins-kicker">Last 30 days</p>
              <h2 className="ins-title" id="trend-title">Daily spending</h2>
            </div>
            <div className="ins-body">
              {patterns ? <DailyTrendChart days={patterns.days} /> : null}
            </div>
          </section>

          <section className="ins-row" aria-labelledby="cat-title">
            <div className="ins-label">
              <p className="ins-kicker">By category</p>
              <h2 className="ins-title" id="cat-title">Where it went</h2>
            </div>
            <div className="ins-body">
              <h3 className="ins-sub">What changed</h3>
              <CategoryMoversChart categories={patterns?.categories ?? []} />
              <ul className="cat-list">
                {(patterns?.categories ?? []).slice(0, 6).map((c) => (
                  <li key={c.category}>
                    <span className="cat-dot" style={{ background: categoryMeta(c.category).color }} />
                    <span className="cat-name">{categoryMeta(c.category).label}</span>
                    <span className="cat-share">{c.sharePct}%</span>
                    <span className="cat-amount num">{money(c.totalMinor)}</span>
                    {c.changePct !== null && c.changePct !== 0 ? (
                      <span className={`cat-change ${c.changePct > 0 ? 'is-up' : 'is-down'}`}>
                        {c.changePct > 0 ? '↑' : '↓'} {Math.abs(c.changePct)}%
                      </span>
                    ) : <span className="cat-change faint">new</span>}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="ins-row" aria-labelledby="weekday-title">
            <div className="ins-label">
              <p className="ins-kicker">Eight-week average</p>
              <h2 className="ins-title" id="weekday-title">Spending by weekday</h2>
            </div>
            <div className="ins-body">
              <WeekdayBars weekdays={patterns?.weekdays ?? []} peakWeekday={peak ? peak.weekday : null} />
              <p className="hint">
                {peak
                  ? `${peak.label}s run ${peak.multiple}x your other days (${money(peak.averageMinor)} vs ${money(peak.othersAverageMinor)}).`
                  : 'Bars show average logged spend per day of the week.'}
              </p>
            </div>
          </section>

          {actions.length > 0 ? (
            <section className="ins-row" aria-labelledby="try-title">
              <div className="ins-label">
                <p className="ins-kicker">Next week</p>
                <h2 className="ins-title" id="try-title">Try this week</h2>
              </div>
              <div className="ins-body">
                <ol className="try-list">
                  {actions.map((a) => (
                    <li className="try-item" key={a.id}>
                      <div className="try-copy"><h3>{a.title}</h3><p>{a.detail}</p></div>
                      <span className="try-save num">Save ~{money(a.savingsMinor)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ) : null}

          <section className="ins-row" aria-labelledby="story-title">
            <div className="ins-label">
              <p className="ins-kicker">Summary</p>
              <h2 className="ins-title" id="story-title">What stands out</h2>
            </div>
            <div className="ins-body">
              <ul className="story-list">
                {stories.slice(0, 3).map((story) => (
                  <li key={story.key} className="story">
                    <p className="ins-flag">{STORY_FLAGS[story.key] ?? 'Note'}</p>
                    <div className="story-copy">
                      <h3>{story.title}</h3>
                      <p>{story.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {plan.creditMinor > 0 ? (
            <section className="ins-row" aria-labelledby="payoff-title">
              <div className="ins-label">
                <p className="ins-kicker">Card balance</p>
                <h2 className="ins-title" id="payoff-title">Payoff plan</h2>
              </div>
              <div className="ins-body">
                <div className="ins-panel">
                  <div className="ins-panel-head">
                    <p className="hint">Move the slider to see what a weekly payment does. Interest is not modeled.</p>
                    <span className="amount num">{money(plan.creditMinor)}</span>
                  </div>
                  <label className="payoff-slider">
                    <span>Pay <strong>{money(weeklyPayment)}</strong> / week</span>
                    <input
                      type="range"
                      min={1000}
                      max={Math.max(20_000, Math.ceil(plan.creditMinor / 4 / 1000) * 1000)}
                      step={500}
                      value={weeklyPayment}
                      onChange={(e) => setWeeklyPayment(Number(e.target.value))}
                    />
                  </label>
                  <div className="payoff-result">
                    <strong>{monthsToClear(plan.creditMinor, weeklyPayment)} weeks</strong>
                    <span className="muted">to a zero balance at this pace.</span>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Heatmap({ days, onSelect, selected }: {
  days: { date: string; spendMinor: number; count: number }[];
  onSelect: (date: string) => void;
  selected: string | null;
}) {
  const weeks = useMemo(() => {
    if (days.length === 0) return [] as ({ date: string; spendMinor: number; count: number } | null)[][];
    const first = new Date(`${days[0]!.date}T00:00:00`);
    const pad = (first.getDay() + 6) % 7;
    const cells: ({ date: string; spendMinor: number; count: number } | null)[] = Array.from({ length: pad }, () => null);
    for (const day of days) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);
    const out: ({ date: string; spendMinor: number; count: number } | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [days]);
  const max = Math.max(1, ...days.map((d) => d.spendMinor));
  return (
    <div className="heat">
      <div className="heat-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d.slice(0, 1)}</span>)}
      </div>
      <div className="heat-weeks">
        {weeks.map((week, i) => (
          <div className="heat-week" key={i}>
            {week.map((day, j) => {
              if (!day) return <span key={`${i}-${j}`} className="heat-cell is-empty" />;
              const level = day.spendMinor === 0 ? 0 : Math.min(4, Math.ceil((day.spendMinor / max) * 4));
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`heat-cell heat-${level}${selected === day.date ? ' is-selected' : ''}`}
                  onClick={() => onSelect(day.date)}
                  title={`${day.date} · ${day.count} logs`}
                  aria-label={`${new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${day.count === 0 ? 'no logs' : `${money(day.spendMinor)} across ${day.count} logs`}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekdayBars({ weekdays, peakWeekday }: { weekdays: { weekday: number; label: string; averageMinor: number }[]; peakWeekday: number | null }) {
  const ordered = WEEKDAY_ORDER.map((day) => weekdays.find((w) => w.weekday === day)).filter((w): w is { weekday: number; label: string; averageMinor: number } => Boolean(w));
  const max = Math.max(1, ...ordered.map((d) => d.averageMinor));
  return (
    <div className="weekday-bars">
      {ordered.map((day) => (
        <div key={day.weekday} className={`weekday-bar${day.weekday === peakWeekday ? ' is-peak' : ''}`}>
          <span className="weekday-value">{day.averageMinor > 0 ? money(day.averageMinor) : '—'}</span>
          <span className="weekday-track"><span style={{ height: `${Math.max(4, (day.averageMinor / max) * 100)}%` }} /></span>
          <span className="weekday-label">{day.label.slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}
