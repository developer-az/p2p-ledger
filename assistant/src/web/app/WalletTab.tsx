import { useState } from 'react';
import type { AccountRef, BootstrapResponse } from '../api.js';
import { displayName, money } from './format.js';
import { moneyPlan } from './money-plan.js';
import { IncomingRequests, OutgoingRequests } from './Requests.js';
import { TrustTab } from './TrustTab.js';
import type { WalletData } from './data.js';
import { Avatar, Icon, Skeleton } from './ui.js';

export interface WalletActions {
  setup: () => void;
  logIncome: () => void;
  addMoney: () => void;
  send: (to?: AccountRef) => void;
  split: () => void;
  ask: () => void;
  reload: () => void;
  requestPaid: () => void;
  signOut: () => void;
}

export function WalletTab({
  me,
  data,
  boot,
  actions,
}: {
  me: AccountRef;
  data: WalletData | null;
  boot: BootstrapResponse;
  actions: WalletActions;
}) {
  const [showTrust, setShowTrust] = useState(false);
  if (!data) return <Skeleton height={420} />;
  const plan = moneyPlan(data.view);
  const pendingIn = data.requests.incoming.filter((r) => r.status === 'PENDING');
  const pendingOut = data.requests.outgoing.filter((r) => r.status === 'PENDING');

  return (
    <div className="wallet-page">
      <header className="patterns-head">
        <div>
          <p className="eyebrow">Wallet</p>
          <h1>Your money, your rules.</h1>
          <p className="page-sub">The numbers you set, the wallet you settle with, and the receipts behind it.</p>
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
                <div className="snapshot-net">
                  <span>Net position</span>
                  <strong className="num">{money(plan.netMinor ?? plan.ledgerMinor)}</strong>
                  <span className="muted">cash minus card balance</span>
                </div>
                <div className="snapshot-rows">
                  <div><span>💵 Cash</span><strong className="num">{money(plan.cashMinor ?? 0)}</strong></div>
                  <div><span>💳 Cards</span><strong className="num">{money(plan.creditMinor)}</strong></div>
                  <div><span>🎯 Weekly pace</span><strong className="num">{plan.budgetMinor === null ? 'Not set' : money(plan.budgetMinor)}</strong></div>
                </div>
              </>
            ) : (
              <div className="snapshot-empty">
                <p><strong>Your snapshot is blank.</strong> Add cash, cards and a weekly pace so the app can do the math.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={actions.setup}>Set it up</button>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="settle-title">
            <div className="card-head">
              <div><p className="eyebrow">For settling with friends</p><h2 id="settle-title">Settle wallet</h2></div>
              <span className="pill">{money(plan.ledgerMinor)}</span>
            </div>
            <p className="muted">This is the exact ledger balance used for sends, splits and requests. It is separate from the cash you track yourself.</p>
            <div className="row-wrap" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={actions.addMoney}><Icon name="bank" size={16} /> Add money</button>
              <button type="button" className="btn btn-sm" onClick={() => actions.send()}><Icon name="send" size={16} /> Send</button>
              <button type="button" className="btn btn-sm" onClick={actions.split}><Icon name="split" size={16} /> Split</button>
              <a className="btn btn-sm" href={`/api/accounts/${encodeURIComponent(me.id)}/statement.txt`}><Icon name="download" size={16} /> Statement</a>
            </div>
          </section>

          <section className="card" aria-labelledby="income-title">
            <div className="card-head">
              <div><p className="eyebrow">The other side</p><h2 id="income-title">Money coming in</h2></div>
              <button type="button" className="link-btn" onClick={actions.logIncome}>Log income</button>
            </div>
            <p className="muted">Salary, freelance, a refund, a gift. Logged income shapes your month without pretending to be a bank feed.</p>
            <div className="mini-stats">
              <div><span className="stat-label">Logged this month</span><strong className="num">{data.view.finance?.periodTotals.income ?? '$0.00'}</strong></div>
              <div><span className="stat-label">Logged out</span><strong className="num">{data.view.finance?.periodTotals.spent ?? '$0.00'}</strong></div>
            </div>
          </section>

          {pendingIn.length > 0 ? (
            <section className="card" aria-labelledby="wallet-needs">
              <div className="card-head"><div><p className="eyebrow">Waiting on you</p><h2 id="wallet-needs">Requests</h2></div><span className="pill pill-warn">{pendingIn.length}</span></div>
              <IncomingRequests requests={pendingIn} me={me.id} onChanged={actions.reload} onPaid={actions.requestPaid} />
            </section>
          ) : null}

          {pendingOut.length > 0 ? (
            <section className="card" aria-labelledby="wallet-out">
              <div className="card-head"><div><p className="eyebrow">Waiting on them</p><h2 id="wallet-out">You asked</h2></div></div>
              <OutgoingRequests requests={pendingOut} me={me.id} onChanged={actions.reload} />
            </section>
          ) : null}
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="circle-title">
            <div className="card-head">
              <div><p className="eyebrow">Your circle</p><h2 id="circle-title">Friends</h2></div>
              <button type="button" className="link-btn" onClick={() => actions.send()}>Send</button>
            </div>
            {data.peers.length === 0 ? (
              <p className="muted">Send or receive one payment and your people show up here.</p>
            ) : (
              <ul className="list">
                {data.peers.map((p) => {
                  const friend = data.friends[p.id];
                  return (
                    <li key={p.id}>
                      <button type="button" className="item" onClick={() => actions.send(p)}>
                        <Avatar owner={p.owner} />
                        <span className="item-body">
                          <span className="item-title" style={{ display: 'block' }}>{displayName(p.owner)}</span>
                          <span className="item-sub" style={{ display: 'block' }}>
                            {friend ? `30 days · sent ${friend.sentToPeer} · got ${friend.receivedFromPeer}` : 'No recent payments'}
                          </span>
                        </span>
                        <Icon name="chevron" size={18} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="ask-card" aria-labelledby="wallet-ask">
            <div className="ask-glow" aria-hidden="true" />
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
            <p className="muted">Every payment is two ledger lines that must balance. You can inspect a real payment, retry one, or try to edit history.</p>
            <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowTrust((v) => !v)}>
              {showTrust ? 'Hide trust lab' : 'Open trust lab'}
            </button>
          </section>

          {showTrust ? <TrustTab me={me} data={data} live={boot.live} embedded /> : null}

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
