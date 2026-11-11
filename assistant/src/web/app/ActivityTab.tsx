import { useMemo, useState } from 'react';
import './styles/views.css';
import { buildFeed, filterFeed, type FeedFilter, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { money } from './format.js';
import { Icon, Skeleton } from './ui.js';
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

  if (!data) return <Skeleton height={420} />;
  const patterns = data.view.patterns;
  const month = patterns?.month;
  const out = month?.spentMinor ?? 0;
  const inn = month?.incomeMinor ?? 0;

  return (
    <div className="v-view">
      <header className="v-head">
        <h1 className="v-title">Transactions</h1>
        <p className="v-sub">Logged spending, income and ledger entries.</p>
      </header>

      <section className="v-figs v-figs-3" aria-label="This month">
        <div className="v-fig">
          <p className="v-fig-label">Out this month</p>
          <p className="v-fig-value num">{money(out)}</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">In this month</p>
          <p className="v-fig-value num">{money(inn)}</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Active days in the last 30</p>
          <p className="v-fig-value num">{patterns?.totals.activeDays30d ?? 0}</p>
        </div>
      </section>

      <section className="v-panel">
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
          <div className="v-empty">
            <p className="v-empty-title">{feed.length === 0 ? 'Nothing here yet' : 'Nothing matches'}</p>
            <p>{feed.length === 0 ? 'Logged spending and ledger entries show up here, with a receipt on every one.' : 'Try a different filter or a shorter search.'}</p>
          </div>
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
