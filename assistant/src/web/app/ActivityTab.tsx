import { useMemo, useState } from 'react';
import './styles/views.css';
import { dailySeries } from '../chart-data.js';
import { buildFeed, filterFeed, type FeedFilter, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { money } from './format.js';
import { monthIncomeSummary } from './money-plan.js';
import { EmptyState, Icon, Skeleton, Sparkline } from './ui.js';
import type { WalletData } from './data.js';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'spending', label: 'Spending' },
  { id: 'income', label: 'Money in' },
  { id: 'payments', label: 'Ledger' },
  { id: 'declined', label: 'Declined' },
];

export function ActivityTab({ data, onOpen }: { data: WalletData | null; onOpen: (item: FeedItem) => void }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  const shown = useMemo(() => filterFeed(feed, filter, query), [feed, filter, query]);
  const income = useMemo(() => monthIncomeSummary(data?.view), [data]);

  if (!data) return <ActivitySkeleton />;
  const patterns = data.view.patterns;
  const month = patterns?.month;
  const out = month?.spentMinor ?? 0;
  const days = patterns?.days ?? [];
  const spendTrend = dailySeries(days, 'spendMinor');
  const incomeTrend = dailySeries(days, 'incomeMinor');

  return (
    <div className="v-view">
      <header className="v-head">
        <h1 className="v-title">Transactions</h1>
        <p className="v-sub">Logged spending, income and ledger entries.</p>
      </header>

      <section className="v-figs v-figs-3" aria-label="This month">
        <div className="v-fig glass">
          <p className="v-fig-label">Out this month</p>
          <p className="v-fig-value num">{money(out)}</p>
          <Sparkline values={spendTrend} tone="neg" label="Daily spend over the last 30 days" />
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">{income.label}</p>
          <p className="v-fig-value num is-pos">{money(income.minor)}</p>
          <Sparkline values={incomeTrend} tone="pos" label="Logged income over the last 30 days" />
          <p className="v-fig-note">{income.note}</p>
        </div>
        <div className="v-fig glass">
          <p className="v-fig-label">Active days in the last 30</p>
          <p className="v-fig-value num">{patterns?.totals.activeDays30d ?? 0}</p>
        </div>
      </section>

      <section className="v-panel glass" data-tour="transactions-list">
        <div className="v-toolbar">
          <div className="v-seg" role="group" aria-label="Filter activity">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="v-search" htmlFor="activity-search">
            <Icon name="search" size={16} />
            <input
              id="activity-search"
              type="search"
              placeholder="Search a name or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {shown.length === 0 ? (
          <EmptyState icon={feed.length === 0 ? 'list' : 'search'} title={feed.length === 0 ? 'Nothing here yet' : 'Nothing matches'}>
            {feed.length === 0
              ? 'Logged spending and ledger entries show up here, with a receipt on every one.'
              : 'Try a different filter or a shorter search.'}
          </EmptyState>
        ) : (
          <>
            <p className="v-count">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</p>
            <div key={filter} className="v-feed"><FeedList items={shown} onOpen={onOpen} dayTotals /></div>
          </>
        )}
      </section>
    </div>
  );
}

/** A composed skeleton: the same header, figure strip and panel the view lands on. */
function ActivitySkeleton() {
  return (
    <div className="v-view v-skeleton" aria-busy="true" aria-label="Loading transactions">
      <div className="v-head">
        <Skeleton height={28} width={190} />
        <Skeleton height={13} width={280} />
      </div>
      <div className="v-figs v-figs-3">
        {[0, 1, 2].map((cell) => (
          <div className="v-fig glass" key={cell}>
            <Skeleton height={12} width="60%" />
            <Skeleton height={28} width="75%" />
            <Skeleton height={24} />
          </div>
        ))}
      </div>
      <section className="v-panel glass">
        <Skeleton height={36} />
        <div style={{ marginTop: 16 }}><Skeleton height={340} /></div>
      </section>
    </div>
  );
}
