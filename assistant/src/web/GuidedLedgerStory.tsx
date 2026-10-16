import { useEffect, useState } from 'react';
import { PixelStage, type StageActor, type StageLayout } from './pixel/PixelStage.js';
import { markStoryComplete } from './tour-storage.js';

export interface StoryScene {
  id: string;
  layout: StageLayout;
  title: string;
  blurb: string;
  actors: StageActor[];
  handoffHook?: string;
}

const SCENES: StoryScene[] = [
  {
    id: 'hook',
    layout: 'hook',
    title: 'Built for real money',
    blurb:
      'This is a full ledger product — PostgreSQL, Java ledger-service, idempotent writes, fraud rules, and event relay — engineered to scale, not to fake balances in a UI.',
    actors: [
      { cast: 'alex', pose: 'wave', x: 70, y: 0 },
      { cast: 'sam', pose: 'idle', x: 200, y: 0 },
      { cast: 'jordan', pose: 'idle', x: 330, y: 0 },
    ],
  },
  {
    id: 'deposit',
    layout: 'deposit',
    title: 'Deposits hit the books',
    blurb: 'Bank funding debits, your wallet credits — double-entry in one transaction, safe to retry with an Idempotency-Key.',
    actors: [
      { cast: 'clerk', pose: 'idle', x: 40, y: 0 },
      { cast: 'alex', pose: 'wave', x: 220, y: 0 },
    ],
    handoffHook: 'tour-practice-alex',
  },
  {
    id: 'p2p',
    layout: 'p2p',
    title: 'Peer-to-peer transfers',
    blurb: 'USER pays USER through the ledger API; the web app never stores a shadow balance.',
    actors: [
      { cast: 'alex', pose: 'pay', x: 100, y: 0 },
      { cast: 'sam', pose: 'idle', x: 280, y: 0 },
    ],
  },
  {
    id: 'reject',
    layout: 'reject',
    title: 'Declines stay auditable',
    blurb: 'Rejected payments are recorded with reason codes — limits and fraud rules run before commit, with account rows locked in order.',
    actors: [
      { cast: 'alex', pose: 'blocked', x: 90, y: 0 },
      { cast: 'jordan', pose: 'idle', x: 260, y: 0 },
    ],
    handoffHook: 'tour-activity-hint',
  },
  {
    id: 'ledger',
    layout: 'ledger',
    title: 'Append-only entries',
    blurb: 'Every completed move adds immutable lines with balance_after_minor — export statement.txt from the Ledger tab.',
    actors: [{ cast: 'jordan', pose: 'readLedger', x: 160, y: 0 }],
    handoffHook: 'tour-ledger-hint',
  },
  {
    id: 'analytics',
    layout: 'analytics',
    title: 'Charts from real API data',
    blurb: 'Overview charts sum integer cents from your account view — the same paths production monitoring would use.',
    actors: [
      { cast: 'sam', pose: 'readLedger', x: 120, y: 0 },
      { cast: 'alex', pose: 'idle', x: 260, y: 0 },
    ],
  },
  {
    id: 'retry',
    layout: 'retry',
    title: 'Retry storm',
    blurb: 'Bad connectivity fires the same payment five times; Postgres serializes on the idempotency key so only one transfer posts.',
    actors: [
      { cast: 'sam', pose: 'pay', x: 120, y: 0 },
      { cast: 'alex', pose: 'idle', x: 280, y: 0 },
    ],
    handoffHook: 'tour-retry-hint',
  },
  {
    id: 'handoff',
    layout: 'handoff',
    title: 'Open a wallet',
    blurb: 'Practice offline with Alex, seed a live household on PostgreSQL, or create your own wallet — then run the retry storm on Overview.',
    actors: [
      { cast: 'alex', pose: 'wave', x: 60, y: 0 },
      { cast: 'sam', pose: 'idle', x: 180, y: 0 },
      { cast: 'jordan', pose: 'idle', x: 300, y: 0 },
    ],
    handoffHook: 'tour-practice-alex',
  },
];

export function GuidedLedgerStory({
  onComplete,
  onHandoff,
}: {
  onComplete: () => void;
  onHandoff?: (hookId: string | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [anim, setAnim] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setAnim((a) => a + 1), 70);
    return () => window.clearInterval(id);
  }, []);

  const scene = SCENES[Math.min(step, SCENES.length - 1)]!;
  const last = step >= SCENES.length - 1;

  function finish() {
    markStoryComplete();
    onHandoff?.(scene.handoffHook ?? null);
    onComplete();
  }

  function skip() {
    markStoryComplete();
    onHandoff?.(null);
    onComplete();
  }

  return (
    <section className="pane story-pane" aria-label="Guided ledger introduction">
      <div className="pane-hd">
        <strong>guided intro</strong> · scene {step + 1}/{SCENES.length}
      </div>
      <div className="pane-bd story-layout">
        <PixelStage layout={scene.layout} actors={scene.actors} animTick={anim} />
        <div className="story-terminal">
          <p className="step-label">{scene.id}</p>
          <h2 className="story-headline">{scene.title}</h2>
          <p className="story-blurb">{scene.blurb}</p>
          <div className="story-dots" role="tablist" aria-label="Progress">
            {SCENES.map((s, i) => (
              <span key={s.id} className={i === step ? 'dot on' : 'dot'} aria-current={i === step} />
            ))}
          </div>
          <div className="story-nav">
            <button type="button" className="t-btn-inline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              [ back ]
            </button>
            {!last ? (
              <button type="button" className="t-btn-inline" onClick={() => setStep((s) => s + 1)}>
                [ next ]
              </button>
            ) : (
              <button type="button" className="t-btn-inline recommended" onClick={finish}>
                [ continue to sign-in ]
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="story-skip-bar">
        <button type="button" className="t-btn-inline story-skip" onClick={skip}>
          &lt; skip &gt;
        </button>
        <span className="dim">Know the stack already? Jump to sign-in.</span>
      </div>
    </section>
  );
}

export { SCENES };
