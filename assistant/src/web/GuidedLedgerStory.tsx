import { useEffect, useState } from 'react';
import { PipelineStage, type StageActor } from './pipeline/PipelineStage.js';
import { sceneScriptForLayout } from './pipeline/pipeline-script.js';
import type { PipelineScene } from './pipeline/pipeline-script.js';
import { markStoryComplete } from './tour-storage.js';

export interface StoryScene {
  id: string;
  layout: PipelineScene['layout'];
  title: string;
  lines: string[];
  actors: StageActor[];
  handoffHook?: string;
}

const SCENES: StoryScene[] = [
  {
    id: 'hook',
    layout: 'hook',
    title: 'Why a dedicated ledger?',
    lines: [
      'Payments need one auditable source of truth — not balances copied into every app.',
      'Balances are not simulated in the browser; they come from PostgreSQL via ledger-service.',
      'P2P means USER debits USER on one shared ledger — the assistant never holds a shadow balance.',
    ],
    actors: [
      { cast: 'alex', x: 40 },
      { cast: 'sam', x: 120 },
      { cast: 'jordan', x: 200 },
    ],
  },
  {
    id: 'deposit',
    layout: 'deposit',
    title: 'Deposit · bank → wallet',
    lines: [
      'SYSTEM funding account debits; your USER wallet credits — two legs, one transaction.',
      'Idempotency-Key on POST prevents double deposits on retry.',
      'After sign-in: inspect any payment for ledger entries and replay proof.',
    ],
    actors: [
      { cast: 'clerk', x: 50 },
      { cast: 'alex', x: 180 },
    ],
    handoffHook: 'tour-practice-alex',
  },
  {
    id: 'p2p',
    layout: 'p2p',
    title: 'Peer-to-peer (explicit)',
    lines: [
      'Alex (UUID) pays Sam (UUID) — same API as production P2P.',
      'Watch the pipeline: lock → fraud → balanced legs → outbox.',
      'Memos are user data; fraud evaluates on locked rows before commit.',
    ],
    actors: [
      { cast: 'alex', x: 60 },
      { cast: 'sam', x: 200 },
    ],
  },
  {
    id: 'reject',
    layout: 'reject',
    title: 'Declines are recorded',
    lines: [
      'Rejected transfers stay in the ledger with a reason code — no money moves.',
      'NEW_ACCOUNT_LARGE_TRANSFER: $12k rent on a young wallet.',
      'VELOCITY_LIMIT: five sends in sixty seconds.',
    ],
    actors: [
      { cast: 'alex', x: 70 },
      { cast: 'jordan', x: 190 },
    ],
    handoffHook: 'tour-activity-hint',
  },
  {
    id: 'ledger',
    layout: 'ledger',
    title: 'Append-only ledger entries',
    lines: [
      'Each completed movement adds signed lines with balance_after_minor.',
      'Tamper checks attempt forbidden SQL — Postgres refuses, not the UI.',
    ],
    actors: [{ cast: 'jordan', x: 120 }],
    handoffHook: 'tour-ledger-hint',
  },
  {
    id: 'analytics',
    layout: 'analytics',
    title: 'Analytics on real data',
    lines: [
      'Reconciliation recomputes from raw entries — sum to zero, no drift.',
      'Charts on Overview use your account API, not invented balances.',
    ],
    actors: [
      { cast: 'sam', x: 80 },
      { cast: 'alex', x: 200 },
    ],
  },
  {
    id: 'handoff',
    layout: 'handoff',
    title: 'Try it yourself',
    lines: [
      'Run the live demo — three wallets on PostgreSQL with a declined rent.',
      'Or pick practice Alex offline; proof UI still shows double-entry legs.',
    ],
    actors: [
      { cast: 'alex', x: 40 },
      { cast: 'sam', x: 120 },
      { cast: 'jordan', x: 200 },
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
    const id = window.setInterval(() => setAnim((a) => a + 1), 80);
    return () => window.clearInterval(id);
  }, []);

  const scene = SCENES[Math.min(step, SCENES.length - 1)]!;
  const last = step >= SCENES.length - 1;
  const pipelineScene = sceneScriptForLayout(scene.layout);

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
    <section className="story-pane guided-intro" aria-label="Guided ledger introduction">
      <div className="story-layout">
        <PipelineStage
          scene={pipelineScene}
          actors={scene.actors}
          animTick={anim}
          proofCaption="Narrative only — sign in to load GET /api/trail from PostgreSQL"
        />
        <div className="story-terminal">
          <p className="kicker mono">{scene.id}</p>
          <h2 className="story-title">{scene.title}</h2>
          {scene.lines.map((line) => (
            <p key={line} className="story-line">{line}</p>
          ))}
          <div className="story-dots" role="tablist" aria-label="Progress">
            {SCENES.map((s, i) => (
              <span key={s.id} className={i === step ? 'dot on' : 'dot'} aria-current={i === step} />
            ))}
          </div>
          <div className="story-nav">
            <button type="button" className="btn ghost small" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
            {!last ? (
              <button type="button" className="btn small" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="btn primary small" onClick={finish}>
                Continue to sign-in
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="story-skip-bar">
        <button type="button" className="btn ghost small" onClick={skip}>Skip intro</button>
        <span className="muted small">Scene {step + 1} of {SCENES.length}</span>
      </div>
    </section>
  );
}

export { SCENES };
