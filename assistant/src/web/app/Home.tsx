import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AccountRef, SpendCategory } from '../api.js';
import { categoryMeta } from './categories.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { displayName, money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { NeedsYouCard } from './SettleUp.js';
import type { WalletData } from './data.js';
import { EmptyState, Icon, ProgressRing, Skeleton } from './ui.js';

export interface HomeActions {
  addMoney: () => void;
  logSpend: (preset?: { category?: SpendCategory; amountMinor?: number }) => void;
  logIncome: () => void;
  settleUp: () => void;
  ask: (question?: string) => void;
  openItem: (item: FeedItem) => void;
  seeAll: () => void;
  seeInsights: () => void;
  seeWallet: () => void;
  setup: (step?: 0 | 1 | 2) => void;
}

function weekDots(days: { date: string; count: number }[], todayKey: string) {
  return days.slice(-7).map((day) => ({
    key: day.date,
    label: new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'narrow' }),
    logged: day.count > 0,
    today: day.date === todayKey,
  }));
}

export function Home({ me, name, data, actions, guide }: { me: AccountRef; name?: string; data: WalletData | null; actions: HomeActions; guide?: ReactNode }) {
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  if (!data) return <HomeSkeleton />;

  const { view } = data;
  const plan = moneyPlan(view);
  const habitFeed = feed.filter((item) => item.kind === 'spend' || item.kind === 'income');
  const dots = plan.patterns ? weekDots(plan.patterns.days, plan.patterns.week.end) : [];
  const weekChange = plan.patterns
    ? plan.patterns.week.spentMinor - plan.patterns.week.lastWeekSpentMinor
    : 0;

  return (
    <div className="home stagger-in">
      <header className="hello">
        <div className="hello-copy">
          <p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          <h1>Hi, {name ?? displayName(me.owner)}.</h1>
        </div>
      </header>

      {guide}

      {plan.hasBaseline ? <MoneyHero plan={plan} dots={dots} weekChange={weekChange} actions={actions} /> : <SetupHero actions={actions} />}

      <AskBar onAsk={actions.ask} />

      <div className="home-grid">
        <div className="stack">
          <NeedsYouCard me={me} onOpen={actions.settleUp} />

          <section className="card" aria-labelledby="recent">
            <div className="card-head">
              <h2 id="recent">Recent</h2>
              {feed.length > 0 ? <button type="button" className="link-btn" onClick={actions.seeAll}>See all</button> : null}
            </div>
            {habitFeed.length === 0 ? (
              <EmptyState
                title="No spending logged yet"
                action={<button type="button" className="btn btn-primary" onClick={() => actions.logSpend()}>Add a transaction</button>}
              >
                Add a transaction to see it here.
              </EmptyState>
            ) : (
              <FeedList items={habitFeed.slice(0, 5)} onOpen={actions.openItem} grouped={false} />
            )}
          </section>
        </div>

        <div className="stack">
          <PatternPeek plan={plan} onInsights={actions.seeInsights} onLog={() => actions.logSpend()} />
          <CardCard plan={plan} onInsights={actions.seeInsights} />
        </div>
      </div>
    </div>
  );
}

/** Example questions the ask bar cycles through as its placeholder. */
const ASK_IDEAS = [
  'Where did most of my money go this month?',
  'Can I afford a $60 night out this week?',
  'Which day of the week do I spend the most?',
  'How am I doing against my weekly pace?',
];

function AskBar({ onAsk }: { onAsk: (question?: string) => void }) {
  const [q, setQ] = useState('');
  const [idea, setIdea] = useState(0);
  // The placeholder suggests a question every few seconds instead of a row of
  // chip buttons; submitting an empty bar asks the one on show.
  useEffect(() => {
    if (q) return undefined;
    const id = window.setInterval(() => setIdea((i) => (i + 1) % ASK_IDEAS.length), 4200);
    return () => window.clearInterval(id);
  }, [q]);
  return (
    <form className="ask-bar" role="search" onSubmit={(e) => { e.preventDefault(); onAsk(q.trim() || ASK_IDEAS[idea]); }}>
      <Icon name="sparkle" size={18} />
      <label htmlFor="ask-bar" className="sr-only">Ask about your money</label>
      <input id="ask-bar" placeholder={ASK_IDEAS[idea]} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <button type="submit" className="ask-bar-go" aria-label="Ask">↑</button>
    </form>
  );
}

function HabitDots({ dots, label }: { dots: { key: string; label: string; logged: boolean; today: boolean }[]; label: string }) {
  if (!dots.length) return null;
  return (
    <ol className="s-card-dots" aria-label={label}>
      {dots.map((d) => (
        <li key={d.key} className={`${d.logged ? 'is-on' : ''}${d.today ? ' is-today' : ''}`}>
          {d.label}<span className="sr-only">{d.logged ? ' logged' : ' no log'}</span>
        </li>
      ))}
    </ol>
  );
}

function MoneyHero({
  plan,
  dots,
  weekChange,
  actions,
}: {
  plan: ReturnType<typeof moneyPlan>;
  dots: { key: string; label: string; logged: boolean; today: boolean }[];
  weekChange: number;
  actions: HomeActions;
}) {
  const net = plan.netMinor ?? plan.ledgerMinor;
  const over = plan.overBudget;
  const noPace = plan.budgetMinor === null;
  return (
    <section className="money-hero" aria-labelledby="net-label">
      <div className={`s-card${over ? ' is-over' : ''}`}>
        <div className="s-card-top">
          <span className="s-card-brand">settle</span>
          <span className="s-card-private"><Icon name="lock" size={12} /> Private</span>
        </div>
        <p className="s-card-label" id="net-label">Net position</p>
        <p className="s-card-amount num" aria-live="polite">{money(net)}</p>
        <p className="s-card-sub num">
          {plan.cashMinor === null ? 'Cash not set yet' : (
            <>
              {money(plan.cashMinor)} cash
              {plan.periodIncomeMinor > 0 ? <> + {money(plan.periodIncomeMinor)} in</> : null}
              {plan.periodSpentMinor > 0 ? <> − {money(plan.periodSpentMinor)} out</> : null}
              {plan.creditMinor > 0 ? <> · <span className="s-card-debt">{money(plan.creditMinor)} on cards</span></> : null}
            </>
          )}
        </p>
        <div className="s-card-foot">
          <button type="button" className="s-card-ring" onClick={() => (noPace ? actions.setup(2) : actions.logSpend())} aria-label={noPace ? 'Set a weekly pace' : 'Log a spend'}>
            <ProgressRing
              value={noPace ? 0 : plan.weekProgress}
              tone={over ? 'bad' : 'onDark'}
              size={68}
              stroke={7}
              label={noPace ? 'No weekly pace yet' : `${Math.round(plan.weekProgress * 100)} percent of weekly pace used`}
            >
              <strong>{noPace ? '—' : `${Math.round(plan.weekProgress * 100)}%`}</strong>
            </ProgressRing>
          </button>
          <div className="s-card-week">
            <p className="s-card-label">{noPace ? 'No weekly pace' : over ? 'Over pace' : 'Left this week'}</p>
            <p className="s-card-mid num">
              {noPace || plan.budgetMinor === null ? (
                <button type="button" className="s-card-link" onClick={() => actions.setup(2)}>Set one →</button>
              ) : over ? (
                <>{money(plan.weekSpentMinor - plan.budgetMinor)} <span>over {money(plan.budgetMinor)}</span></>
              ) : (
                <>{money(plan.weekLeftMinor ?? 0)} <span>of {money(plan.budgetMinor)}</span></>
              )}
            </p>
            {!noPace && weekChange !== 0 ? (
              <p className="s-card-delta">{weekChange < 0 ? '↓' : '↑'} {money(Math.abs(weekChange))} vs last week</p>
            ) : null}
          </div>
          <button type="button" className="s-card-link s-card-patterns" onClick={actions.seeInsights}>
            <span className="s-card-label">This month</span>
            <span className="num">{money(plan.patterns?.month.spentMinor ?? 0)} →</span>
          </button>
        </div>
        <HabitDots dots={dots} label="Days with a log this week" />
      </div>
    </section>
  );
}

function SetupHero({ actions }: { actions: HomeActions }) {
  return (
    <section className="money-hero" aria-labelledby="setup-title">
      <div className="s-card s-card-setup">
        <p className="s-card-label">Your starting point</p>
        <h2 id="setup-title">Three numbers.<br />Then Settle does the math.</h2>
        <div className="setup-preview">
          <div><small>Cash</small><strong>what you have</strong></div>
          <div><small>Cards</small><strong>what you owe</strong></div>
          <div><small>Pace</small><strong>a weekly guide</strong></div>
        </div>
        <button type="button" className="btn btn-lime" onClick={() => actions.setup(0)}>Set up in 30 seconds</button>
        <p className="s-card-fine">Or skip it. Logging works without a baseline.</p>
      </div>
    </section>
  );
}

function PatternPeek({ plan, onInsights, onLog }: { plan: ReturnType<typeof moneyPlan>; onInsights: () => void; onLog: () => void }) {
  const categories = plan.patterns?.categories ?? [];
  const top = categories[0];
  if (!top) {
    return (
      <section className="card pattern-peek pattern-peek-empty" aria-labelledby="pattern-title">
        <div className="card-head">
          <h2 id="pattern-title">Your money has a shape</h2>
        </div>
        <p className="muted">One log is enough to start seeing it. No bank connection, no judgment.</p>
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={onLog}>Log a spend</button>
      </section>
    );
  }
  let cursor = 0;
  const stops = categories.slice(0, 6).map((c) => {
    const start = cursor;
    cursor += c.sharePct;
    return `${categoryMeta(c.category).color} ${start}% ${cursor}%`;
  });
  if (cursor < 100) stops.push(`var(--surface-2) ${cursor}% 100%`);
  const accent = categoryMeta(top.category).color;
  return (
    <section
      className="card pattern-peek pattern-peek-live"
      aria-labelledby="pattern-title"
      style={{ '--peek-accent': accent } as CSSProperties}
    >
      <div className="card-head">
        <h2 id="pattern-title">Where it went</h2>
        <button type="button" className="link-btn" onClick={onInsights}>See all</button>
      </div>
      <div className="peek-body">
        <div className="donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} role="img" aria-label={`${top.sharePct}% of logged spend went to ${categoryMeta(top.category).label}`}>
          <span>{top.sharePct}%</span>
        </div>
        <div>
          <p className="peek-cat">{categoryMeta(top.category).emoji} {categoryMeta(top.category).label}</p>
          <p className="muted">{top.count} {top.count === 1 ? 'log' : 'logs'} · {money(top.totalMinor)} in 30 days</p>
          {plan.patterns ? <p className="hint">Across {plan.patterns.totals.activeDays30d} active days.</p> : null}
        </div>
      </div>
      <div className="peek-legend">
        {categories.slice(0, 4).map((c) => (
          <span key={c.category}><i style={{ background: categoryMeta(c.category).color }} />{categoryMeta(c.category).label}</span>
        ))}
      </div>
    </section>
  );
}

function CardCard({ plan, onInsights }: { plan: ReturnType<typeof moneyPlan>; onInsights: () => void }) {
  if (plan.creditMinor <= 0) {
    return (
      <section className="card card-clean" aria-labelledby="card-title">
        <div className="card-head">
          <h2 id="card-title">Cards: clean slate</h2>
          <span className="pill pill-good">$0 owed</span>
        </div>
        <p className="muted">No card balance tracked. If that changes, add it in Wallet and we&apos;ll build a payoff path.</p>
      </section>
    );
  }
  const ratio = plan.cashMinor === null ? 0 : plan.cashMinor > 0 ? Math.min(1, plan.creditMinor / plan.cashMinor) : 1;
  return (
    <section className="card" aria-labelledby="card-title">
      <div className="card-head">
        <h2 id="card-title">On your cards</h2>
        <span className="amount">{money(plan.creditMinor)}</span>
      </div>
      <div className="credit-track" aria-hidden="true"><span style={{ width: `${ratio * 100}%` }} /></div>
      <p className="muted" style={{ marginTop: 10 }}>
        {plan.cashMinor === null
          ? 'Add your cash balance to see the full picture.'
          : ratio >= 1
            ? 'Card balance is larger than your cash. A payoff plan can make it feel smaller.'
            : `That is ${Math.round(ratio * 100)}% of your cash. A small weekly payment moves the line.`}
      </p>
      <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={onInsights}>Make a payoff plan</button>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="home" aria-busy="true" aria-label="Loading your money">
      <div className="stack">
        <Skeleton height={54} />
        <Skeleton height={260} />
        <Skeleton height={160} />
      </div>
      <div className="home-grid">
        <Skeleton height={220} />
        <Skeleton height={220} />
      </div>
    </div>
  );
}
