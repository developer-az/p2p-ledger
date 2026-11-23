# Documentation images

PNG assets for the root **README** and portfolio use. Captures come from the
deployed app (`ledger.anthony-zhou.com`), signed out, inside its sample
household. Re-capture from live — or from `npm run dev:stack` — after UI changes.

| File | Capture |
|------|---------|
| `settle-landing.png` | Landing page: hero, pipeline, sample-data section (1440×1100) |
| `settle-overview.png` | Sample household → **Overview**, guided tour closed (1440×1100) |
| `settle-insights.png` | **Insights** from the top: weekly pace, month to date (1440×1100) |
| `settle-subscriptions.png` | **Subscriptions**: run-rate, active streams, possible charges (1440×1100) |
| `settle-insights-phone.png` | The same Insights view at 390×844 |

**How to refresh**

1. Open the site and choose **Explore the sample household**.
2. Close the **Guided tour** rail (top right) so it does not cover the figures.
3. Capture at 1440×1100 with device scale factor 2; mobile at 390×844.
4. Downscale by half, save here, and update the README if a section moved.

The `/ops` terminal signs in against a live wallet, so the signed-out console is
empty and is not captured. Use **F2** there with a live ledger when a terminal
figure is needed.

## Archive

`assistant-signin.png`, `assistant-overview.png`, `assistant-send.png`,
`assistant-ask.png` — older multi-pane UI; kept for history only.
