import { useMemo } from 'react';
import type { AccountRef } from '../api.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { IncomingRequests, OutgoingRequests } from './Requests.js';
import { declineCopy } from './copy.js';
import { categoryLabel } from './SimpleSheets.js';
import { displayName, money, parseMoney } from './format.js';
import { Avatar, EmptyState, Icon, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

export interface HomeActions {
  send: (to?: AccountRef) => void;
  split: () => void;
  addMoney: () => void;
  logSpend: () => void;
  openItem: (item: FeedItem) => void;
  seeAll: () => void;
  seeInsights: () => void;
  reload: () => void;
}

export function Home({ me, data, actions }: { me: AccountRef; data: WalletData | null; actions: HomeActions }) {
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  if (!data) return <HomeSkeleton />;

  const { view, requests, peers, friends } = data;
  const pendingIn = requests.incoming.filter((r) => r.status === 'PENDING');
  const pendingOut = requests.outgoing.filter((r) => r.status === 'PENDING');
  const latestDecline = feed.find((i) => i.kind === 'declined' && i.signedMinor < 0
    && Date.now() - Date.parse(i.occurredAt) < 7 * 86_400_000);
  const declineText = latestDecline ? declineCopy(latestDecline.declineReason, latestDecline.declineExplanation) : null;
  const topCategories = view.habits?.summary30d.byCategory.slice(0, 3) ?? [];
  const maxCat = Math.max(1, ...topCategories.map((c) => parseMoney(c.total) ?? 0));

  return (
    <div className="grid-2">
      <div className="stack">
        <section className="card balance-card" aria-labelledby="bal-label">
          <p className="balance-label" id="bal-label">Wallet balance</p>
          <p className="balance num" aria-live="polite">{view.balance}</p>
          <p style={{ opacity: 0.85 }}>{displayName(view.owner)}&apos;s wallet · {view.currency}</p>
          <div className="actions">
            <button type="button" className="action" onClick={() => actions.send()}>
              <span className="action-icon"><Icon name="send" /></span>Send
            </button>
            <button type="button" className="action" onClick={actions.split}>
              <span className="action-icon"><Icon name="split" /></span>Split
            </button>
            <button type="button" className="action" onClick={actions.addMoney}>
              <span className="action-icon"><Icon name="bank" /></span>Add
            </button>
            <button type="button" className="action" onClick={actions.logSpend}>
              <span className="action-icon"><Icon name="pencil" /></span>Log
            </button>
          </div>
        </section>

        {pendingIn.length > 0 ? (
          <section className="card" aria-labelledby="needs-you">
            <div className="card-head">
              <h2 id="needs-you">Needs your answer</h2>
              <span className="pill pill-warn">{pendingIn.length} open</span>
            </div>
            <IncomingRequests requests={pendingIn} me={me.id} onChanged={actions.reload} />
          </section>
        ) : null}

        {latestDecline && declineText ? (
          <section className="notice notice-bad stack-sm" aria-label="A payment did not go through">
            <p><strong>A payment did not go through:</strong> {money(Math.abs(latestDecline.signedMinor))} to {displayName(latestDecline.counterparty ?? '')}. No money moved.</p>
            <p>{declineText.why}</p>
            <div className="row-wrap">
              <button type="button" className="btn btn-sm" onClick={() => actions.openItem(latestDecline)}>See details</button>
            </div>
          </section>
        ) : null}

        {pendingOut.length > 0 ? (
          <section className="card" aria-labelledby="waiting">
            <div className="card-head"><h2 id="waiting">Waiting on friends</h2></div>
            <OutgoingRequests requests={pendingOut} me={me.id} onChanged={actions.reload} />
          </section>
        ) : null}

        <section className="card" aria-labelledby="recent">
          <div className="card-head">
            <h2 id="recent">Recent activity</h2>
            {feed.length > 6 ? <button type="button" className="link-btn" onClick={actions.seeAll}>See all</button> : null}
          </div>
          {feed.length === 0 ? (
            <EmptyState title="Nothing yet" action={<button type="button" className="btn btn-primary" onClick={actions.addMoney}>Add money to start</button>}>
              Add money, then send some to a friend. Each payment shows up here with a receipt.
            </EmptyState>
          ) : (
            <FeedList items={feed.slice(0, 6)} onOpen={actions.openItem} grouped={false} />
          )}
        </section>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="month">
          <div className="card-head">
            <h2 id="month">This month</h2>
            <button type="button" className="link-btn" onClick={actions.seeInsights}>Insights</button>
          </div>
          <div className="stat-grid">
            <div className="stat"><p className="stat-value">{view.finance?.periodTotals.spent ?? '$0.00'}</p><p className="stat-label">Spent (logged)</p></div>
            <div className="stat"><p className="stat-value">{view.finance?.periodTotals.income ?? '$0.00'}</p><p className="stat-label">Income (logged)</p></div>
          </div>
          {topCategories.length > 0 ? (
            <div className="bars" style={{ marginTop: 16 }}>
              {topCategories.map((c) => (
                <div key={c.category} className="bar-row">
                  <span>{categoryLabel(c.category)}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(6, ((parseMoney(c.total) ?? 0) / maxCat) * 100)}%`, display: 'block' }} /></span>
                  <span className="num">{c.total}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              Nothing logged yet. <button type="button" className="link-btn" onClick={actions.logSpend}>Log a spend</button> to see where it goes.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="friends">
          <div className="card-head"><h2 id="friends">Friends</h2></div>
          {peers.length === 0 ? (
            <p className="muted">People you pay or who pay you appear here.</p>
          ) : (
            <ul className="list">
              {peers.map((p) => {
                const f = friends[p.id];
                return (
                  <li key={p.id}>
                    <button type="button" className="item" onClick={() => actions.send(p)} aria-label={`Send money to ${displayName(p.owner)}`}>
                      <Avatar owner={p.owner} />
                      <span className="item-body">
                        <span className="item-title" style={{ display: 'block' }}>{displayName(p.owner)}</span>
                        <span className="item-sub" style={{ display: 'block' }}>
                          {f ? `30 days: you sent ${f.sentToPeer}, got ${f.receivedFromPeer}` : 'No recent payments'}
                        </span>
                      </span>
                      <span className="faint"><Icon name="chevron" size={18} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid-2" aria-busy="true" aria-label="Loading your wallet">
      <div className="stack"><Skeleton height={210} /><Skeleton height={260} /></div>
      <div className="stack"><Skeleton height={200} /><Skeleton height={160} /></div>
    </div>
  );
}
