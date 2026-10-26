# Settle consumer UI — design system

Anchored to [PRODUCT.md](./PRODUCT.md). **Operate** surfaces use standard app chrome; the visual world only changes type, palette, density, and one signature move (Impeccable `mode-operate`).

## Visual world: "Pocket" (ink, paper, one volt accent)

| Token / element | Rule |
|-----------------|------|
| Ground | Paper `#f4f3ee` (light) / `#0b0b0c` (dark). No textures on app screens. |
| Surfaces | White cards, 1px hairline, no drop shadow (Notion calm). Radius 20px. |
| Ink | `#0e0e10`. Primary buttons are ink (Apple Pay black). |
| Volt (the only accent) | Lime `#c8f53b`, used as a **fill** with ink text (dock active tab, Log spend, habit dots, ring, Pip). Never lime text on paper. |
| Type | **Bricolage Grotesque** (display, condensed via `font-stretch`), **Geist** (UI), **Geist Mono** (labels, eyebrows, sub-amounts). |
| Hero object | The **Settle card**: dark Apple Wallet-style card (`.s-card`) that tilts toward the pointer (`TiltCard`) with a moving sheen and grain. Used on Welcome and as the Today hero. |
| Character | **Pip** (`Pip.tsx`): a lime bean whose eyes follow the cursor and who blinks. Mood comes from real numbers (`pipMood`): happy on a 3+ day streak, sleepy when nothing is logged today, worried when over pace, party after a log. One Pip per screen. |
| Motion | `motion` (Framer Motion) for the hero: word-by-word blur reveal, card count-up, scroll reveals, springs on tilt and eyes. Ease `cubic-bezier(0.23,1,0.32,1)`. Buttons scale to 0.97 on press. `prefers-reduced-motion` turns off the tilt, reveals, breathing and the tape. |
| Welcome | Dark full-bleed hero, condensed headline with "mess." crossed out, tilting card + Pip, a lime tape marquee, then a bento "how it works" built from real UI fragments (no stock photos), then a lime "own wallet" block. |

## Product invariants (never swap for metaphor)

- Weekly **progress ring**, habit dots and pace copy on the Today card
- Two-tap log sheet, category colors (Okabe–Ito), streak pill
- Patterns heatmap, demo guide, sheet dismiss (pointer down/up outside panel)
- Ask is read-only; the Today ask bar only routes the question to the Ask tab

## Process (how rolls should run here)

1. `impeccable context` + `concept-seed --scope direction --mode operate`
2. **Pin** direction in `.impeccable/surfaces/…` + owner approval when roll conflicts with PRODUCT
3. **Replace** tokens in `app.css` (no overlay file); update all surfaces
4. `buildPath: code` in `.impeccable/config.json` for this app
5. Verify desktop + mobile in running app; update this file from what shipped

## What failed before

- Unattended roll → café punch card + `punch-card.css` on monochrome `app.css` + removed photos = half redesign.
- `frontend-design` “pick extreme” without a pinned contract = template shopping.
- Bullet-journal and AURA layers were stacked as override sheets on top of each other. Pocket replaced the token block and the whole override tail in one pass; keep one layer.
