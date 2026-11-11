import { useState, type CSSProperties } from 'react';
import './styles/views.css';
import './styles/subscriptions.css';
import { api, type SubscriptionCandidate, type SubscriptionStream } from '../api.js';
import { categoryMeta } from './categories.js';
import { money } from './format.js';
import { EmptyState, Icon, Skeleton, Sparkline } from './ui.js';
import type { WalletData } from './data.js';

const CADENCE_LABEL: Record<SubscriptionStream['cadence'], string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every quarter',
  annual: 'Every year',
};

function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

function candidateReason(candidate: SubscriptionCandidate): string {
  if (candidate.trialToPaid) return 'Trial charge followed by a full-price charge';
  if (candidate.reason === 'single_charge') return 'One charge so far';
  return 'A pattern that is not confirmed yet';
}

function StreamRow({
  stream,
  pending,
  onMark,
}: {
  stream: SubscriptionStream;
  pending: boolean;
  onMark: () => void;
}) {
  const meta = categoryMeta(stream.category);
  const tint = { '--tint': meta.color } as CSSProperties;
  const history = stream.priceHistory.map((charge) => charge.amountMinor);
  const historyLabel = `${stream.merchant} price history: ${stream.priceHistory.map((charge) => money(charge.amountMinor)).join(', ')}`;

  return (
    <li className={`sub-row${stream.markedToCancel ? ' is-marked' : ''}`}>
      <span className="sub-glyph" style={tint} aria-hidden="true"><Icon name={meta.icon} size={18} /></span>
      <div className="sub-main">
        <div className="sub-titleline">
          <span className="sub-name">{stream.merchant}</span>
          <span className="v-chip sub-category" style={tint}>{meta.label}</span>
          {stream.priceCreep && stream.priceChange ? (
            <span className="sub-flag is-warn">
              <Icon name="trend" size={12} /> Price up {Math.abs(stream.priceChange.pct)}%
            </span>
          ) : null}
          {stream.trialToPaid ? <span className="sub-flag">Trial → paid</span> : null}
          {stream.markedToCancel ? <span className="sub-flag is-cancel">Marked to cancel</span> : null}
        </div>
        <p className="sub-meta">
          <span>{CADENCE_LABEL[stream.cadence]}</span>
          <span>{money(stream.amountMinor)}</span>
          <span>Last {shortDate(stream.lastChargeAt)}</span>
          <span>Next {shortDate(stream.nextChargeAt)}</span>
        </p>
        {stream.markedToCancel ? (
          <p className="sub-reminder">Cancel before {shortDate(stream.nextChargeAt)} to avoid the next charge.</p>
        ) : null}
      </div>
      <div className="sub-spark">
        <Sparkline
          values={history}
          tone={stream.priceCreep ? 'neg' : 'ink'}
          label={historyLabel}
          height={30}
        />
        <span className="sub-spark-label">{stream.priceHistory.length} charges</span>
      </div>
      <div className="sub-cost">
        <strong>{money(stream.annualMinor)}</strong>
        <span>a year</span>
      </div>
      <button
        type="button"
        className="v-btn sub-mark"
        disabled={pending}
        aria-pressed={stream.markedToCancel}
        onClick={onMark}
      >
        {pending ? 'Saving…' : stream.markedToCancel ? 'Keep it' : 'Mark to cancel'}
      </button>
    </li>
  );
}

function CandidateRow({ candidate }: { candidate: SubscriptionCandidate }) {
  const meta = categoryMeta(candidate.category);
  const tint = { '--tint': meta.color } as CSSProperties;
  return (
    <li className="sub-candidate">
      <span className="sub-glyph is-small" style={tint} aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
      <div className="sub-main">
        <div className="sub-titleline">
          <span className="sub-name">{candidate.merchant}</span>
          {candidate.trialToPaid ? <span className="sub-flag">Trial → paid</span> : null}
        </div>
        <p className="sub-meta">
          <span>{candidateReason(candidate)}</span>
          <span>{money(candidate.amountMinor)}</span>
          <span>Last {shortDate(candidate.occurredAt)}</span>
          {candidate.nextChargeAt ? <span>Next maybe {shortDate(candidate.nextChargeAt)}</span> : null}
        </p>
      </div>
      <span className="sub-candidate-tag">Not counted</span>
    </li>
  );
}

export function SubscriptionsTab({
  data,
  onChanged,
  onAsk,
  onLog,
}: {
  data: WalletData | null;
  onChanged: () => void | Promise<void>;
  onAsk: (question?: string) => void;
  onLog: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Skeleton height={440} />;

  const report = data.view.subscriptions;
  if (!report) return <Skeleton height={440} />;

  const mark = async (stream: SubscriptionStream) => {
    setPendingId(stream.id);
    setError(null);
    try {
      await api.markSubscription(data.view.id, stream.id, !stream.markedToCancel);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update that stream.');
    } finally {
      setPendingId(null);
    }
  };

  const hasAny = report.streams.length > 0 || report.candidates.length > 0;
  if (!hasAny) {
    return (
      <div className="v-view sub-view">
        <header className="sub-head">
          <div>
            <h1 className="v-title">Subscriptions</h1>
            <p className="v-sub">Recurring charges found in what you log. No bank feed required.</p>
          </div>
        </header>
        <EmptyState
          icon="repeat"
          title="No recurring charges yet"
          action={<button type="button" className="btn btn-primary" onClick={onLog}>Log a spend</button>}
        >
          Log a few months of a streaming service, gym, or software bill and it will appear here once the cadence is clear.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="v-view sub-view">
      <header className="sub-head">
        <div>
          <h1 className="v-title">Subscriptions</h1>
          <p className="v-sub">Recurring charges found in what you log. No bank feed required.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onAsk('Which subscriptions should I cancel first?')}>
          <Icon name="chat" size={16} /> Ask about this
        </button>
      </header>

      {error ? (
        <div className="notice notice-bad" role="alert">{error}</div>
      ) : null}

      <div className="v-figs" aria-label="Subscription totals">
        <div className="v-fig">
          <p className="v-fig-label">Monthly run-rate</p>
          <p className="v-fig-value num">{money(report.totals.monthlyRunRateMinor)}</p>
          <p className="v-fig-note">Active streams only</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">A year of this</p>
          <p className="v-fig-value num">{money(report.totals.annualRunRateMinor)}</p>
          <p className="v-fig-note">Same pace for 12 months</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Active streams</p>
          <p className="v-fig-value num">{report.totals.activeCount}</p>
          <p className="v-fig-note">{report.totals.duplicateCount > 0 ? `${report.totals.duplicateCount} duplicate service${report.totals.duplicateCount === 1 ? '' : 's'}` : 'No duplicates found'}</p>
        </div>
        <div className="v-fig">
          <p className="v-fig-label">Needs a look</p>
          <p className="v-fig-value num">{report.totals.candidateCount}</p>
          <p className="v-fig-note">Possible charges, not counted</p>
        </div>
      </div>

      {report.duplicates.length > 0 ? (
        <section className="sub-alert glass-tint" aria-labelledby="duplicate-title">
          <span className="sub-alert-icon" aria-hidden="true"><Icon name="alert" size={20} /></span>
          <div>
            <h2 id="duplicate-title">{report.duplicates.length === 1 ? 'Two streams look like one service' : 'Some services appear twice'}</h2>
            {report.duplicates.map((duplicate) => (
              <p key={duplicate.serviceKey} className="sub-alert-copy">
                {duplicate.serviceName}: {duplicate.streamIds.length} active streams, {money(duplicate.monthlyMinor)} a month combined
                ({money(duplicate.annualMinor)} a year). Check whether you pay twice.
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {report.streams.length > 0 ? (
        <section className="v-panel sub-panel" aria-labelledby="streams-title">
          <div className="v-panel-head">
            <div>
              <h2 id="streams-title">Active streams</h2>
              <p className="sub-note">Confirmed by cadence, a stable amount, and a recent charge.</p>
            </div>
            <span className="sub-count">{report.streams.length}</span>
          </div>
          <ul className="sub-list">
            {report.streams.map((stream) => (
              <StreamRow
                key={stream.id}
                stream={stream}
                pending={pendingId === stream.id}
                onMark={() => { void mark(stream); }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {report.candidates.length > 0 ? (
        <section className="v-panel sub-panel" aria-labelledby="candidates-title">
          <div className="v-panel-head">
            <div>
              <h2 id="candidates-title">Possible subscriptions</h2>
              <p className="sub-note">Kept out of the run-rate until another charge confirms the pattern.</p>
            </div>
            <span className="sub-count">{report.candidates.length}</span>
          </div>
          <ul className="sub-list">
            {report.candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
