# Settle consumer UI — design system

Anchored to [PRODUCT.md](./PRODUCT.md). **Operate** surfaces use standard app chrome; the visual world only changes type, palette, density, and one signature move (Impeccable `mode-operate`).

## Visual world: "Sky" (daylight, white glass, ink, one volt accent)

| Token / element | Rule |
|-----------------|------|
| Ground | Pale sky `#f3f7fc` with a light-blue band at the top of every screen (`--sky-top` to `--sky-mid`) and two soft cloud highlights. Dark mode is a night sky (`#0b1020`). |
| Surfaces | White cards, a soft sky-tinted float shadow (`--shadow`), radius 22px. |
| Ink | `#111726`. Primary buttons are ink. |
| Volt (the only accent) | Lime `#c8f53b`, Pip's colour, used as a **fill** with ink text (dock "+", active tab, ring, habit dots). Never lime text on a light ground. |
| Type | **Bricolage Grotesque** (display), **Geist** (UI), **Geist Mono** (labels, eyebrows, sub-amounts). |
| Hero object | The **Settle card**: dark Apple Wallet-style card (`.s-card`) that tilts toward the pointer (`TiltCard`). Used on Welcome and as the Today hero; it stays dark on the light sky on purpose. |
| Character | **Pip** (`Pip.tsx`): a lime bean with a sprout, stubby hands and feet. Eyes follow the pointer or a `lookAt` point; the sprout leans against the gaze on a soft spring. Blinks (sometimes twice), fidgets every 7 to 13 s when idle (hop with squash and stretch, glance, sprout shake, wave), leans and blushes when hovered, hops with arms up on `cheer`. `shy` puts both hands over its eyes (password fields), `peek` lowers one. Mood still comes only from real numbers (`pipMood`). Logo-sized Pips pass `idle={false}`. |
| Adding | **One way in.** The dock has a raised lime "+" in the middle on every tab (no other add buttons). It opens `AddSheet`: type an amount, then tap what it was; the tap saves. "I spent / I got paid" swaps category tiles for income sources. Recent spends are one-tap repeats with Undo on the toast. Notes are behind "+ Add a note". Splitting a bill is a link to Settle Up. |
| Fewer controls | The dock holds Today, Activity, "+", Patterns, Ask. Wallet lives in the account menu. No top-bar Ask, no floating add button, no quick-action row; the Today ask bar suggests a question in its placeholder instead of chip buttons. |
| Welcome | A daytime sky hero with drifting clouds, the tilting card and Pip; "how it works" bento; then the account section **above the clouds** (`AuthSky.tsx`): a morning sky, three depths of drifting cloud, a sun, twinkles, Pip riding its own cloud, and a frosted-glass card (the one place `backdrop-filter` is used). Fields use floating labels; the password has Show/Hide. Pip reads along the field being typed in, covers its eyes on the password, peeks when it is shown, and hops when a valid email is entered. |

## Motion stack budget (this repo)

Global picks live in `~/.agents/SKILLS-ROUTING.md` ("Motion and visual stack"). The staged plan for the libraries below (each optional unit has a drop rule) is [docs/ai/PREMIUM-VISUALS-PROMPT.md](./ai/PREMIUM-VISUALS-PROMPT.md). Here:

| Library | Status | Where |
|---------|--------|-------|
| `motion` | **Installed**, the only animation dependency | All surfaces via `motion-kit.tsx` and `Pip.tsx`. Use `m.*`, never `motion.*`: `ConsumerApp` wraps everything in `<LazyMotion strict>` and loads `domAnimation` from `motion-features.ts` as its own chunk. Layout animations (`layout`, `layoutId`) and drag need `domMax`; switch the import there only if a feature needs them. |
| Rive | Candidate | Only to replace hand-built Pip if Pip needs more states than eyes/blink/jump. Must keep `pipMood` as the source of mood. |
| GSAP + Lenis | Welcome only, if ever | A scroll-told Welcome. Never on Today, Activity, Wallet, Ask, or sheets (Lenis breaks sheet scroll and text selection). |
| React Three Fiber | Not planned | A 3D Settle card would duplicate `TiltCard`. Lazy-load with a static fallback if a future Welcome needs it. |
| Aceternity / Magic UI / React Bits | Reference only | Copy a pattern, restyle to Sky tokens (ink, white glass, volt). No glow borders or purple. Frosted glass only on the sign-in scene. |

## Product invariants (never swap for metaphor)

- Wallet's expense CSV import reuses the existing card, form, button and status styles. Activity's proof panel offers an explicit chain-receipt check and JSON download. Both show unavailable/error states without implying money moved. No new visual or animation dependencies.

- Weekly **progress ring**, habit dots and pace copy on the Today card
- Two-tap logging (amount, then the category tap saves), category colors (Okabe–Ito), streak pill
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
