# Settle consumer UI — design system

Anchored to [PRODUCT.md](./PRODUCT.md). **Operate** surfaces use standard app chrome; the visual world only changes type, palette, density, and one signature move (Impeccable `mode-operate`).

## Visual world: bullet-journal habit tracker

| Token / element | Rule |
|-----------------|------|
| Ground | Warm paper `#f4f0e6` with faint dot grid |
| Surfaces | Page cards `#fffdf8`, dashed rules, left **pen** bar on hero |
| Pen (accent) | Sage `#2d6a4f` — primary actions, ring, habit dots, tab active |
| Type | **Sora** (UI), **Spectral** (money headlines) |
| Signature | **Habit dots** — 7 circles per week; filled when that day has a log |
| Imagery | Bundled `public/media/*` via `MediaPhoto`; Welcome keeps scene + feature photos |

## Product invariants (never swap for metaphor)

- Weekly **progress ring** + pace copy on Today hero
- Two-tap log sheet, category colors (Okabe–Ito), streak pill
- Patterns heatmap, demo guide photos, sheet dismiss (pointer down/up outside panel)

## Process (how rolls should run here)

1. `impeccable context` + `concept-seed --scope direction --mode operate`
2. **Pin** direction in `.impeccable/surfaces/…` + owner approval when roll conflicts with PRODUCT
3. **Replace** tokens in `app.css` (no overlay file); update all surfaces
4. `buildPath: code` in `.impeccable/config.json` for this app
5. Verify desktop + mobile in running app; update this file from what shipped

## What failed before

- Unattended roll → café punch card + `punch-card.css` on monochrome `app.css` + removed photos = half redesign.
- `frontend-design` “pick extreme” without a pinned contract = template shopping.
