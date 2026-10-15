import { PracticeLedger } from './practice-ledger.js';
import type { PracticeBootstrap } from './practice-ledger.js';

/** Practice fixture metadata for sign-in (no live ledger / LLM imports). */
export function practiceBootstrapPayload(): PracticeBootstrap {
  return new PracticeLedger().bootstrap();
}
