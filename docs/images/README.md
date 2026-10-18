# Documentation images

PNG assets for the root **README** and portfolio use. Prefer captures from **live** or `npm run dev:stack` after UI changes.

## Terminal (current product)

| File | Capture |
|------|---------|
| `terminal-workstation.png` | Signed-in session: WATCH · BLOTTER · AUDIT/MSG · CMD (1280×720 or wider) |
| `terminal-watch.png` | Same as workstation hero, or crop on WATCH + bank dock |

## Settle (consumer app)

| File | Capture |
|------|---------|
| `settle-home.png` | Desktop **Today** above the fold: net position, weekly pace, quick actions, patterns peek (1440×1040) |
| `settle-split-phone.png` | Mobile **Split a bill** sheet with friends selected (390×844) |

**How to refresh Settle shots**

1. `cd assistant && npm run dev` (practice mode is fine).
2. Open `http://localhost:5173`, try the demo, set the snapshot.
3. Desktop: capture **Today** above the fold. Mobile: open **Split** from the quick actions.
4. Save under `docs/images/` and commit.

**How to refresh**

1. Open [p2p-ledger-pi.vercel.app](https://p2p-ledger-pi.vercel.app) (or local `npm run dev:stack`).
2. **F2 ONBOARD** or resume a saved wallet.
3. Full-page screenshot; save under `docs/images/` and commit.

## Archive (guided UI, pre-terminal)

`assistant-signin.png`, `assistant-overview.png`, `assistant-send.png`, `assistant-ask.png` — older multi-pane UI; kept for history only.
