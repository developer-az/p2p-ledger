# PLAN — AI routing fix, ledger wake speed, Settle mascot + pro polish

Goal: (1) Ask questions like "Can I afford a $60 night out this week?" must reach a real
model (OpenRouter or Gemini) instead of the deterministic ledger fallback. (2) The sleeping
Render ledger should start waking before the user needs it and the UI should ride out the
wake instead of erroring. (3) Rename the mascot Pip → Settle, give it a 3D look, and bring the
landing nav, hero, footer and in-app chrome to a polished, modern product standard.

Root cause found for (1): production runs LLM_PROVIDER=openrouter. Every OpenRouter call
returns 404 "0 endpoints ... matching your guardrail restrictions and data policy" (an
OpenRouter account privacy setting). 404 is not treated as an outage, so there is no retry on
another model, and the GEMINI_API_KEY that is also set in production is never used as a
backup. Gemini's default model id (gemini-2.0-flash-lite) is also retired.

Baseline: `npm test` 222 passed / 1 skipped; `npx tsc --noEmit` clean.

## Steps

1. **Provider fallback chain (server).**
   - `providers/retry.ts`: add `isProviderUnavailable(err)` = outage OR 404 / "no endpoints" /
     "guardrail" / "data policy" / model-not-found.
   - `providers/openrouter.ts`: on such a 404, walk a fallback model list
     (`OPENROUTER_FALLBACK_MODELS` comma list, else built-in defaults), then throw.
   - `providers/gemini.ts`: default model `gemini-2.5-flash-lite`; on 404 retry once with
     `gemini-flash-lite-latest`.
   - `providers/fallback-chain.ts`: fall through on `isProviderUnavailable`; expose the name
     of the provider that answered.
   - `providers/index.ts`: openrouter + GEMINI_API_KEY → chain(openrouter, gemini);
     gemini + OPENROUTER_API_KEY → chain(gemini, openrouter) (existing).
   - `agent.ts`: route label comes from the provider that actually answered.
   - DONE WHEN: new unit tests in `test/provider-env.test.ts` / `test/fallback-chain.test.ts`
     cover 404-guardrail → Gemini, plus route labeling; `npm test` + `tsc` pass.

2. **Fallback answers "can I afford" questions.** `fallback.ts` gets an afford branch that
   uses ledger tools (balance + this week's spending) and answers the question directly
   instead of a generic summary. The UI note on fallback says the AI model was unavailable.
   DONE WHEN: `test/fallback.test.ts` covers the afford question; tests pass.

3. **Ledger wake.** `GET /api/wake` pings the ledger health with a short timeout (never
   throws). The client fires it once on app load so Render starts spinning up while the
   landing page is read. Client `call()` retries 503 "waking up" responses with backoff
   (max ~40s total) instead of surfacing the error. The preloader no longer blocks on the
   ledger. DONE WHEN: app test for `/wake`, unit test for retry helper, tests pass.

4. **Rename Pip → Settle (mascot).** Component `Mascot` in `app/Mascot.tsx` (types
   `MascotMood`, `mascotMood`), all imports, CSS classes `pip-*` → `mascot-*`, and every
   user-facing "Pip" string → "Settle". DONE WHEN: `grep -ri "pip" src/web` has no
   mascot hits; tests + tsc + build pass.

5. **3D mascot.** Redraw the SVG with volume: layered radial gradients, specular highlight,
   rim light, soft contact shadow, glossy eyes, and pointer-driven perspective tilt (spring,
   off under reduced motion). Same props/moods/animations. DONE WHEN: builds; screenshot
   reviewed.

6. **Landing nav + hero polish.** Sticky glass nav that condenses on scroll, clear
   links (Product, How it works, Security, Sign in, Create account), accessible mobile
   menu. DONE WHEN: builds; desktop + 390px screenshots reviewed.

7. **Professional footer.** Multi-column footer: brand + one-line pitch + live ledger
   status, Product / Resources / Legal columns, bottom bar with © 2026 Settle. Used on the
   landing page (and legal pages). DONE WHEN: builds; screenshots reviewed.

8. **In-app chrome consistency.** Signed-in header/dock, Ask tab and preloader use the
   new mascot and match the landing nav's type and spacing. DONE WHEN: builds; screenshots.

9. **Review gate.** Codex read-only review over the full diff → VERDICT: PASS.

## Out of scope / needs owner action
- OpenRouter account privacy settings (openrouter.ai/settings/privacy) block every
  endpoint for the configured model. Loosening them is the owner's call; the code fix works
  around it via Gemini.
- GitHub throttles the 10-minute keep-warm cron to every 3–7 h. A reliable free pinger
  (e.g. cron-job.org → https://p2p-ledger.onrender.com/actuator/health every 10 min) needs
  an owner account.
- No production deploy, push or env change without owner approval.

## Round 2 — the three open Codex findings only (2026-11-09)

10. **Cash unknown (HIGH).** When the profile has no cash set (`walletCashMinor === null`),
    chat finance context reports spendable cash as unknown (null) instead of the P2P
    balance. Fallback afford answer and `get_weekly_pace` say cash is unknown and never
    affirm affordability; P2P balance may be shown separately, labelled as such.
    DONE WHEN: targeted tests (fallback, tools, app chat) + tsc pass.
11. **Idempotency-Key in every header format (MEDIUM).** `call()` builds outgoing headers
    with `new Headers(init?.headers)` so plain objects, tuples and Headers instances all
    keep the key on every attempt. DONE WHEN: wake-retry tests cover all three formats
    asserting the key on both attempts; tsc passes.
12. **Sign-up readiness polling (MEDIUM).** Replace the fixed 5/20/45s refresh with
    bounded backoff polling (cap ~5 min) that stops once sign-up is available.
    DONE WHEN: pure schedule helper unit-tested; tsc passes.
13. Full suite once, then Codex review gate → VERDICT: PASS. No commit, no deploy.
