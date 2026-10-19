import { useMemo, type ReactNode } from 'react';
import type { AccountRef, SpendCategory } from '../api.js';
import { categoryMeta } from './categories.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { displayName, greeting, money } from './format.js';
import { moneyPlan } from './money-plan.js';
import type { WalletData } from './data.js';
import { EmptyState, Icon, ProgressRing, Skeleton } from './ui.js';

export interface HomeActions {
  addMoney: () => void;
  logSpend: (preset?: { category?: SpendCategory; amountMinor?: number }) => void;
  logIncome: () => void;
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

export function Home({ me, data, actions, guide }: { me: AccountRef; data: WalletData | null; actions: HomeActions; guide?: ReactNode }) {
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
    <div className="home">
      <header className="hello">
        <div>
          <p className="eyebrow">{greeting()} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>Hi, {displayName(me.owner)}.</h1>
          <p className="page-sub">A calm look at your spending, and one small thing you can do next.</p>
        </div>
        <div className="hello-badges">
          <span className="streak-pill" title="Consecutive days with a logged spend">
            <span aria-hidden="true">🔥</span>
            <strong>{plan.streakDays}</strong>
            <span>{plan.streakDays === 1 ? 'day' : 'days'}</span>
          </span>
          <button type="button" className="icon-btn" onClick={actions.seeWallet} aria-label="Open wallet settings">
            <Icon name="settings" size={19} />
          </button>
        </div>
      </header>

      {guide}

      {plan.hasBaseline ? <MoneyHero plan={plan} actions={actions} /> : <SetupHero actions={actions} />}

      <section className="quick-row" aria-label="Quick actions">
        <button type="button" className="quick quick-primary" onClick={() => actions.logSpend()}>
          <span className="quick-icon"><Icon name="plus" size={22} /></span>
          <span className="quick-copy"><strong>Log spend</strong><small>2 taps</small></span>
        </button>
        <button type="button" className="quick" onClick={actions.addMoney}>
          <span className="quick-icon"><Icon name="bank" size={20} /></span>
          <span className="quick-copy"><strong>Add money</strong><small>to wallet</small></span>
        </button>
        <button type="button" className="quick" onClick={actions.logIncome}>
          <span className="quick-icon"><Icon name="receive" size={20} /></span>
          <span className="quick-copy"><strong>Log income</strong><small>money in</small></span>
        </button>
        <button type="button" className="quick" onClick={() => actions.setup(2)}>
          <span className="quick-icon"><Icon name="target" size={20} /></span>
          <span className="quick-copy"><strong>Weekly pace</strong><small>{plan.budgetMinor === null ? 'set a plan' : 'adjust'}</small></span>
        </button>
      </section>

      <div className="home-grid">
        <div className="stack">
          <WeekCard plan={plan} dots={dots} weekChange={weekChange} onSetup={() => actions.setup(plan.hasBaseline ? 2 : 0)} onInsights={actions.seeInsights} />

          <section className="card" aria-labelledby="recent">
            <div className="card-head">
              <div>
                <p className="eyebrow">The last few things</p>
                <h2 id="recent">Recent</h2>
              </div>
              {feed.length > 0 ? <button type="button" className="link-btn" onClick={actions.seeAll}>See all</button> : null}
            </div>
            {habitFeed.length === 0 ? (
              <EmptyState
                title="A clean page"
                action={<button type="button" className="btn btn-primary" onClick={() => actions.logSpend()}>Log your first spend</button>}
              >
                Log a coffee or add money. Your history starts here.
              </EmptyState>
            ) : (
              <FeedList items={habitFeed.slice(0, 5)} onOpen={actions.openItem} grouped={false} />
            )}
          </section>
        </div>

        <div className="stack">
          <PatternPeek plan={plan} onInsights={actions.seeInsights} onLog={() => actions.logSpend()} />

          <CardCard plan={plan} onInsights={actions.seeInsights} />

          <section className="ask-card" aria-labelledby="ask-home">
            <div className="ask-glow" aria-hidden="true" />
            <p className="eyebrow">Ask, don&apos;t scroll</p>
            <h2 id="ask-home">A question about your money?</h2>
            <p className="ask-lede">The assistant reads your records. It can&apos;t move money.</p>
            <div className="chips">
              <button type="button" className="chip chip-on-dark" onClick={() => actions.ask('Where did most of my money go this month?')}>Where did it go?</button>
              <button type="button" className="chip chip-on-dark" onClick={() => actions.ask('Can I afford a $60 night out this week?')}>Can I afford it?</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MoneyHero({ plan, actions }: { plan: ReturnType<typeof moneyPlan>; actions: HomeActions }) {
  const net = plan.netMinor ?? plan.ledgerMinor;
  const left = plan.weekLeftMinor;
  return (
    <section className="hero-card" aria-labelledby="net-label">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-top">
        <div>
          <p className="hero-label" id="net-label">Net position</p>
          <p className="hero-amount num" aria-live="polite">{money(net)}</p>
          <p className="hero-sub">
            {plan.cashMinor === null ? 'Cash not set yet' : `${money(plan.cashMinor)} cash`}
            {plan.creditMinor > 0 ? <> · <span className="hero-debt">{money(plan.creditMinor)} on cards</span></> : ' · no card balance'}
          </p>
        </div>
        <span className="hero-chip"><Icon name="lock" size={14} /> Private</span>
      </div>

      <div className="hero-bottom">
        <div className="hero-week">
          <ProgressRing
            value={plan.budgetMinor === null ? 0 : plan.weekProgress}
            tone="onDark"
            size={96}
            stroke={8}
            label={plan.budgetMinor === null ? 'No weekly plan yet' : `${Math.round(plan.weekProgress * 100)} percent of weekly plan used`}
          >
            <strong>{left === null ? '—' : money(left)}</strong>
            <span>left</span>
          </ProgressRing>
          <div>
            <p className="hero-week-title">{plan.budgetMinor === null ? 'No weekly pace yet' : 'Left this week'}</p>
            <p className="hero-week-sub">
              {plan.budgetMinor === null
                ? 'Set a gentle number to make the rest of the week feel lighter.'
                : `${money(plan.weekSpentMinor)} of ${money(plan.budgetMinor)} used`}
            </p>
            {plan.budgetMinor === null ? (
              <button type="button" className="hero-link" onClick={() => actions.setup(2)}>Set a plan →</button>
            ) : null}
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-mini">
            <span>Logged this month</span>
            <strong className="num">{money(plan.patterns?.month.spentMinor ?? 0)}</strong>
          </div>
          <button type="button" className="hero-link" onClick={actions.seeInsights}>See your patterns →</button>
        </div>
      </div>
    </section>
  );
}

function SetupHero({ actions }: { actions: HomeActions }) {
  return (
    <section className="hero-card hero-setup" aria-labelledby="setup-title">
      <div className="hero-grid" aria-hidden="true" />
      <p className="hero-label">Your starting point</p>
      <h2 id="setup-title">Three numbers. Then the app does the math.</h2>
      <p className="hero-setup-lede">Cash, card balance, and a weekly pace. No bank login, no spreadsheet, no guilt.</p>
      <div className="setup-preview">
        <div><span>💵</span><strong>Cash</strong><small>what you can spend</small></div>
        <div><span>💳</span><strong>Cards</strong><small>what you owe</small></div>
        <div><span>🎯</span><strong>Pace</strong><small>a kind weekly guide</small></div>
      </div>
      <button type="button" className="btn btn-lime" onClick={() => actions.setup(0)}>Set up in 30 seconds</button>
      <p className="hero-footnote">Or skip — you can log spends without a baseline.</p>
    </section>
  );
}

function WeekCard({
  plan,
  dots,
  weekChange,
  onSetup,
  onInsights,
}: {
  plan: ReturnType<typeof moneyPlan>;
  dots: { key: string; label: string; logged: boolean; today: boolean }[];
  weekChange: number;
  onSetup: () => void;
  onInsights: () => void;
}) {
  const over = plan.overBudget;
  return (
    <section className={`card week-card${over ? ' is-over' : ''}`} aria-labelledby="week-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">The rhythm</p>
          <h2 id="week-title">This week</h2>
        </div>
        <button type="button" className="link-btn" onClick={onInsights}>Patterns</button>
      </div>
      {plan.budgetMinor === null ? (
        <div className="week-empty">
          <p><strong>Give the week a shape.</strong> Pick a comfortable number and we&apos;ll show what&apos;s left.</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={onSetup}>Set a weekly pace</button>
        </div>
      ) : (
        <>
          <div className="week-line">
            <span className="week-big num">{money(plan.weekSpentMinor)}</span>
            <span className="muted">of {money(plan.budgetMinor)}</span>
            <span className={`pill ${over ? 'pill-bad' : 'pill-good'}`}>{over ? 'over pace' : 'on pace'}</span>
          </div>
          <div className="week-track" role="progressbar" aria-valuemin={0} aria-valuemax={plan.budgetMinor} aria-valuenow={Math.min(plan.weekSpentMinor, plan.budgetMinor)}>
            <span className={over ? 'is-over' : ''} style={{ width: `${Math.min(100, plan.weekProgress * 100)}%` }} />
          </div>
          <p className="week-copy">
            {over
              ? `You're ${money(plan.weekSpentMinor - plan.budgetMinor)} past the plan. No drama — adjust it or take a lighter day.`
              : `${money(plan.weekLeftMinor ?? 0)} left. ${weekChange > 0 ? `${money(weekChange)} more than last week.` : weekChange < 0 ? `${money(-weekChange)} less than last week.` : 'Same pace as last week.'}`}
          </p>
        </>
      )}
      <div className="week-dots" aria-label="Last seven days">
        {dots.map((dot) => (
          <span key={dot.key} className={`week-dot${dot.logged ? ' is-on' : ''}${dot.today ? ' is-today' : ''}`}>
            <span className="week-dot-fill" />
            <span className="week-dot-label">{dot.label}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function PatternPeek({ plan, onInsights, onLog }: { plan: ReturnType<typeof moneyPlan>; onInsights: () => void; onLog: () => void }) {
  const categories = plan.patterns?.categories ?? [];
  const top = categories[0];
  if (!top) {
    return (
      <section className="card pattern-peek" aria-labelledby="pattern-title">
        <div className="card-head">
          <div><p className="eyebrow">Patterns</p><h2 id="pattern-title">Your money has a shape</h2></div>
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
  return (
    <section className="card pattern-peek" aria-labelledby="pattern-title">
      <div className="card-head">
        <div><p className="eyebrow">Patterns</p><h2 id="pattern-title">Where it went</h2></div>
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
          <div><p className="eyebrow">Cards</p><h2 id="card-title">Clean slate</h2></div>
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
        <div><p className="eyebrow">Cards</p><h2 id="card-title">What you owe</h2></div>
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
