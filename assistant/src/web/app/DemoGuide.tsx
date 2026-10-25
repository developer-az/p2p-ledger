import { Icon, PunchRow, type PunchSlot } from './ui.js';

export type DemoStepId = 'baseline' | 'log' | 'income' | 'patterns' | 'pace';

export interface DemoGuideProps {
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
    body: 'Amount and category. Watch today get stamped and Patterns update from your own history — not a bank feed.',
    action: 'Log a spend',
  },
  {
    id: 'income',
    title: 'Log money coming in',
    body: 'Salary, freelance, a refund. Income makes the month honest and keeps the projection grounded.',
    action: 'Log income',
  },
  {
    id: 'patterns',
    title: 'Open your patterns',
    body: 'A calendar heatmap, category shifts, your expensive weekday, and a card payoff path — all from what you logged.',
    action: 'Open Patterns',
  },
  {
    id: 'pace',
    title: 'Adjust the weekly pace',
    body: 'A plan is a guide, not a punishment. Change it when life changes and the bar follows.',
    action: 'Edit weekly pace',
  },
];

export function DemoGuide({ progress, onStep, onDismiss, onExit, onPatterns }: DemoGuideProps) {
  const done = new Set(progress);
  const next = STEPS.find((s) => !done.has(s.id));
  const complete = done.size >= STEPS.length;
  const count = Math.min(done.size, STEPS.length);
  const slots: PunchSlot[] = STEPS.map((step, i) => ({
    key: step.id,
    label: String(i + 1),
    stamped: done.has(step.id),
    today: next?.id === step.id,
    title: `${step.title}: ${done.has(step.id) ? 'done' : next?.id === step.id ? 'next' : 'not yet'}`,
  }));

  return (
    <section className="demo-guide" aria-labelledby="demo-title">
      <div className="demo-guide-top">
        <p className="demo-count">Guided demo · {count} of {STEPS.length} stamped</p>
        <button type="button" className="demo-hide" onClick={onDismiss} aria-label="Hide demo guide">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="demo-guide-body">
        <div>
          <h2 id="demo-title">{complete ? 'You have seen the whole loop.' : next?.title}</h2>
          <p>
            {complete
              ? 'Baseline, logging, income, patterns and a weekly pace: that is the product. Your own wallet starts clean whenever you are ready.'
              : next?.body}
          </p>
        </div>
        <PunchRow slots={slots} size="md" label={`${count} of ${STEPS.length} demo steps done`} />
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
              {next?.action}
            </button>
            <button type="button" className="btn btn-sm" onClick={onExit}>Start my own wallet</button>
          </>
        )}
      </div>
    </section>
  );
}
