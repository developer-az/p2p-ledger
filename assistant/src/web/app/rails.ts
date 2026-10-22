import type { SettleRail } from '../api.js';

/**
 * P2P rail adapters — the seam where real peer-to-peer money movement plugs in.
 *
 * Today the customer app can *record* that a bill was settled outside the app
 * (`POST /api/requests/:id/settle` with a `settledVia` rail). Nothing moves on a
 * third-party network yet. The product goal is that when Zelle / Cash App /
 * Venmo / an on-chain treasury is wired in, **only the adapter below changes** —
 * the request workflow, the optimistic state (see ledger-store.ts) and the UI
 * already speak in rails.
 *
 * How a future integration lands, without touching the workflow:
 *
 *  1. Implement `handoff()` for the rail. For a deep link it is synchronous and
 *     returns a URL; for a real API it returns a settlement reference.
 *  2. Keep `commit()` (in ledger-store.ts) as the single write path. `handoff`
 *     runs *before* the optimistic commit, so a failed hand-off reverts the
 *     local state and no ledger row is written.
 *  3. The on-chain rail is a transfer against an on-chain account, not a new
 *     ledger concept: the double-entry posting is identical, `settledVia`
 *     records provenance.
 *
 * Invariant to preserve: for every rail, "pending → recorded" must be idempotent
 * on the request id, because a deep link can be opened twice.
 */

/** Everything an adapter needs to start (or record) a settlement. */
export interface RailHandoff {
  /** Payment request being settled. The idempotency anchor for the rail. */
  requestId: string;
  /** Amount in minor units — never float math on money. */
  amountMinor: number;
  currency: string;
  /** Who is being paid, for the deep link / memo text. */
  payeeLabel: string;
  /** The payer, when the rail needs a handle (e.g. a $cashtag). */
  payerLabel?: string;
}

export interface RailAdapter {
  id: SettleRail;
  /** Label shown on the settlement chip. */
  label: string;
  /**
   * True when the rail settles inside this app's double-entry ledger (an
   * in-app transfer). False for rails that settle on someone else's network
   * and are only *recorded* here.
   */
  inApp: boolean;
  /**
   * Optional. Starts the external hand-off. Return a reference to store on the
   * receipt, or nothing when the rail only needs recording. Absent = record-only.
   *
   * Deliberately optional so the app ships before any rail integration exists.
   */
  handoff?: (req: RailHandoff) => Promise<{ reference?: string } | void>;
}

/** The registry the UI and future integrations read from. */
export const RAIL_ADAPTERS: Record<SettleRail, RailAdapter> = {
  zelle: { id: 'zelle', label: 'Zelle', inApp: false },
  cashapp: { id: 'cashapp', label: 'Cash App', inApp: false },
  venmo: { id: 'venmo', label: 'Venmo', inApp: false },
  /** Physical cash: nothing to hand off, the requester just confirms. */
  cash: { id: 'cash', label: 'Cash', inApp: false },
  /**
   * On-chain settlement. A future adapter executes a stablecoin transfer to the
   * payee's address and returns the tx hash as `reference`; the ledger posting
   * stays exactly the same, `settledVia: 'crypto'` marks provenance.
   */
  crypto: { id: 'crypto', label: 'Crypto', inApp: false },
  other: { id: 'other', label: 'Other', inApp: false },
};

/** Ordered for the settlement chip row. */
export const RAIL_ORDER: SettleRail[] = ['zelle', 'cashapp', 'venmo', 'cash', 'crypto', 'other'];

/** Rails that can settle immediately inside the app. */
export function inAppRails(): RailAdapter[] {
  return Object.values(RAIL_ADAPTERS).filter((rail) => rail.inApp);
}

/**
 * Run a rail's hand-off if it has one. Returns the reference to attach to the
 * receipt. Record-only rails resolve to `{}` synchronously.
 */
export async function startHandoff(rail: SettleRail, req: RailHandoff): Promise<{ reference?: string }> {
  const adapter = RAIL_ADAPTERS[rail];
  if (!adapter.handoff) return {};
  const result = await adapter.handoff(req);
  return result ?? {};
}
