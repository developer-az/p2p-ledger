import { useEffect, useState } from 'react';
import { PixelStage } from './pixel/PixelStage.js';

/** Single research-poster intro — no click-through story. */
export function ResearchPoster() {
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setAnim((a) => a + 1), 70);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="pane poster-pane" aria-label="Project overview">
      <div className="pane-hd"><strong>p2p-ledger</strong> · production ledger stack</div>
      <div className="pane-bd poster-grid">
        <PixelStage
          layout="hook"
          animTick={anim}
          actors={[
            { cast: 'alex', pose: 'wave', x: 70, y: 0 },
            { cast: 'sam', pose: 'idle', x: 200, y: 0 },
            { cast: 'jordan', pose: 'idle', x: 330, y: 0 },
          ]}
        />
        <div className="poster-copy">
          <h1 className="poster-title">Real money needs a real ledger</h1>
          <p className="poster-lede">
            When a checkout page says “don’t close this tab or you might be charged twice,” that’s a symptom of weak
            idempotency. This project is the opposite: PostgreSQL double-entry, a Java ledger-service on Render, fraud
            rules, transactional outbox, and an API where duplicate retries return the same payment — at scale.
          </p>
          <ul className="poster-pillars">
            <li><strong>One source of truth</strong> — balances live in Postgres, not in the UI.</li>
            <li><strong>Idempotent writes</strong> — same key → one transfer, even under retry storms.</li>
            <li><strong>Auditable</strong> — append-only entries, declines recorded, statement export.</li>
          </ul>
          <p className="dim poster-foot">Sign in below with a live wallet or seed the demo household on PostgreSQL.</p>
        </div>
      </div>
    </section>
  );
}
