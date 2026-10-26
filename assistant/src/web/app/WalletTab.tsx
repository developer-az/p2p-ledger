import { useState } from 'react';
import type { AccountRef } from '../api.js';
import { money, parseMoney } from './format.js';
import { moneyPlan } from './money-plan.js';
import { TrustTab } from './TrustTab.js';
import type { WalletData } from './data.js';
import { Icon, Skeleton } from './ui.js';
import { CountUp, TiltCard } from './motion-kit.js';
import { Pip } from './Pip.js';

export interface WalletActions {
  setup: () => void;
  logIncome: () => void;
  addMoney: () => void;
  ask: () => void;
  signOut: () => void;
}

export function WalletTab({
  me,
  data,
  actions,
}: {
  me: AccountRef;
  data: WalletData | null;
  actions: WalletActions;
}) {
  const [showTrust, setShowTrust] = useState(false);
  if (!data) return <Skeleton height={420} />;
  const plan = moneyPlan(data.view);
  const patterns = data.view.patterns;
  const periodIncomeMinor = parseMoney(data.view.finance?.periodTotals.income) ?? patterns?.month.incomeMinor ?? 0;
  const projectedMinor = plan.projectedCashMinor ?? plan.cashMinor;
  const incomeLiftMinor =
    projectedMinor !== null && plan.cashMinor !== null ? projectedMinor - plan.cashMinor : 0;

  return (
    <div className="wallet-page">
      <header className="patterns-head">
        <div>
          <p className="eyebrow">Wallet</p>
          <h1>Your money, your rules.</h1>
          <p className="page-sub">The numbers you set, the habits you keep, and the records behind them.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={actions.setup}><Icon name="settings" size={16} /> Edit snapshot</button>
      </header>

      <div className="wallet-grid">
        <div className="stack">
          <section className="card snapshot-card" aria-labelledby="snap-title">
            <div className="card-head">
              <div><p className="eyebrow">Your snapshot</p><h2 id="snap-title">The whole picture</h2></div>
              <button type="button" className="link-btn" onClick={actions.setup}>Edit</button>
            </div>
            {plan.hasBaseline ? (
              <>
                <TiltCard className="s-card snapshot-card-hero" max={4}>
                  <div className="s-card-top">
                    <span className="s-card-brand">settle</span>
                    <span className="s-card-private"><Icon name="lock" size={12} /> Private</span>
                  </div>
                  <p className="s-card-label">Net position</p>
                  <p className="s-card-amount num"><CountUp minor={plan.netMinor ?? plan.ledgerMinor} /></p>
                  <p className="s-card-sub">Projected cash minus card balance</p>
                </TiltCard>
                <dl className="snapshot-rows">
                  <div><dt>Cash baseline</dt><dd className="num">{money(plan.cashMinor ?? 0)}</dd></div>
                  {periodIncomeMinor > 0 ? (
                    <div><dt>Logged income (period)</dt><dd className="num">{money(periodIncomeMinor)}</dd></div>
                  ) : null}
                  {incomeLiftMinor !== 0 ? (
                    <div><dt>Projected cash</dt><dd className="num">{money(projectedMinor ?? 0)}</dd></div>
                  ) : null}
                  <div><dt>Cards owed</dt><dd className="num">{money(plan.creditMinor)}</dd></div>
                  <div><dt>Weekly pace</dt><dd className="num">{plan.budgetMinor === null ? 'Not set' : money(plan.budgetMinor)}</dd></div>
                </dl>
              </>
            ) : (
              <div className="snapshot-empty">
                <p><strong>Your snapshot is blank.</strong> Add cash, cards and a weekly pace so the app can do the math.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={actions.setup}>Set it up</button>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="habit-title">
            <div className="card-head">
              <div><p className="eyebrow">The habit</p><h2 id="habit-title">Your logging</h2></div>
              <button type="button" className="link-btn" onClick={actions.logIncome}>Log income</button>
            </div>
            <div className="mini-stats">
              <div><span className="stat-label">Active days</span><strong className="num">{patterns?.totals.activeDays30d ?? 0}</strong></div>
              <div><span className="stat-label">Current streak</span><strong className="num">{patterns?.streak.currentDays ?? 0} days</strong></div>
              <div><span className="stat-label">Logged out this month</span><strong className="num">{money(patterns?.month.spentMinor ?? 0)}</strong></div>
              <div><span className="stat-label">Logged in this month</span><strong className="num">{money(patterns?.month.incomeMinor ?? 0)}</strong></div>
            </div>
          </section>

          <section className="card" aria-labelledby="ledger-title">
            <div className="card-head">
              <div><p className="eyebrow">The records</p><h2 id="ledger-title">Ledger balance</h2></div>
              <span className="pill">{money(plan.ledgerMinor)}</span>
            </div>
            <p className="muted">The exact demo ledger balance behind deposits and statements. It is separate from the cash snapshot you track yourself.</p>
            <div className="row-wrap" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={actions.addMoney}><Icon name="bank" size={16} /> Add money</button>
              <a className="btn btn-sm" href={`/api/accounts/${encodeURIComponent(me.id)}/statement.txt`}><Icon name="download" size={16} /> Statement</a>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="ask-card" aria-labelledby="wallet-ask">
            <Pip size={56} mood="calm" className="ask-card-pip" />
            <p className="eyebrow">A second pair of eyes</p>
            <h2 id="wallet-ask">Ask about your money</h2>
            <p className="ask-lede">Read-only answers from your records. It cannot move a cent.</p>
            <button type="button" className="btn btn-lime btn-sm" onClick={actions.ask}><Icon name="sparkle" size={16} /> Open Ask</button>
          </section>

          <section className="card trust-teaser" aria-labelledby="trust-title">
            <div className="card-head">
              <div><p className="eyebrow">The receipts</p><h2 id="trust-title">Your records are honest</h2></div>
              <Icon name="shield" />
            </div>
            <p className="muted">Every ledger entry is two lines that must balance. Open a real entry, retry one, or try to edit history.</p>
            <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowTrust((v) => !v)}>
              {showTrust ? 'Hide trust lab' : 'Open trust lab'}
            </button>
          </section>

          {showTrust ? <TrustTab me={me} data={data} embedded /> : null}

          <section className="card demo-note">
            <p className="eyebrow">Demo, honestly</p>
            <p className="muted">No real money moves. No passwords yet. A wallet is identified by its id on this device, so treat this as a showcase.</p>
            <div className="row-wrap" style={{ marginTop: 12 }}>
              <a className="btn btn-sm" href="/ops">Engineering console</a>
              <button type="button" className="btn btn-sm btn-danger" onClick={actions.signOut}><Icon name="logout" size={16} /> Leave wallet</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
