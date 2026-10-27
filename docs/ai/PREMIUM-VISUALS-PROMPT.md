# Premium visuals prompt (Settle)

Paste the prompt below into a Claude Code session at the repo root. It runs one pass that is only worth doing once: the full stack, each library on the surface where it earns its weight.

## Where the current visuals come from

| Layer | File | What it decides |
|---|---|---|
| Global stack rules | `~/.agents/SKILLS-ROUTING.md` ("Motion and visual stack") | Which library does which job, reduced motion, transform/opacity only, lazy-load heavy runtimes |
| Repo contract | `docs/DESIGN.md` | Pocket tokens (ink, paper, volt lime), Settle card, Pip, motion budget, product invariants |
| Product truth | `docs/PRODUCT.md` | What the app must do; visuals never replace it |
| Skills | `frontend-design`, `emil-design-eng`, `impeccable`, `aura-farming` | Art direction, motion craft, design system pass, anti-AI-trope audit |
| Code | `assistant/src/web/app/motion-kit.tsx`, `Pip.tsx`, `app.css` (POCKET layer) | `TiltCard`, `CountUp`, `RevealWords`, `InView`, `EASE_OUT`, Pip moods |
| Proof | `verify-settle` skill, playwright-cli | Desktop 1280 + mobile 390 screenshots, `scrollWidth` check |

## The prompt

```text
/pstack:poteto-mode
Premium visual pass on Settle (assistant/). Read docs/DESIGN.md, docs/PRODUCT.md and the
"Motion and visual stack" section of ~/.agents/SKILLS-ROUTING.md first. They are the contract;
when this prompt and DESIGN.md disagree, DESIGN.md wins on tokens and product invariants.

Goal: Settle should feel like a well-made hardware product (Apple Wallet, Teenage Engineering,
Arc), not a template. Every effect must have a job. One premium signature per surface, calm
everywhere else.

Split into separate verifiable units, one PR-sized chunk each, in this order:

1. Shared motion (app screens, Motion only)
   - Tab changes: native View Transitions API (document.startViewTransition) for a cross-fade
     plus a short slide. Feature-detect it and fall back to the current CSS view-in. No new dependency.
   - Filter pills (Activity seg, Patterns range): a sliding ink indicator with m.span layoutId.
     That needs domMax; switch motion-features.ts to domMax only if the chunk stays under
     ~10 kB gzip, otherwise use a CSS transform indicator measured from the active button.
   - Sheets: AnimatePresence enter/exit (y 24px + opacity, 240 ms, EASE_OUT). Keep the
     sheet-dismiss pointer rules exactly as they are.
   - Lists: keep the CSS row-in stagger. No per-row Motion components.

2. Patterns tab (the one tab without a pass)
   - Same header grammar as Activity: ink/paper stat strip with CountUp.
   - The heatmap cells fill in once on first view (InView, 8 ms per cell, capped at 300 ms total).
   - The category donut draws its segments with pathLength (Motion), Okabe-Ito colors unchanged.

3. Pip as a Rive character (optional, only if the result clearly beats the SVG)
   - Build a Rive state machine with inputs mood (enum: happy, calm, worried, party, sleepy),
     lookX/lookY (number) and cheer (trigger). pipMood() stays the only source of mood.
   - @rive-app/react-canvas, lazy-loaded; the current SVG Pip renders until the runtime loads
     and whenever reduced motion is on. Report the bundle delta. Drop the unit if it costs more
     than ~60 kB gzip on first load.

4. Welcome page as a scroll story (marketing surface: GSAP and Lenis allowed here only)
   - Lenis on the Welcome route only; destroy it on unmount and never on app screens or sheets.
   - GSAP ScrollTrigger via @gsap/react useGSAP: pin the Settle card while three beats scroll
     past (log a spend, see the week, settle up). The card's numbers change per beat with CountUp.
   - The "mess." strike-through draws with an SVG stroke (DrawSVG-style dashoffset, no paid plugin).
   - gsap.matchMedia: under prefers-reduced-motion there is no pin and no smoothing, and it
     falls back to the current static layout.
   - Lazy-load GSAP and Lenis with the Welcome chunk so app users never download them.

5. Welcome hero in 3D (optional, highest cost)
   - React Three Fiber + drei: the Settle card as a real slab with a beveled edge, an
     environment-map sheen and pointer tilt. It replaces TiltCard on Welcome only.
   - Lazy-load it behind an IntersectionObserver; show the current TiltCard as the poster frame
     until it loads, and keep TiltCard on low-power devices (navigator.hardwareConcurrency <= 4),
     with reduced motion, and when WebGL is missing.
   - Drop the unit if Welcome LCP regresses by more than 200 ms.

6. Borrowed patterns (copy, never install a kit)
   - From Magic UI / Aceternity / React Bits take only these: a number ticker (already CountUp),
     a marquee (already the tape), a spotlight hover on bento tiles (radial gradient at the
     pointer, ink/lime, no purple), and a grain/noise overlay on the dark hero (CSS, 3% opacity).
   - Restyle to Pocket tokens. No glow borders, glassmorphism, purple gradients or
     floating blobs.

Hard rules for every unit:
- Animate transform, opacity and filter only. UI feedback under 300 ms; Welcome set-pieces may run longer.
- Every effect respects prefers-reduced-motion.
- Use m.* inside LazyMotion strict, never motion.*.
- Report the bundle delta per unit (npm run build, gzip column). App-screen JS must not grow by more
  than 15 kB gzip total; Welcome-only chunks are judged on LCP instead.
- Product invariants in DESIGN.md stay: the ring, habit dots, two-tap log, category colors,
  sheet dismiss, read-only Ask.

Verify each unit: cd assistant && npm test && npm run build, then the verify-settle skill at
desktop 1280 and mobile 390 (light, dark, reduced motion), screenshots attached, and
document.documentElement.scrollWidth === innerWidth. Run emil-design-eng and aura-farming on
the result. Update docs/DESIGN.md with what shipped and docs/ai/HANDOFF.md. Open PRs; do not merge.
```

## Why each unused library lands where it does

| Library | Surface | Why there and not elsewhere |
|---|---|---|
| View Transitions API | Tab changes | Native, so it costs nothing; Motion can't animate between unmounted trees as cheaply |
| Motion `layoutId` / `AnimatePresence` | Pills, sheets | State-driven, which is Motion's job; kept small with LazyMotion |
| Rive | Pip | A state machine with mood, gaze and a cheer trigger is what Rive is for; the SVG stays as the fallback |
| GSAP + ScrollTrigger | Welcome only | Pinned, scroll-scrubbed storytelling; on app screens it would be dead weight |
| Lenis | Welcome only | Smooth scroll breaks sheet scrolling and text selection in forms |
| React Three Fiber | Welcome hero only | The one place a real 3D object sells the product; poster-frame fallback keeps LCP |
| Magic UI / Aceternity / React Bits | Patterns only, copied | Their defaults are the "AI-made" look; only the mechanics are worth taking |
