import { categoryLabel } from './SimpleSheets.js';
import { changeWords, money, parseMoney } from './format.js';
import { EmptyState, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

export function InsightsTab({ data, onLog }: { data: WalletData | null; onLog: () => void }) {
  if (!data) return <Skeleton height={360} />;
  const { view } = data;
  const habits = view.habits;
  const thisWeek = parseMoney(habits?.weekly.totalThisWeek) ?? 0;
  const lastWeek = parseMoney(habits?.weekly.totalLastWeek) ?? 0;
  const weekMax = Math.max(thisWeek, lastWeek, 1);
  const cats = habits?.summary30d.byCategory ?? [];
  const catMax = Math.max(1, ...cats.map((c) => parseMoney(c.total) ?? 0));
  const declined = view.summary.declinedCount;
  const change = changeWords(thisWeek, lastWeek);

  const notes: string[] = [];
  const top = cats[0];
  if (top) notes.push(`${categoryLabel(top.category)} is your biggest category: ${top.total} over ${top.count} ${top.count === 1 ? 'entry' : 'entries'} in the last 30 days.`);
  if (change && thisWeek > 0) notes.push(`This week you logged ${money(thisWeek)}. That is ${change.toLowerCase()}.`);
  if (declined > 0) notes.push(`${declined} ${declined === 1 ? 'payment was' : 'payments were'} declined. Open Activity, then the Declined filter, to see why.`);

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Insights</h1>
        <p className="page-sub">Built only from what you logged and what moved through your wallet.</p>
      </div>

      <section className="card" aria-labelledby="ins-month">
        <div className="card-head"><h2 id="ins-month">Money this month</h2></div>
        <div className="stat-grid">
          <div className="stat"><p className="stat-value">{view.finance?.periodTotals.spent ?? '$0.00'}</p><p className="stat-label">Spent (logged by you)</p></div>
          <div className="stat"><p className="stat-value">{view.finance?.periodTotals.income ?? '$0.00'}</p><p className="stat-label">Income (logged by you)</p></div>
          <div className="stat"><p className="stat-value">{view.summary.sent}</p><p className="stat-label">Sent to friends</p></div>
          <div className="stat"><p className="stat-value">{view.summary.received}</p><p className="stat-label">Received from friends</p></div>
        </div>
      </section>

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card" aria-labelledby="ins-week">
          <div className="card-head"><h2 id="ins-week">This week and last</h2></div>
          {thisWeek === 0 && lastWeek === 0 ? (
            <EmptyState title="No spending logged in the last two weeks" action={<button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>} />
          ) : (
            <div className="bars">
              <div className="bar-row"><span>This week</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(4, (thisWeek / weekMax) * 100)}%`, display: 'block' }} /></span><span className="num">{money(thisWeek)}</span></div>
              <div className="bar-row"><span>Last week</span><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(4, (lastWeek / weekMax) * 100)}%`, display: 'block', opacity: 0.45 }} /></span><span className="num">{money(lastWeek)}</span></div>
              {change ? <p className="muted">{change}.</p> : null}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="ins-cats">
          <div className="card-head"><h2 id="ins-cats">Where it went (30 days)</h2></div>
          {cats.length === 0 ? (
            <EmptyState title="Nothing to chart yet" action={<button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>}>
              Log what you spend outside the wallet and the categories appear here.
            </EmptyState>
          ) : (
            <div className="bars">
              {cats.map((c) => (
                <div key={c.category} className="bar-row">
                  <span>{categoryLabel(c.category)}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(4, ((parseMoney(c.total) ?? 0) / catMax) * 100)}%`, display: 'block' }} /></span>
                  <span className="num">{c.total}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {notes.length > 0 ? (
        <section className="card" aria-labelledby="ins-notes">
          <div className="card-head"><h2 id="ins-notes">What stands out</h2></div>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
