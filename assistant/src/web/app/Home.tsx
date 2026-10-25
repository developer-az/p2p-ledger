import { useMemo, type ReactNode } from 'react';
import type { AccountRef, SpendCategory } from '../api.js';
import { CategoryBars } from './CategoryBars.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { displayName, greeting, money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { NeedsYouCard } from './SettleUp.js';
import type { WalletData } from './data.js';
import { EmptyState, Icon, PunchRow, Skeleton, type PunchSlot } from './ui.js';

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

/** The last seven days as punch slots: a logged day is stamped, today is the open slot. */
function weekSlots(days: { date: string; count: number }[], todayKey: string): PunchSlot[] {
  return days.slice(-7).map((day) => {
    const date = new Date(`${day.date}T00:00:00`);
    const long = date.toLocaleDateString('en-US', { weekday: 'long' });
    return {
      key: day.date,
      label: date.toLocaleDateString('en-US', { weekday: 'narrow' }),
      stamped: day.count > 0,
      today: day.date === todayKey,
      title: `${day.date === todayKey ? 'Today' : long}: ${day.count > 0 ? `${day.count} ${day.count === 1 ? 'log' : 'logs'}` : 'nothing logged'}`,
    };
  });
}

export function Home({ me, data, actions, guide }: { me: AccountRef; data: WalletData | null; actions: HomeActions; guide?: ReactNode }) {
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  if (!data) return <HomeSkeleton />;

  const { view } = data;
  const plan = moneyPlan(view);
  const habitFeed = feed.filter((item) => item.kind === 'spend' || item.kind === 'income');
  const slots = plan.patterns ? weekSlots(plan.patterns.days, plan.patterns.week.end) : [];
  const weekChange = plan.patterns
    ? plan.patterns.week.spentMinor - plan.patterns.week.lastWeekSpentMinor
    : 0;

  return (
    <div className="home stagger-in">
      <header className="hello">
        <div>
          <p className="eyebrow">{greeting()} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>Hi, {displayName(me.owner)}.</h1>
          <p className="page-sub">Stamp the day. Fill the week. Know your money.</p>
        </div>
        <div className="hello-badges">
          <span className="streak-pill" title="Consecutive days with a logged spend">
            <span className="streak-mark" aria-hidden="true" />
            <strong className="num">{plan.streakDays}</strong>
            <span>{plan.streakDays === 1 ? 'day' : 'days'}</span>
          </span>
          <button type="button" className="icon-btn" onClick={actions.seeWallet} aria-label="Open wallet settings">
            <Icon name="settings" size={19} />
          </button>
        </div>
      </header>

      {guide}

      {plan.hasBaseline ? <MoneyHero plan={plan} slots={slots} actions={actions} /> : <SetupHero slots={slots} actions={actions} />}

      <section className="quick-row" aria-label="Log or plan">
        <button type="button" className="quick quick-primary" onClick={() => actions.logSpend()}>
          <span className="quick-icon"><Icon name="plus" size={18} /></span>
          <span className="quick-copy"><strong>Log a spend</strong><small>Stamp today in two taps</small></span>
        </button>
        <button type="button" className="quick" onClick={actions.logIncome}>
          <span className="quick-icon"><Icon name="arrowDown" size={18} /></span>
          <span className="quick-copy"><strong>Money came in</strong><small>Paycheck, side gig, refund</small></span>
        </button>
        <button type="button" className="quick" onClick={actions.settleUp}>
          <span className="quick-icon"><Icon name="split" size={18} /></span>
          <span className="quick-copy"><strong>Split with someone</strong><small>Who owes who</small></span>
        </button>
        <button type="button" className="quick" onClick={() => actions.setup(2)}>
          <span className="quick-icon"><Icon name="target" size={18} /></span>
          <span className="quick-copy"><strong>Weekly pace</strong><small>{plan.budgetMinor === null ? 'Set a number' : `${money(plan.budgetMinor)} a week`}</small></span>
        </button>
      </section>

      <div className="home-grid">
        <div className="stack">
          <NeedsYouCard me={me} onOpen={actions.settleUp} />

          <WeekCard plan={plan} weekChange={weekChange} onSetup={() => actions.setup(plan.hasBaseline ? 2 : 0)} onInsights={actions.seeInsights} />

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
                title="Nothing logged yet"
                action={<button type="button" className="btn btn-primary" onClick={() => actions.logSpend()}>Log a coffee or lunch</button>}
              >
                One log stamps today and starts your week. It takes about five seconds.
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
              <button type="button" className="chip chip-on-dark" onClick={() => actions.ask('Can I afford a $60 night out this week?')}>Can I afford $60 out?</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The money piece: obsidian card stock with the gothic marque and this week's punches. */
function MoneyHero({ plan, slots, actions }: { plan: ReturnType<typeof moneyPlan>; slots: PunchSlot[]; actions: HomeActions }) {
  const net = plan.netMinor ?? plan.ledgerMinor;
  const projected = plan.projectedCashMinor ?? plan.cashMinor;
  const stamped = slots.filter((s) => s.stamped).length;
  return (
    <section className="hero-card" aria-labelledby="net-label">
      <div className="hero-grid" aria-hidden="true" />
      <span className="hero-marque" aria-hidden="true">S</span>
      <div className="hero-top">
        <div>
          <p className="hero-label" id="net-label">Net position</p>
          <p className="hero-amount num" aria-live="polite">{money(net)}</p>
          <p className="hero-sub">
            {plan.cashMinor === null ? (
              'Cash not set yet'
            ) : plan.periodIncomeMinor > 0 || plan.periodSpentMinor > 0 ? (
              <>
                {money(projected ?? 0)} projected: {money(plan.cashMinor)} cash
                {plan.periodIncomeMinor > 0 ? <> + {money(plan.periodIncomeMinor)} in</> : null}
                {plan.periodSpentMinor > 0 ? <> − {money(plan.periodSpentMinor)} logged</> : null}
                {plan.creditMinor > 0 ? <> · <span className="hero-debt">{money(plan.creditMinor)} on cards</span></> : null}
              </>
            ) : (
              <>
                {money(plan.cashMinor)} cash
                {plan.creditMinor > 0 ? <> · <span className="hero-debt">{money(plan.creditMinor)} on cards</span></> : ' · no card balance'}
              </>
            )}
          </p>
        </div>
        <div className="hero-side">
          <span className="hero-mini-label">Left this week</span>
          <strong className="hero-mini num">{plan.weekLeftMinor === null ? '—' : money(plan.weekLeftMinor)}</strong>
          {plan.budgetMinor === null ? (
            <button type="button" className="hero-link" onClick={() => actions.setup(2)}>Set a weekly pace</button>
          ) : (
            <span className="hero-mini-sub">of {money(plan.budgetMinor)}</span>
          )}
        </div>
      </div>

      <div className="hero-bottom">
        <div className="hero-week">
          <p className="hero-week-title">
            <span>This week&apos;s card</span>
            <span className="num">{stamped}/7</span>
          </p>
          <PunchRow slots={slots} size="lg" label={`This week: ${stamped} of 7 days logged`} />
        </div>
        <button type="button" className="btn btn-on-stock btn-lg" onClick={() => actions.logSpend()}>
          <Icon name="plus" size={18} /> Log a spend
        </button>
      </div>
    </section>
  );
}

function SetupHero({ slots, actions }: { slots: PunchSlot[]; actions: HomeActions }) {
  return (
    <section className="hero-card hero-setup" aria-labelledby="setup-title">
      <div className="hero-grid" aria-hidden="true" />
      <span className="hero-marque" aria-hidden="true">S</span>
      <p className="hero-label">Get set</p>
      <h2 id="setup-title">Three numbers, then the app does the math.</h2>
      <p className="hero-setup-lede">Cash, card balance and a weekly pace. No bank login and no spreadsheet.</p>
      <div className="setup-preview">
        <div><Icon name="cash" size={18} /><strong>Cash</strong><small>what you can spend</small></div>
        <div><Icon name="card" size={18} /><strong>Cards</strong><small>what you owe</small></div>
        <div><Icon name="target" size={18} /><strong>Pace</strong><small>a weekly guide</small></div>
      </div>
      {slots.length > 0 ? <PunchRow slots={slots} size="lg" label="This week's logging" /> : null}
      <div className="hero-actions">
        <button type="button" className="btn btn-on-stock btn-lg" onClick={() => actions.setup(0)}>Set up in 30 seconds</button>
        <button type="button" className="btn btn-ghost-stock btn-lg" onClick={() => actions.logSpend()}>Log a spend first</button>
      </div>
    </section>
  );
}

function WeekCard({
  plan,
  weekChange,
  onSetup,
  onInsights,
}: {
  plan: ReturnType<typeof moneyPlan>;
  weekChange: number;
  onSetup: () => void;
  onInsights: () => void;
}) {
  const over = plan.overBudget;
  return (
    <section className={`card week-card${over ? ' is-over' : ''}`} aria-labelledby="week-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">Pace</p>
          <h2 id="week-title">Weekly pace</h2>
        </div>
        <button type="button" className="link-btn" onClick={onInsights}>Patterns</button>
      </div>
      {plan.budgetMinor === null ? (
        <div className="week-empty">
          <p>Pick a comfortable number for the week and Settle shows what is left after every log.</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={onSetup}>Set a weekly pace</button>
        </div>
      ) : (
        <>
          <div className="week-line">
            <span className="week-big num">{money(plan.weekSpentMinor)}</span>
            <span className="muted">of {money(plan.budgetMinor)}</span>
            <span className={`pill ${over ? 'pill-bad' : 'pill-good'}`}>{over ? 'Over pace' : 'On pace'}</span>
          </div>
          <div className="week-track" role="progressbar" aria-label="Weekly pace used" aria-valuemin={0} aria-valuemax={plan.budgetMinor} aria-valuenow={Math.min(plan.weekSpentMinor, plan.budgetMinor)}>
            <span className={over ? 'is-over' : ''} style={{ width: `${Math.min(100, plan.weekProgress * 100)}%` }} />
          </div>
          <p className="week-copy">
            {over
              ? `${money(plan.weekSpentMinor - plan.budgetMinor)} past the pace. Adjust the number or take a lighter day.`
              : `${money(plan.weekLeftMinor ?? 0)} left. ${weekChange > 0 ? `${money(weekChange)} more than this point last week.` : weekChange < 0 ? `${money(-weekChange)} less than this point last week.` : 'Same as this point last week.'}`}
          </p>
        </>
      )}
    </section>
  );
}

/** Where the money went, as one-hue bars: the top category in full ink, the rest stepped back. */
function PatternPeek({ plan, onInsights, onLog }: { plan: ReturnType<typeof moneyPlan>; onInsights: () => void; onLog: () => void }) {
  const categories = plan.patterns?.categories ?? [];
  const top = categories[0];
  if (!top) {
    return (
      <section className="card pattern-peek" aria-labelledby="pattern-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Patterns</p>
            <h2 id="pattern-title">Where it went</h2>
          </div>
        </div>
        <p className="muted">One log is enough to start seeing it. No bank connection.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={onLog}>Log a spend</button>
      </section>
    );
  }
  const max = Math.max(1, ...categories.slice(0, 4).map((c) => c.totalMinor));
  return (
    <section className="card pattern-peek" aria-labelledby="pattern-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">Patterns</p>
          <h2 id="pattern-title">Where it went</h2>
          <p className="card-sub">Last 30 days{plan.patterns ? ` · ${plan.patterns.totals.activeDays30d} active days` : ''}</p>
        </div>
        <button type="button" className="link-btn" onClick={onInsights}>See all</button>
      </div>
      <CategoryBars categories={categories.slice(0, 4)} max={max} />
    </section>
  );
}

function CardCard({ plan, onInsights }: { plan: ReturnType<typeof moneyPlan>; onInsights: () => void }) {
  if (plan.creditMinor <= 0) {
    return (
      <section className="card" aria-labelledby="card-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Credit</p>
            <h2 id="card-title">Cards</h2>
          </div>
          <span className="pill pill-good">$0 owed</span>
        </div>
        <p className="muted">No card balance tracked. If that changes, add it in Wallet and Settle builds a payoff path.</p>
      </section>
    );
  }
  const ratio = plan.cashMinor === null ? 0 : plan.cashMinor > 0 ? Math.min(1, plan.creditMinor / plan.cashMinor) : 1;
  return (
    <section className="card" aria-labelledby="card-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">Credit</p>
          <h2 id="card-title">Cards</h2>
        </div>
        <span className="amount num">{money(plan.creditMinor)}</span>
      </div>
      <div className={`credit-track${ratio >= 1 ? ' is-over' : ''}`} aria-hidden="true"><span style={{ width: `${ratio * 100}%` }} /></div>
      <p className="muted card-note">
        {plan.cashMinor === null
          ? 'Add your cash balance to see the full picture.'
          : ratio >= 1
            ? 'Your card balance is larger than your cash. A payoff plan breaks it into weeks.'
            : `${Math.round(ratio * 100)}% of your cash. A small weekly payment moves the line.`}
      </p>
      <button type="button" className="btn btn-sm" onClick={onInsights}>Make a payoff plan</button>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="home" aria-busy="true" aria-label="Loading your money">
      <div className="stack">
        <Skeleton height={54} />
        <Skeleton height={260} />
        <Skeleton height={64} />
      </div>
      <div className="home-grid">
        <Skeleton height={220} />
        <Skeleton height={220} />
      </div>
    </div>
  );
}
