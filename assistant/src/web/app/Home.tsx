import { useMemo, type ReactNode } from 'react';
import type { AccountRef, SpendCategory } from '../api.js';
import { categoryMeta } from './categories.js';
import { buildFeed, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { displayName, money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { NeedsYouCard } from './SettleUp.js';
import type { WalletData } from './data.js';
import { Pip } from './Pip.js';
import { EmptyState, Icon, Skeleton } from './ui.js';

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

export function Home({ me, name, data, actions, guide, cheer = 0 }: { me: AccountRef; name?: string; data: WalletData | null; actions: HomeActions; guide?: ReactNode; cheer?: number }) {
  const feed = useMemo(() => data ? buildFeed(data.view) : [], [data]);
  if (!data) return <Skeleton height={320} />;
  const plan = moneyPlan(data.view);
  return <div className="desk-home">
    <header className="desk-greeting"><div><p className="eyebrow">{new Date().toLocaleDateString('en-US', {weekday:'long',month:'short',day:'numeric'})}</p><h1>Hello, {name || displayName(me.owner)}.</h1><p className="muted">One thing at a time. What did you spend on?</p></div><Pip cheer={cheer} size={48} track={false} mood={plan.overBudget ? 'worried' : 'happy'} /></header>
    {guide}
    <section className="desk-capture" aria-label="Record spending"><div className="spend-bubbles">{(['dining','groceries','transport','shopping','entertainment','other'] as SpendCategory[]).map(category => { const meta=categoryMeta(category); return <button key={category} type="button" onClick={() => actions.logSpend({category})}><span aria-hidden="true">{meta.emoji}</span>{meta.label}</button>; })}</div><p className="hint">Choose a category, set the amount, then review. Nothing moves from your bank.</p></section>
    <div className="desk-actions"><button type="button" className="btn" onClick={actions.logIncome}><Icon name="income" size={16}/> Income</button><button type="button" className="btn" onClick={actions.settleUp}><Icon name="swap" size={16}/> Split a bill</button><button type="button" className="btn" onClick={actions.seeInsights}><Icon name="chart" size={16}/> Patterns</button></div>
    <section className="desk-summary" aria-label="Your money summary"><div><span className="muted">Estimated net</span><strong className="num">{plan.netMinor === null ? 'Not set' : money(plan.netMinor)}</strong></div><div><span className="muted">Spent this week</span><strong className="num">{money(plan.weekSpentMinor)}</strong></div><div><span className="muted">Weekly pace left</span><strong className="num">{plan.weekLeftMinor === null ? 'Not set' : money(plan.weekLeftMinor)}</strong></div></section>
    <div className="desk-baseline"><p className="hint">{plan.hasBaseline ? 'An estimate from the numbers you enter, not a connected bank balance.' : 'Want an estimate of what is left? Add your starting numbers when you are ready.'}</p><button type="button" className="link-btn" onClick={() => actions.setup() }>{plan.hasBaseline ? 'Edit starting numbers' : 'Add starting numbers'} →</button></div>
    <NeedsYouCard me={me} onOpen={actions.settleUp}/>
    <section className="desk-recent" aria-labelledby="recent"><div className="card-head"><h2 id="recent">Recent activity</h2><button type="button" className="link-btn" onClick={actions.seeAll}>View all →</button></div>{feed.length ? <FeedList items={feed.slice(0,5)} onOpen={actions.openItem} grouped={false}/> : <EmptyState title="A clean start" action={<button type="button" className="btn" onClick={() => actions.logSpend()}>Record your first spend</button>}>Your spending and income will appear here.</EmptyState>}</section>
  </div>;
}
