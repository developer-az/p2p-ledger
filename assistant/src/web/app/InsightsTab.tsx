import { useEffect, useMemo, useState } from 'react';
import { categoryMeta } from './categories.js';
import { money, percent } from './format.js';
import { milestones, nextMilestone } from './milestones.js';
import { moneyPlan, moneyStory, monthsToClear } from './money-plan.js';
import { Icon, ProgressRing, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function InsightsTab({
  data,
  onLog,
  onSetup,
  onAsk,
  demo,
  onDemoHome,
  onShowDemoGuide,
}: {
  data: WalletData | null;
  onLog: () => void;
  onSetup: (step?: 0 | 1 | 2) => void;
  onAsk: () => void;
  demo?: boolean;
  onDemoHome?: () => void;
  onShowDemoGuide?: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [weeklyPayment, setWeeklyPayment] = useState(5_000);
  const [demoSmoke, setDemoSmoke] = useState(false);
  useEffect(() => {
    if (!demo) {
      setDemoSmoke(false);
      return;
    }
    try {
      setDemoSmoke(sessionStorage.getItem('settle:demo-patterns-smoke') !== '1');
    } catch {
      setDemoSmoke(true);
    }
  }, [demo]);
  const dismissDemoSmoke = () => {
    setDemoSmoke(false);
    try {
      sessionStorage.setItem('settle:demo-patterns-smoke', '1');
    } catch {
      /* session-only fallback */
    }
  };
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
      {demo && demoSmoke && onDemoHome ? (
        <div className="demo-smoke" role="dialog" aria-labelledby="demo-smoke-title">
          <div className="demo-smoke-card">
            <p className="eyebrow">Patterns · demo</p>
            <h2 id="demo-smoke-title">This page is deep — you can always get home.</h2>
            <p className="muted">Explore the heatmap and categories, or return to Today to finish the guided loop.</p>
            <div className="demo-patterns-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { dismissDemoSmoke(); onDemoHome(); }}>← Back to demo home</button>
              <button type="button" className="btn btn-sm" onClick={dismissDemoSmoke}>Keep exploring</button>
            </div>
          </div>
        </div>
      ) : null}
      {demo && onDemoHome ? (
        <div className="demo-patterns-bar" role="region" aria-label="Demo navigation">
          <div className="demo-patterns-copy">
            <span className="demo-badge"><Icon name="sparkle" size={13} /> Guided demo</span>
            <p>You&apos;re exploring Patterns — head back to Today to continue the tour.</p>
          </div>
          <div className="demo-patterns-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={onDemoHome}>← Back to demo home</button>
            {onShowDemoGuide ? (
              <button type="button" className="btn btn-sm" onClick={onShowDemoGuide}>Show guide</button>
            ) : null}
          </div>
        </div>
      ) : null}
      <header className="patterns-head">
        <div>
          <p className="eyebrow">Patterns</p>
          <h1>The shape of your money.</h1>
          <p className="page-sub">Built only from what you log. No bank feed, no guessing.</p>
        </div>
        <div className="patterns-head-badges">
          <span className="streak-pill"><span aria-hidden="true">🔥</span><strong>{plan.streakDays}</strong><span>day streak</span></span>
          <button type="button" className="btn btn-sm" onClick={onAsk}><Icon name="sparkle" size={16} /> Ask about this</button>
        </div>
      </header>

      {!hasLogs ? (
        <section className="card empty-patterns">
          <div className="empty-illustration" aria-hidden="true">
            <span>☕</span><span>🚌</span><span>🛒</span>
          </div>
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
                <div><p className="eyebrow">This week</p><h2 id="focus-title">Your pace</h2></div>
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
                <div><p className="eyebrow">{patterns?.month.label}</p><h2 id="month-title">This month</h2></div>
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
                <p className="eyebrow">Eight weeks</p>
                <h2 id="heat-title">A calendar of your spending</h2>
              </div>
              <div className="heat-legend" aria-hidden="true"><span>less</span><i /><i /><i /><i /><span>more</span></div>
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
                <div><p className="eyebrow">Last 30 days</p><h2 id="cat-title">Where it went</h2></div>
              </div>
              <CategoryDonut categories={patterns?.categories ?? []} total={patterns?.totals.spend30dMinor ?? 0} />
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
            </section>

            <section className="card weekday-card" aria-labelledby="weekday-title">
              <div className="card-head">
                <div><p className="eyebrow">Eight-week average</p><h2 id="weekday-title">Your week has a shape</h2></div>
              </div>
              <WeekdayBars weekdays={patterns?.weekdays ?? []} />
              <p className="hint">Bars show average logged spend per day of the week.</p>
            </section>
          </div>

          <section className="card story-card" aria-labelledby="story-title">
            <div className="card-head">
              <div><p className="eyebrow">What stands out</p><h2 id="story-title">Three things worth knowing</h2></div>
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
                <div><p className="eyebrow">A way out</p><h2 id="payoff-title">Card payoff, made small</h2></div>
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
              <div><p className="eyebrow">Small wins</p><h2 id="badges-title">Milestones</h2></div>
              {next ? <span className="pill">{next.title}</span> : <span className="pill pill-good">All earned</span>}
            </div>
            <div className="badge-row">
              {badges.map((badge) => (
                <div key={badge.id} className={`badge${badge.earned ? ' is-earned' : ''}`} title={badge.body}>
                  <span className="badge-emoji" aria-hidden="true">{badge.emoji}</span>
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

function CategoryDonut({ categories, total }: { categories: { category: string; totalMinor: number; sharePct: number }[]; total: number }) {
  let cursor = 0;
  const stops = categories.map((c) => {
    const start = cursor;
    cursor += c.sharePct;
    return `${categoryMeta(c.category).color} ${start}% ${cursor}%`;
  });
  if (cursor < 100) stops.push(`var(--surface-2) ${cursor}% 100%`);
  const top = categories[0];
  return (
    <div className="donut-wrap">
      <div className="donut donut-lg" style={{ background: `conic-gradient(${stops.join(', ')})` }} role="img" aria-label={`${top ? `${categoryMeta(top.category).label} is ${top.sharePct}% of logged spend` : 'No logged spend'}`}>
        <span>{money(total)}</span>
      </div>
      <div className="donut-caption">
        <strong>{top ? categoryMeta(top.category).label : 'Nothing logged'}</strong>
        <span>{top ? `${percent(top.totalMinor, total)}% of the last 30 days` : 'Log a spend to begin'}</span>
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
