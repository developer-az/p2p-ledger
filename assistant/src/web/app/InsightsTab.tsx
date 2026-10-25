import { useEffect, useMemo, useState } from 'react';
import { categoryLabel } from './categories.js';
import { CategoryBars } from './CategoryBars.js';
import { money } from './format.js';
import { milestones, nextMilestone } from './milestones.js';
import { moneyPlan, moneyStory, monthsToClear } from './money-plan.js';
import { Icon, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function InsightsTab({
  data,
  onLog,
  onSetup,
  onAsk,
  demo,
  onDemoHome,
}: {
  data: WalletData | null;
  onLog: () => void;
  onSetup: (step?: 0 | 1 | 2) => void;
  onAsk: () => void;
  demo?: boolean;
  onDemoHome?: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [weeklyPayment, setWeeklyPayment] = useState(5_000);
  if (!data) return <Skeleton height={420} />;

  const plan = moneyPlan(data.view);
  const patterns = plan.patterns;
  const stories = moneyStory(plan);
  const badges = milestones(plan, data.view.summary);
  const next = nextMilestone(badges);
  const hasLogs = (patterns?.categories.length ?? 0) > 0;
  const selected = patterns?.days.find((d) => d.date === selectedDay) ?? null;

  return (
    <div className="patterns">
      {demo && onDemoHome ? (
        <div className="demo-patterns-bar" role="region" aria-label="Demo navigation">
          <button type="button" className="btn btn-primary btn-sm" onClick={onDemoHome}>← Back to demo home</button>
        </div>
      ) : null}
      <header className="patterns-head">
        <div>
          <h1>Patterns</h1>
          <p className="page-sub">Built only from what you log. No bank feed, no guessing.</p>
        </div>
        <div className="patterns-head-badges">
          <span className="streak-pill"><span className="streak-mark" aria-hidden="true" /><strong className="num">{plan.streakDays}</strong><span>day streak</span></span>
          <button type="button" className="btn btn-sm" onClick={onAsk}><Icon name="sparkle" size={16} /> Ask about this</button>
        </div>
      </header>

      {!hasLogs ? (
        <section className="card empty-patterns">
          <h2>Your first pattern is one log away.</h2>
          <p className="muted">Log a coffee, a bus ride, a grocery run. After a few days, this page starts to look like you.</p>
          <div className="row-wrap" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>
            <button type="button" className="btn" onClick={() => onSetup(0)}>Set your baseline</button>
          </div>
        </section>
      ) : (
        <>
          <div className="patterns-top">
            <section className="card week-focus" aria-labelledby="focus-title">
              <div className="card-head">
                <h2 id="focus-title">This week</h2>
                <button type="button" className="link-btn" onClick={() => onSetup(2)}>Edit plan</button>
              </div>
              <div className="focus-body">
                <div className="focus-copy">
                  <p className="focus-big num">{money(patterns?.week.spentMinor ?? 0)}</p>
                  <p className="muted">{patterns?.week.budgetMinor ? `of ${money(patterns.week.budgetMinor)} · ${patterns.week.remainingMinor === null ? 'no pace' : `${money(Math.max(0, patterns.week.remainingMinor))} left`}` : 'logged this week · no weekly pace yet'}</p>
                  {patterns?.week.budgetMinor ? (
                    <div className="week-track" role="progressbar" aria-label="Weekly pace used" aria-valuemin={0} aria-valuemax={patterns.week.budgetMinor} aria-valuenow={Math.min(patterns.week.spentMinor, patterns.week.budgetMinor)}>
                      <span className={plan.overBudget ? 'is-over' : ''} style={{ width: `${Math.min(100, (patterns.week.spentMinor / patterns.week.budgetMinor) * 100)}%` }} />
                    </div>
                  ) : null}
                  <p className="hint" style={{ marginTop: 8 }}>
                    {patterns && patterns.week.lastWeekSpentMinor > 0
                      ? `${money(Math.abs(patterns.week.spentMinor - patterns.week.lastWeekSpentMinor))} ${patterns.week.spentMinor >= patterns.week.lastWeekSpentMinor ? 'more' : 'less'} than this point last week.`
                      : 'Your first week of data. The comparison appears next week.'}
                  </p>
                </div>
              </div>
            </section>

            <section className="card month-focus" aria-labelledby="month-title">
              <div className="card-head">
                <div><h2 id="month-title">This month</h2><p className="card-sub">{patterns?.month.label}</p></div>
              </div>
              <div className="month-grid">
                <div><span className="stat-label">Logged out</span><strong className="num">{money(patterns?.month.spentMinor ?? 0)}</strong></div>
                <div><span className="stat-label">Logged in</span><strong className="num">{money(patterns?.month.incomeMinor ?? 0)}</strong></div>
                <div><span className="stat-label">Heading toward</span><strong className="num">{money(patterns?.month.projectedSpendMinor ?? 0)}</strong></div>
              </div>
              <div className="month-line">
                <span className="muted">Day {patterns?.month.dayOfMonth} of {patterns?.month.daysInMonth}</span>
                <span className="pill">{patterns?.totals.activeDays30d ?? 0} active days</span>
              </div>
            </section>
          </div>

          <section className="card heat-card" aria-labelledby="heat-title">
            <div className="card-head">
              <div>
                <h2 id="heat-title">Eight weeks of cards</h2>
                <p className="card-sub">One row per week. A fuller stamp is a bigger day.</p>
              </div>
              <div className="heat-legend" aria-hidden="true"><span>Less</span><i /><i /><i /><i /><i /><span>More</span></div>
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
                  <p className="hint heat-hint">Tap a day to see the detail. Empty days are not failures.</p>
                )}
              </div>
            </div>
          </section>

          <div className="patterns-mid">
            <section className="card cat-card" aria-labelledby="cat-title">
              <div className="card-head">
                <div><h2 id="cat-title">Where it went</h2><p className="card-sub">Last 30 days · {money(patterns?.totals.spend30dMinor ?? 0)} logged</p></div>
              </div>
              <CategoryBars categories={(patterns?.categories ?? []).slice(0, 6)} max={Math.max(1, ...(patterns?.categories ?? []).map((c) => c.totalMinor))} />
              <ul className="cat-changes">
                {(patterns?.categories ?? []).slice(0, 6).flatMap((c) => (c.changePct === null || c.changePct === 0 ? [] : [{ category: c.category, change: c.changePct }])).slice(0, 3).map((c) => (
                  <li key={c.category} className={c.change > 0 ? 'is-up' : 'is-down'}>
                    <span>{categoryLabel(c.category)}</span>
                    <span className="num">{c.change > 0 ? '+' : '−'}{Math.abs(c.change)}% vs the 30 days before</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card weekday-card" aria-labelledby="weekday-title">
              <div className="card-head">
                <div><h2 id="weekday-title">By weekday</h2><p className="card-sub">Average logged spend over eight weeks</p></div>
              </div>
              <WeekdayBars weekdays={patterns?.weekdays ?? []} />
            </section>
          </div>

          <section className="card story-card" aria-labelledby="story-title">
            <div className="card-head">
              <h2 id="story-title">What stands out</h2>
            </div>
            <div className="story-grid">
              {stories.slice(0, 3).map((story) => (
                <article key={story.key} className={`story story-${story.tone}`}>
                  <span className="story-mark" aria-hidden="true">{story.tone === 'good' ? '✓' : story.tone === 'warn' ? '!' : '·'}</span>
                  <h3>{story.title}</h3>
                  <p>{story.body}</p>
                </article>
              ))}
            </div>
          </section>

          {plan.creditMinor > 0 ? (
            <section className="card payoff-card" aria-labelledby="payoff-title">
              <div className="card-head">
                <h2 id="payoff-title">Card payoff</h2>
                <span className="amount">{money(plan.creditMinor)}</span>
              </div>
              <p className="muted">Move the slider. No commitment — just a picture of what a weekly payment does. Interest is not modeled.</p>
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
            </section>
          ) : null}

          <section className="card badges-card" aria-labelledby="badges-title">
            <div className="card-head">
              <h2 id="badges-title">Milestones</h2>
              {next ? <span className="pill">{next.title}</span> : <span className="pill pill-good">All earned</span>}
            </div>
            <div className="badge-row">
              {badges.map((badge) => (
                <div key={badge.id} className={`badge${badge.earned ? ' is-earned' : ''}`} title={badge.body}>
                  <span className="badge-mark" aria-hidden="true">{badge.earned ? <Icon name="check" size={14} /> : null}</span>
                  <span className="badge-title">{badge.title}</span>
                  <span className="badge-progress" aria-hidden="true"><span style={{ width: `${Math.round(badge.progress * 100)}%` }} /></span>
                </div>
              ))}
            </div>
          </section>
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

function WeekdayBars({ weekdays }: { weekdays: { weekday: number; label: string; averageMinor: number }[] }) {
  const ordered = WEEKDAY_ORDER.map((day) => weekdays.find((w) => w.weekday === day)).filter((w): w is { weekday: number; label: string; averageMinor: number } => Boolean(w));
  const max = Math.max(1, ...ordered.map((d) => d.averageMinor));
  return (
    <div className="weekday-bars">
      {ordered.map((day) => (
        <div key={day.weekday} className="weekday-bar">
          <span className="weekday-value">{day.averageMinor > 0 ? money(day.averageMinor) : '—'}</span>
          <span className="weekday-track"><span style={{ height: `${Math.max(4, (day.averageMinor / max) * 100)}%` }} /></span>
          <span className="weekday-label">{day.label.slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}
