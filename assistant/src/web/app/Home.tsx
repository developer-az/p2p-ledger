import { useMemo, useState } from 'react';
import './styles/views.css';
import type { AccountRef, SpendCategory } from '../api.js';
import { categoryLabel } from './categories.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { money } from './format.js';
import { moneyPlan } from './money-plan.js';
import type { WalletData } from './data.js';
import { Icon, Skeleton } from './ui.js';

export interface HomeActions {
  logSpend: (preset?: { category?: SpendCategory; amountMinor?: number }) => void;
  logIncome: () => void;
  ask: (question?: string) => void;
  openItem: (item: FeedItem) => void;
  seeAll: () => void;
  seeInsights: () => void;
  seeWallet: () => void;
  setup: (step?: 0 | 1 | 2) => void;
}

export function Home({ me, name, data, actions }: { me: AccountRef; name?: string; data: WalletData | null; actions: HomeActions }) {
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  if (!data) return <HomeSkeleton />;

  const plan = moneyPlan(data.view);
  const patterns = plan.patterns;
  const monthSpent = patterns?.month.spentMinor ?? 0;
  const previousSpent = patterns?.totals.spendPrev30dMinor ?? 0;
  const monthDelta = monthSpent - previousSpent;
  const categories = (patterns?.categories ?? []).slice(0, 5);
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="v-view">
      <header className="v-head">
        <h1 className="v-title">Overview</h1>
        <p className="v-sub">{dateLine}</p>
      </header>

      {plan.hasBaseline ? <FigureStrip plan={plan} actions={actions} /> : <StartingPoint actions={actions} />}

      <AskBar onAsk={actions.ask} />

      <div className="v-grid">
        <section className="v-panel glass" aria-labelledby="recent-title">
          <div className="v-panel-head">
            <h2 id="recent-title">Recent transactions</h2>
            <button type="button" className="v-link" onClick={actions.seeAll}>View all</button>
          </div>
          {feed.length === 0 ? (
            <div className="v-empty">
              <p className="v-empty-title">No transactions yet</p>
              <p>Log a spend or some income to see it here.</p>
            </div>
          ) : (
            <FeedList items={feed.slice(0, 8)} onOpen={actions.openItem} grouped={false} />
          )}
        </section>

        <div className="v-side">
          <section className="v-panel glass" aria-labelledby="month-title">
            <div className="v-panel-head">
              <h2 id="month-title">This month</h2>
            </div>
            <p className="v-month-value num">{money(monthSpent)}</p>
            <p className="v-compare">
              vs {money(previousSpent)} in the previous 30 days
              {monthDelta !== 0 ? (
                <span className={monthDelta < 0 ? 'is-pos' : 'is-neg'}>
                  {' '}{monthDelta < 0 ? '↓' : '↑'} {money(Math.abs(monthDelta))}
                </span>
              ) : null}
            </p>
          </section>

          <section className="v-panel glass" aria-labelledby="categories-title">
            <div className="v-panel-head">
              <h2 id="categories-title">Top categories</h2>
              <button type="button" className="v-link" onClick={actions.seeInsights}>Open Insights</button>
            </div>
            {categories.length === 0 ? (
              <p className="v-empty">No category spending in the last 30 days.</p>
            ) : (
              <ul className="v-cats">
                {categories.map((category) => (
                  <li className="v-cat" key={category.category}>
                    <span className="v-cat-label">{categoryLabel(category.category)}</span>
                    <span className="v-cat-amount num">{money(category.totalMinor)}</span>
                    <span className="v-cat-track" aria-hidden="true">
                      <span className="v-cat-bar" style={{ width: `${Math.min(100, category.sharePct)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function FigureStrip({ plan, actions }: { plan: ReturnType<typeof moneyPlan>; actions: HomeActions }) {
  const net = plan.netMinor ?? plan.ledgerMinor;
  const budget = plan.budgetMinor;
  return (
    <section className="v-figs" aria-label="Money position" data-tour="overview-figures">
      <div className="v-fig glass">
        <p className="v-fig-label">Net position</p>
        <p className={`v-fig-value num${net < 0 ? ' is-neg' : ''}`}>{money(net)}</p>
      </div>
      <div className="v-fig glass">
        <p className="v-fig-label">Cash</p>
        {plan.cashMinor === null
          ? <p className="v-fig-value is-muted">Not set</p>
          : <p className="v-fig-value num">{money(plan.cashMinor)}</p>}
      </div>
      <div className="v-fig glass">
        <p className="v-fig-label">On cards</p>
        <p className={`v-fig-value num${plan.creditMinor > 0 ? ' is-neg' : ''}`}>{money(plan.creditMinor)}</p>
      </div>
      <div className="v-fig glass">
        <p className="v-fig-label">Left this week</p>
        {budget === null ? (
          <p className="v-fig-value is-muted">
            No weekly plan
            <button type="button" className="v-link" onClick={() => actions.setup(2)}>Set a plan</button>
          </p>
        ) : plan.overBudget ? (
          <p className="v-fig-value num is-neg">
            {money(plan.weekSpentMinor - budget)} <span className="v-fig-note">over {money(budget)}</span>
          </p>
        ) : (
          <p className="v-fig-value num">
            {money(plan.weekLeftMinor ?? 0)} <span className="v-fig-note">of {money(budget)}</span>
          </p>
        )}
      </div>
    </section>
  );
}

function StartingPoint({ actions }: { actions: HomeActions }) {
  return (
    <section className="v-panel v-setup glass" aria-labelledby="setup-title">
      <h2 id="setup-title">Set your starting point</h2>
      <p>Add your cash, card balance and a weekly pace; Settle uses those three numbers for every total on this page.</p>
      <button type="button" className="v-btn v-btn-primary" onClick={() => actions.setup(0)}>Set up your baseline</button>
    </section>
  );
}

/** One worked example, kept as the ask bar's placeholder. It does not cycle. */
const ASK_EXAMPLE = 'Where did most of my money go this month?';

function AskBar({ onAsk }: { onAsk: (question?: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <form className="v-ask" role="search" onSubmit={(e) => { e.preventDefault(); onAsk(q.trim() || ASK_EXAMPLE); }}>
      <label htmlFor="ask-bar" className="sr-only">Ask about your money</label>
      <input id="ask-bar" placeholder={ASK_EXAMPLE} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <button type="submit" className="v-ask-go" aria-label="Ask">
        <Icon name="arrowUp" size={16} />
      </button>
    </form>
  );
}

function HomeSkeleton() {
  return (
    <div className="v-view v-skeleton" aria-busy="true" aria-label="Loading your money">
      <div className="v-head">
        <Skeleton height={28} width={160} />
        <Skeleton height={13} width={220} />
      </div>
      <div className="v-figs">
        {[0, 1, 2, 3].map((cell) => (
          <div className="v-fig glass" key={cell}>
            <Skeleton height={12} width="55%" />
            <Skeleton height={28} width="80%" />
          </div>
        ))}
      </div>
      <Skeleton height={38} />
      <div className="v-grid">
        <section className="v-panel glass"><Skeleton height={280} /></section>
        <div className="v-side">
          <section className="v-panel glass"><Skeleton height={116} /></section>
          <section className="v-panel glass"><Skeleton height={168} /></section>
        </div>
      </div>
    </div>
  );
}
