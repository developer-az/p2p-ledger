import { useEffect, useState } from 'react';
import { PixelStage, type StageActor, type StageLayout } from './pixel/PixelStage.js';
import { markStoryComplete } from './tour-storage.js';

export interface StoryScene {
  id: string;
  layout: StageLayout;
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
      'ledger-service: PostgreSQL, double-entry, idempotent writes, fraud rules.',
      'This intro is visual only; your data lives in the ledger after you sign in.',
    ],
    actors: [
      { cast: 'alex', pose: 'idle', x: 80, y: 0 },
      { cast: 'sam', pose: 'idle', x: 200, y: 0 },
      { cast: 'jordan', pose: 'idle', x: 320, y: 0 },
    ],
  },
  {
    id: 'deposit',
    layout: 'deposit',
    title: 'Deposit · bank → wallet',
    lines: [
      'Funds move from a SYSTEM funding account into a USER wallet.',
      'Every deposit posts balanced ledger lines — debit funding, credit you.',
      'After sign-in: Send tab → deposit (Idempotency-Key safe retries).',
    ],
    actors: [
      { cast: 'clerk', pose: 'idle', x: 40, y: 0 },
      { cast: 'alex', pose: 'idle', x: 220, y: 0 },
    ],
    handoffHook: 'tour-practice-alex',
  },
  {
    id: 'p2p',
    layout: 'p2p',
    title: 'Peer-to-peer transfer',
    lines: [
      'USER pays USER — the assistant never keeps a shadow balance.',
      'Memos are user data; fraud rules evaluate before commit.',
      'Alex (Finance) pays Sam (Engineering) — same API as production.',
    ],
    actors: [
      { cast: 'alex', pose: 'pay', x: 100, y: 0 },
      { cast: 'sam', pose: 'idle', x: 280, y: 0 },
    ],
  },
  {
    id: 'reject',
    layout: 'reject',
    title: 'Declines are recorded',
    lines: [
      'Rejected transfers stay in the ledger with a reason code.',
      'NEW_ACCOUNT_LARGE_TRANSFER — $12k rent on a young wallet (Alex → Jordan).',
      'VELOCITY_LIMIT — 5 sends in 60 seconds (Sam’s concert tickets).',
    ],
    actors: [
      { cast: 'alex', pose: 'blocked', x: 90, y: 0 },
      { cast: 'jordan', pose: 'idle', x: 260, y: 0 },
    ],
    handoffHook: 'tour-activity-hint',
  },
  {
    id: 'ledger',
    layout: 'ledger',
    title: 'Append-only ledger entries',
    lines: [
      'Each completed movement adds signed lines with balance_after_minor.',
      'Auditors trace any balance to immutable history.',
      'Ledger tab → statement + download statement.txt',
    ],
    actors: [{ cast: 'jordan', pose: 'readLedger', x: 160, y: 0 }],
    handoffHook: 'tour-ledger-hint',
  },
  {
    id: 'analytics',
    layout: 'analytics',
    title: 'Analytics on real data',
    lines: [
      '30-day cashflow: sent, received, deposits — computed in integer cents.',
      'After sign-in, Overview charts use your account API responses.',
      'Ask tab: “What are my spending habits this month?” (needs GEMINI_API_KEY on Vercel).',
    ],
    actors: [
      { cast: 'sam', pose: 'readLedger', x: 120, y: 0 },
      { cast: 'alex', pose: 'idle', x: 260, y: 0 },
    ],
  },
  {
    id: 'handoff',
    layout: 'handoff',
    title: 'Try it yourself',
    lines: [
      'Practice [1] Alex — full demo offline.',
      'Seed live household — PostgreSQL on Render (persists across sessions).',
      'Create wallet — saved in this browser + ledger when online.',
    ],
    actors: [
      { cast: 'alex', pose: 'idle', x: 60, y: 0 },
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
    const id = window.setInterval(() => setAnim((a) => a + 1), 80);
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
          <strong>{scene.title}</strong>
          {scene.lines.map((line) => (
            <p key={line} className="world-line">{line}</p>
          ))}
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
        <span className="dim">Already know p2p-ledger? Skip to sign-in.</span>
      </div>
    </section>
  );
}

export { SCENES };
