import { useMemo, useState } from 'react';
import { buildFeed, filterFeed, type FeedFilter, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { EmptyState, Icon, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'payments', label: 'Payments' },
  { id: 'spending', label: 'Spending' },
  { id: 'income', label: 'Money in' },
  { id: 'declined', label: 'Declined' },
];

export function ActivityTab({ data, onOpen }: { data: WalletData | null; onOpen: (item: FeedItem) => void }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  const shown = useMemo(() => filterFeed(feed, filter, query), [feed, filter, query]);

  if (!data) return <Skeleton height={420} />;
  const plan = moneyPlan(data.view);
  const month = data.view.patterns?.month;
  const out = month?.spentMinor ?? 0;
  const inn = month?.incomeMinor ?? 0;

  return (
    <div className="activity-page">
      <header className="patterns-head">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Every move, in one place.</h1>
          <p className="page-sub">Payments, logged spends, income and the receipts behind them.</p>
        </div>
        <div className="activity-summary">
          <div><span className="stat-label">Out this month</span><strong className="num">{money(out)}</strong></div>
          <div><span className="stat-label">In this month</span><strong className="num">{money(inn)}</strong></div>
          <div><span className="stat-label">Settle wallet</span><strong className="num">{money(plan.ledgerMinor)}</strong></div>
        </div>
      </header>

      <section className="card activity-card">
        <div className="activity-tools">
          <div className="seg" role="group" aria-label="Filter activity">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="search" htmlFor="activity-search">
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
          <EmptyState title={feed.length === 0 ? 'Nothing here yet' : 'Nothing matches'}>
            {feed.length === 0 ? 'Payments and logged spending show up here, with a receipt for every one.' : 'Try a different filter or a shorter search.'}
          </EmptyState>
        ) : (
          <>
            <p className="hint activity-count">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</p>
            <FeedList items={shown} onOpen={onOpen} dayTotals />
          </>
        )}
      </section>
    </div>
  );
}
