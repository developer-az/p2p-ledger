import type { WalletData } from './data.js';
import { Icon } from './ui.js';

export type DemoStepId = 'baseline' | 'log' | 'split' | 'pay' | 'receipt';

export interface DemoGuideProps {
  data: WalletData | null;
  progress: DemoStepId[];
  onStep: (step: DemoStepId) => void;
  onDismiss: () => void;
  onExit: () => void;
  onPatterns: () => void;
}

interface StepCopy {
  id: DemoStepId;
  title: string;
  body: string;
  action: string;
}

const STEPS: StepCopy[] = [
  {
    id: 'baseline',
    title: 'Set the three numbers',
    body: 'Cash, card balance, a weekly pace. Thirty seconds, no bank login — this is what makes the rest of the app feel personal.',
    action: 'Set my baseline',
  },
  {
    id: 'log',
    title: 'Log a spend in two taps',
    body: 'Amount and category. Watch the weekly ring, streak and Patterns update from your own history — not a bank feed.',
    action: 'Log a spend',
  },
  {
    id: 'split',
    title: 'Split a bill with friends',
    body: 'The shares always add up to the total. Each friend gets a request; money moves only when they accept.',
    action: 'Split a bill',
  },
  {
    id: 'pay',
    title: 'Answer a request',
    body: 'Paying a request is one idempotent ledger transfer. A double tap cannot move the money twice.',
    action: 'Answer a request',
  },
  {
    id: 'receipt',
    title: 'Open a receipt',
    body: 'Every payment is two ledger lines that must balance. Open one and see the proof behind the number.',
    action: 'Open a receipt',
  },
];

export function DemoGuide({ data, progress, onStep, onDismiss, onExit, onPatterns }: DemoGuideProps) {
  const done = new Set(progress);
  const next = STEPS.find((s) => !done.has(s.id));
  const complete = done.size >= STEPS.length;
  const pending = data?.requests.incoming.filter((r) => r.status === 'PENDING').length ?? 0;

  return (
    <section className="demo-guide" aria-labelledby="demo-title">
      <div className="demo-guide-top">
        <span className="demo-badge"><Icon name="sparkle" size={13} /> Guided demo</span>
        <span className="demo-count">{Math.min(done.size, STEPS.length)} / {STEPS.length} done</span>
        <button type="button" className="demo-hide" onClick={onDismiss} aria-label="Hide demo guide">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="demo-guide-body">
        <div>
          <h2 id="demo-title">{complete ? 'You have seen the whole loop.' : next?.title}</h2>
          <p>
            {complete
              ? 'Logging, splitting, paying and checking a receipt — that is the product. Patterns is where it gets interesting.'
              : next?.body}
          </p>
        </div>
        <div className="demo-progress" aria-label={`${done.size} of ${STEPS.length} demo steps complete`}>
          {STEPS.map((step) => (
            <span
              key={step.id}
              className={`demo-dot${done.has(step.id) ? ' is-done' : ''}${next?.id === step.id ? ' is-next' : ''}`}
              title={step.title}
            />
          ))}
        </div>
      </div>
      <div className="demo-actions">
        {complete ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={onPatterns}>Explore my patterns</button>
            <button type="button" className="btn btn-sm" onClick={onExit}>Create my own wallet</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => next && onStep(next.id)}>
              {next?.id === 'pay' && pending === 0 ? 'Open requests' : next?.action}
            </button>
            <button type="button" className="btn btn-sm" onClick={onExit}>Start my own wallet</button>
          </>
        )}
      </div>
    </section>
  );
}
