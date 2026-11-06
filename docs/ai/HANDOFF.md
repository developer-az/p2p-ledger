# Engineering Handoff (latest)

## Session: surface hierarchy correction (2026-11-06)
- Owner correctly flagged the white-on-white redesign. Inspected shared CSS and rendered screens. The .app background still referenced undefined --dot-grid, invalidating the full background declaration. Replaced it with a valid background token.
- Added distinct sage page ground, off-white capture/account panels, forest summary/action anchors and stronger borders; removed body edge margin for the consumer app. No component or authentication behavior changed.
- Browser verified computed page/panel/summary colors, light and dark button text/background pairs, desktop and 390px layouts. Screenshots inspected with animations disabled to avoid capturing the entrance/theme-transition intermediate frames. Build passes; no new dependencies. Evidence: .verify/contrast-light-final.png and contrast-dark-final.png. Preserved user .gitignore edit.

## Session: preview capability diagnosis and Workbench redesign (2026-11-06)
- Owner reported signup/recovery failures and requested a complete barebones, comfortable UI with Muse-like familiarity. Used bug-hunter/frontend-design and audited with aura-farming; kept existing Motion and Pip without new dependencies.
- Confirmed through Vercel environment metadata: Preview has only LEDGER_URL and GEMINI_API_KEY. Production additionally has LEDGER_DATABASE_URL and model settings. Preview has no durable identity configuration, Java service key, or reset email sender credentials. No Vercel platform limitation was found. User authorized reuse of existing local configuration if available; no local Settle secrets were found in the repository, process environment or .p2p-secrets. Did not copy production identities to Preview or alter production services.
- Bootstrap now advertises signup/sign-in/reset availability and a public explanation. Production signup remains fail-closed. The welcome form disables unavailable operations before collecting input and provides the sample alternative. The reset endpoint returns 503 with an explicit no-email-sent message when delivery is not configured instead of a misleading accepted response. Configured reset token/session tests remain in place.
- Replaced the marketing-heavy Welcome with a compact two-column account screen. Rebuilt Home around category choices, three summary values and recent activity; optional starting numbers and contextual tools remain. Removed the tilting wallet hero and automatic demo quest. Navigation is flat and full width. Removed obsolete presentation CSS, restored the shared Pip styles as a small companion, and kept reduced-motion rules. Main JS gzip: 71.36 to 66.58kB; CSS: 75.35 to 43.62kB. Updated DESIGN.md and preview setup instructions.
- Added npm run check:deployment -- https://YOUR_PREVIEW_HOST; it reports capabilities without credentials and exits nonzero for missing signup/recovery.
- Fixed an existing clock-consistency bug discovered by the suite: loadAccountView summary used Date.now despite the BFF's injected clock, causing 30-day summaries to drift from fixture/application dates. It now receives the same date as the rest of the account view.
- Validation: 206 tests pass, 1 optional PostgreSQL integration test skipped locally (enabled in CI); typecheck/build pass. Browser sample category/amount/review/save passes at 390px without overflow. Missing-service UI was exercised using an intercepted bootstrap and correctly explains/disables signup and recovery. Screenshots reviewed at desktop/mobile; no browser errors beyond expected Vite restarts. Production inbox delivery has not been verified because sender configuration is missing.
- Remaining external setup: isolated Preview database, compatible Preview Java backend with matching LEDGER_API_KEY, Resend key/verified sender, and Preview APP_URL, then redeploy and test an actual inbox. No production merge or deployment authorized by this session.

## Session: Settle product and identity rework (2026-11-05)
- Continued the owner-requested PR #27 rework. Today now leads with category bubbles; amount presets/custom entry lead to explicit review, retry-safe save, and undo. Main navigation is Today/Activity/Wallet. Ask and Patterns remain contextual. Removed the consumer console link and forced onboarding modal. Personal Wallet no longer shows simulated funding or the trust lab; the sample experience keeps them. Recent activity includes all sources.
- Replaced contradictory PRODUCT.md directions with one Settle contract. The repository and Java accounting service are internal names, not separate products. Personal net position and simulated settlement balances must not be added together. Existing payments remain simulated; no Apple Pay/Venmo/bank integration was added.
- Fixed cash editing via explicit rebaseCash: a new cash snapshot does not subtract old expenses again, while history stays available. Regression tested.
- Production signup now fails closed without persistent identities and compatible Java. Durable signup reservations retain identity/account UUIDs across failures; transaction-scoped per-email locks work across instances and transaction poolers. Protected Java UUID provisioning uses insert-on-conflict and rejects mismatched owner/currency. No live-to-practice signup fallback.
- Added authenticated Java workflow capability version 2 and BFF /api/ready; documented backend-before-BFF rollout. Original missing /spends error requires deploying the matching Java artifact, not just the frontend preview.
- Hardened identity: shared PostgreSQL credential-attempt budgets, cross-site write rejection, no-store API responses, Secure cookies in production, serialized schema initialization, atomic reset-token/password/session transaction. Existing identity records/sessions remain compatible. Pending signup recovery requires the same password.
- Verification: 205 app tests including real PostgreSQL signup recovery, cross-instance throttle concurrency and reset replay. The final suite had one auth test hit its 5-second timeout under local load; its 7-test file passed on an isolated run with a 15-second test deadline. Production build passes. Java reports cover 49 tests; initial transfer concurrency run hit a 3-second pool acquisition deadline, and the affected 19-test group passed with a 30-second integration acquisition deadline. No production pool configuration changed. Browser category/amount/review/save passed at 390 and 1280px without horizontal overflow. Existing JS gzip 71.13 to 71.36kB, no new dependencies. UTF-8 and whitespace checked.
- Auth PostgreSQL integration is now enabled in assistant CI using a disposable database. Local evidence is under ignored .verify/. Java verification logs are ignored.
- Release is still bounded by the prior instruction not to merge main or deploy production without owner approval. No production service upgraded by this work. Real-payment release still requires verified email/identity, provider onboarding, reconciliation and operational controls; code changes are not enterprise certification.

## Session: publish preview branch (2026-11-05)
- Owner requested pushing `feat/java-workflows-chain-receipts` for a Vercel preview. Publish this feature branch without merging main or deploying the Java production service.
- Preview UI builds from `assistant/`. Live Java features require a matching updated ledger plus the same server-only `LEDGER_API_KEY`; the existing production ledger is not upgraded by a feature-branch push. Chain receipts additionally require the documented signer/RPC/contract configuration.
- Preserve the owner's pre-existing `.vercel` ignore edit outside this commit; include only the verification-artifact ignore rule added during implementation.

## Session: Java workflows and Solidity receipts (2026-11-05)
- **Branch:** `feat/java-workflows-chain-receipts`, based on current `main` (`735a8a8`). Existing user `.gitignore` addition `.vercel` is preserved. No commit, push, public-chain deployment or production service changes.
- **Java ownership:** added payment-request services/controllers/repository, atomic split creation, actor/state validation, idempotent payment attempts, and transactionally consistent pay/cancel/external-settlement handling. Added expense persistence, retry-safe writes, removal and atomic CSV import with exact minor-unit conversion, duplicate detection and IANA time-zone handling. Removed TypeScript PostgreSQL request/spending stores; the BFF delegates live workflows and keeps practice fixtures in memory.
- **Migrations:** V3 reuses the old request table and reconciles pending legacy requests with previously committed matching transfers; V4 adds the chain queue; V5 reuses the old spending table and adds import/idempotency metadata. Stop old writers for rollout; copy old BFF data first if it used a different database. See `docs/JAVA-WORKFLOWS.md`.
- **Solidity:** `contracts/src/LedgerAttestation.sol`, immutable commitments, authorized relayer, incident pause and OpenZeppelin delayed admin succession. Non-upgradeable attestation registry; no token escrow/custody or bank settlement. Compiler 0.8.38 and dependency lock pinned, patched transitive overrides, Hardhat EVM tests, deployment manifest script, independent proof-verification CLI and CI including Slither plus real Java/chain integration.
- **Java chain relay:** transfer/job commit together; separate from broker outbox; salted commitments, chain-ID/runtime fingerprint checks, bounded RPC bodies/deadlines, remote signer, gas policy, durable retries, finalized storage/log validation, recovery from ambiguous sends, and no blind replacement of known pending transactions. Disabled by default. Public chains require finalized state; local chain 31337 can use latest.
- **Authorization:** `LEDGER_API_KEY` must match on Java and BFF and be random / 32+ characters. New workflows fail closed when missing. A configured key protects all Java routes except health, including metrics. Chain enablement requires a key. Wallet authorization and transfer-participant checks protect BFF imports/proofs. Docker Compose now requires the key.
- **UI:** Wallet CSV template/upload/result counts; Activity proof panel can fetch and download a chain receipt. Split and manual-spend retries retain a key after errors. Reused Pocket styling; no new frontend dependencies. Mobile/desktop screenshots and file-picker/error-path evidence under ignored `.verify/evidence/java-workflows/`; checked 390/1280 widths without overflow. Existing app JS gzip grew from 69.82 to 70.92 kB in this session.
- **Verification:** 196 assistant tests cover the original suite plus Java delegation, authorization, validation errors and transport failures; production build passes. 48 Java tests pass across the complete suite and added regression runs; jar packaging verified. 12 EVM tests pass. Full PostgreSQL + Java jar + Hardhat integration passes, including CSV deduplication/persistence, paid-request retry after JVM restart, conserved balances and exactly one anchor event. Slither 0.11.3 ran 100 detectors over 13 contracts with zero findings. Contract dependency audit reports zero vulnerabilities. Compose config and diff whitespace checked.
- **Failures fixed by verification:** PostgreSQL timestamp precision changed first-vs-replayed responses; CASE timestamp inference prevented relay state updates; HTTP/2 cleartext upgrades were incompatible with the local RPC server. Windows Oracle javapath was leaving a real JVM behind when its shim was killed; integration harness now resolves the actual Java executable. Temporary test processes/containers are cleaned up.
- **Release boundary:** public deployment still needs independently reviewed contract/deployment configuration, testnet soak, trusted RPC/signing gateway, verified source, multisig/admin/incident-role setup and rotation drills. These are not replaced by Slither. The existing app still simulates funding; identity/personal-finance persistence keeps its previous assistant database requirements. Activity/Patterns still project a bounded recent history (500 spend records); imports persist all accepted rows. No real bank synchronization was added.

## Session: CLI access and repository preparation (2026-11-05)
- Confirmed local commands and GitHub network access work with the session's full-access permissions.
- Located the existing checkout at `C:\Users\Az040\Projects\p2p-ledger`; fetched origin and updated local `main` to `735a8a8` with no divergent main commits.
- Preserved the existing `.gitignore` edit and the original `feat/email-sign-in` branch tip. No product code changed or tests run.
- Pending requested work: expand Java ownership of daily workflows, implement the currently documentation-only Solidity integration, and improve practical integrations. Read the current architecture and product rules before choosing scope.

## Session: display names with digits (2026-11-01)
- **Bug:** Signup rejected any display name containing a digit. Found in the PR #25 live check: "Verify Check 25" got a 400 from `POST /api/auth/register`, so the verification account was created under a letters-only name.
- **Root cause:** `displayNameField` in `assistant/src/server/app.ts` allowed letters, spaces, `'`, `.`, `-` only.
- **Fix:** The rule now also allows digits after the first letter. Underscores and other handle characters are still refused with "Use your name, not a handle."
- **Verify:** New regression test in `assistant/test/auth.test.ts` (registers "Verify Check 25", still refuses `sam_lee99`); it failed with 400 before the fix. Full assistant suite passes (186 tests) and `tsc --noEmit` is clean.

## Session: email sign-in, account-first welcome
- **Auth:** `POST /api/auth/register|login|logout` and `GET /api/auth/session`. Passwords are scrypt hashes. The session is an httpOnly `settle_session` cookie (30 days), stored in memory or in Postgres `app_users` / `app_sessions` when `DATABASE_URL` or `LEDGER_DATABASE_URL` is set (`identity.persistent` on bootstrap).
- **Welcome:** Create account and Sign in are the nav and the hero. The sample household is a text link. The name-only create-wallet form is gone. Signed-in chrome says Sign out and shows the email. The footer no longer calls the product a demo.
- **Still simulated:** the opening balance is $500 of ledger money, not a bank. Without a database URL, the account lasts until that server process restarts, same as the in-memory ledger.
- **Correction (2026-11-01):** the $500 signup funding was removed at the owner's direction — registration no longer calls the welcome package, new accounts start empty, and setup collects the person's own cash/cards/pace. `/api/bank/welcome` remains only as an explicit simulator action (ops console); demo/sample seeds are unchanged.
- **Verify:** `assistant/test/auth.test.ts` covers register, the session cookie, a wrong password, a duplicate email, logout, and signing back into the same wallet.
- **Trust copy:** the Trust tab describes the practice backend as an in-memory ledger that will not survive a server restart; this is a runtime/configuration state, not a Git commit state.
- **Production gate:** Vercel project `p2p-ledger` has `LEDGER_URL` configured and the Render ledger is healthy, but Vercel has no `LEDGER_DATABASE_URL` or `DATABASE_URL`; add a Postgres connection before relying on persistent sign-in. The production bootstrap currently reports `live: true`.
- **CI:** fixed the week-spend test's calendar drift by freezing its clock to the fixture's week; full assistant suite passes.
- **Wallet auth (uncommitted on `feat/email-sign-in`):** `createApp` now enforces the session on wallet routes via `walletAccessError` / `ownerAccessError` / `protectWalletPath` in `app.ts`. A registered wallet needs its owner's cookie (401 signed out, 403 for another user's wallet). Practice fixture accounts stay public. Enforcement is on when the auth store is persistent or `NODE_ENV=production` (`enforceWalletAuth` overrides). `POST /api/accounts` returns 403 while the live ledger is up, so wallets are created only through registration. `AuthStore.findByAccountId` and an `app_users.account_id` index support the lookup. Tests in `auth.test.ts`; `tsc` clean, 176 tests pass.
- **Still blocking launch:** add a Postgres URL (`LEDGER_DATABASE_URL`/`DATABASE_URL`) to Vercel, then merge PR #20 and redeploy the frontend. Not yet checked in a browser that the UI handles 401s from these routes.

## Session: premium visuals prompt
- Added `docs/ai/PREMIUM-VISUALS-PROMPT.md`: where the current visuals come from (routing, DESIGN.md, skills, motion-kit) and a staged `/pstack:poteto-mode` prompt that brings in View Transitions, `layoutId`/AnimatePresence, a Patterns pass, Rive Pip, a GSAP + Lenis scroll story on Welcome, and an R3F hero. Each optional unit has a bundle or LCP drop rule. Linked from `docs/DESIGN.md`. Not run yet.

## Session: verify-settle verification skill
- **Added** `.claude/skills/verify-settle/`: `SKILL.md` (launch, doctor, drive, evidence, cleanup), helper `verify.sh` (`up | doctor | pw <playwright-cli args> | evidence | down`), and `features/` map (demo, log-spend, activity, ask, create-wallet).
- **How it isolates:** Vite on `127.0.0.1:5199` (`VERIFY_PORT`), forced practice mode (`LEDGER_URL` to a dead port), LLM keys unset so Ask uses the fallback. Never touches the user's 5173 server. Kills only the listener PID it recorded.
- **Evidence:** `.verify/evidence/<run-id>/` (gitignored, survives `down`).
- **Proven:** up → doctor → demo → log a $7.25 Transport spend → `/api/.../habits` shows it → down; evidence kept. Activity, Ask, create-wallet recipes were mapped from live snapshots; activity filter/receipt steps not yet executed.
- **Not covered:** live-ledger paths (Postgres, bank corridors against Render, F3 audit), `/ops` terminal.

## Session: LazyMotion + inner tab pass (Activity, Wallet, Ask)
- **LazyMotion:** all `motion.*` became `m.*`; `ConsumerApp` wraps in `<LazyMotion features={loadMotion} strict>`; `motion-features.ts` re-exports `domAnimation` as its own chunk. Index JS went from 87.2 to 67.7 kB gzip; features chunk 5.8 kB loads after.
- **Activity:** removed the right-aligned summary; added `.stat-strip` (ink tile for money out, `CountUp`). Filter pill is ink-filled. List is keyed by filter so rows rise in (CSS `row-in`, first 5 staggered).
- **Wallet:** the net position is a `TiltCard` Settle card. Snapshot rows are a `<dl>` hairline list with mono amounts and no emoji. Pip replaces the dead `ask-glow` div on the Ask card.
- **Ask:** Pip in the header (`cheer` bumps when an answer arrives). The lime chat avatar replaces the violet one. Removed the `ask-orb`. Chat turns rise in.
- **Bug fixed during the pass:** the inner page grids had no explicit column, so the new stat strip pushed Activity to 487px at 390px width. Fix: `grid-template-columns: minmax(0, 1fr)` on `.patterns/.wallet-page/.activity-page/.ask-page`.
- **Verify:** 172 tests pass, build OK, checked desktop 1280 and mobile 390 with playwright-cli (scrollWidth = 390).

## Session: motion stack rules made permanent
- **Global:** `~/.agents/SKILLS-ROUTING.md` gained a "Motion and visual stack" table (Motion default; GSAP/Lenis/R3F for landing pages only; Rive for interactive mascots; Aceternity/Magic UI/React Bits as restyled references) plus rules (reduced motion, transform/opacity only, lazy-load heavy libs, `emil-design-eng` + `aura-farming` after). Claude and Gemini already import it; added `~/.codex/AGENTS.md` pointing Codex at it.
- **Repo:** `docs/DESIGN.md` gained "Motion stack budget": `motion` stays the only animation dependency; Rive is a Pip candidate; GSAP/Lenis allowed on Welcome only; no R3F. No code or dependency changes.

## Session: "Pocket" redesign (Welcome hero, Settle card, Pip mascot, motion)
- **Why:** Owner feedback: the UI felt AI-made and mediocre. Brief asked for an expensive hero with Framer-style motion, Stussy/Perplexity energy for a younger technical audience, Apple Pay minimalism, Notion decluttering, and a lovable mascot (Meta Muse).
- **Tokens:** replaced the bullet-journal tokens in `app.css` (ink/paper/volt lime; Bricolage Grotesque + Geist + Geist Mono). Removed the stacked "THE AURA" override tail and dead rules (old hero, phone mock, play tiles, week card) using a brace-aware filter; one new "POCKET" layer at the bottom of `app.css`.
- **New:** `Pip.tsx` (mascot with moods derived from real numbers via `pipMood`), `motion-kit.tsx` (`TiltCard`, `CountUp`, `RevealWords`, `InView`). Added dependency `motion` (Framer Motion).
- **Welcome:** rewritten. Dark hero with its own nav, condensed headline, tilting Settle card, Pip, a lime tape marquee, a bento "how it works" made from UI fragments, a lime own-wallet block. Same demo/create logic.
- **Today:** Pip greeting with a mood line (tap Pip to log; Pip jumps after a log via `cheer={burst}`), the dark card hero (net, ring, week left, delta vs last week, habit dots), three quick actions, a Perplexity-style ask bar. Removed the duplicate week card, the purple ask card and the "Weekly goal" tile (the ring and "Set one" cover pace).
- **Removed:** stock photos (`public/media`), `MediaPhoto`, `visual-assets`, `LottieMark` and the unpkg dotLottie script (it was 403ing). Demo guide shows a big step number instead of a photo.
- **Verify:** `cd assistant && npm test && npm run build` (38 files / 172 tests pass). Checked desktop + 390px + dark mode with playwright-cli.
- **Open:** JS bundle grew by roughly the size of `motion` (index chunk ~279 kB, 87 kB gzip); `LazyMotion` could trim it. Inner tabs (Activity, Wallet, Ask) only got the token swap, not a layout pass.

---

## Session: Impeccable roll + bullet-journal full theme
- Ran `impeccable context` + `concept-seed --scope direction --mode operate` (seed `98d70fceba27c1ae`). Roll assigned transit pass; **pinned** bullet-journal (#1 grounded) per PRODUCT + owner — Operate-safe, keeps ring/photos/sheets.
- Replaced monochrome tokens end-to-end in `app.css` (paper dot grid, sage pen, Sora/Spectral). Signature: habit dots on Today hero + week card. `.impeccable/config.json` → `buildPath: code`. Surface brief v2 + `docs/DESIGN.md` updated.

## Session: revert half punch-card; restore Settle UI + DESIGN.md
- **User feedback:** Punch-card branch was unusable — old `app.css` + thin `punch-card.css` + removed photos = incoherent half redesign.
- **Root cause:** Unattended Impeccable concept roll (café punch card) + `frontend-design` “pick extreme” without `docs/DESIGN.md` pin; Operate UI swapped to `PunchRow` while Persuade imagery was deleted.
- **Fix:** Restored consumer app from `main` (MediaPhoto, visual-assets, media JPEGs, weekly ring Home, category colors, welcome phone preview). Added `docs/DESIGN.md` as the visual contract tied to `docs/PRODUCT.md`.
- **PR #15:** Branch `redesign/punch-card` should be updated with this revert or closed in favor of a future **full** redesign that replaces tokens end-to-end.

## Session: sheet backdrop dismiss vs text selection
- **Bug:** Setup weekly pace (and other `Sheet` modals) closed when triple-click / drag-select in inputs because the full `app-sheet-wrap` had `data-backdrop` and a naive dialog `onClick` treated release outside the panel as dismiss.
- **Fix:** `shouldDismissSheet()` in `sheet-dismiss.ts` — dismiss only when pointer down **and** up are outside `app-sheet-panel`; capture-phase `onPointerDownCapture` on `<dialog>`; removed wrap `data-backdrop`. Unit tests in `test/sheet-dismiss.test.ts`.
- **Audit:** All modals use shared `Sheet` (`SetupSheet`, `SimpleSheets`, `SettleUp`, `ActivitySheet`). Header menu uses `mousedown` + `contains(menuRef)` only (unchanged).

## Session: motion, preloader, playful copy
- Branded **AppPreloader** (~720ms) with S marque + ring; smooth scroll on `html`.
- Home **play tiles** (emoji + plain language), tappable week ring, staggered section entrance.
- Demo badge “Your quest”; log sheet title “What did you buy?”; FAB “I spent $”.
- `prefers-reduced-motion` disables decorative animation.

## Session: category colors, demo Patterns, spend→net, favicon

### Done
- **Category colors:** `categories.ts` uses distinct hex hues per spend category so Pattern peek donuts, Patterns legend, and Insights donut show multi-color segments.
- **Demo Patterns:** Removed dead `demo-smoke` CSS; Patterns demo bar is sticky with only “← Back to demo home” (no full-screen smoke).
- **Log spend lowers net:** Onboarding defaults `spendLogsAffectWallet: true`; step 3 copy clarifies weekly pace vs net formula; demo Anthony seed sets `spendLogsAffectWallet: true`. Optimistic path in `ledger-mutations.ts` already respects `profile.spendLogsAffectWallet`.
- **Favicon:** Root cause was missing `public/` asset and no `<link rel="icon">` in `index.html`. Added `assistant/public/favicon.svg` and icon link; Vite serves it at `/favicon.svg` on dev (5173).

### Verify
`cd assistant && npm test && npm run build`

---

# Engineering Handoff: root `npm run dev` + UI/UX polish

## Root DX
- Added repo-root `package.json` with `dev` / `dev:stack` delegating to `assistant/` via `npm run … --prefix assistant` (no npm workspaces).
- Updated `AGENTS.md` with layout and dev commands.

## Prior UI/UX polish (summary)
- Hero contrast, Patterns peek, Demo guide, topbar, log spend sheet, `netMinor` from `projectedCash`, setup pace chips, `/ops` terminal refresh.
- Income/spend sheets use `ledger-store.run` via `ledger-mutations.ts`.

## Session: PR #27 product review and spending journey (2026-11-05)
- Reviewed PR #27 and the Java/BFF spending path. The reported Spring `No static resource .../spends` is consistent with the documented preview/production version mismatch: this branch contains SpendingController, while the prior handoff explicitly did not deploy Java. No deployment performed; root cause requires confirming the running backend version and deploying the matching artifact/migrations.
- Changed the consumer spend sheet to category bubbles → amount bubbles/custom amount → review and save; retained idempotency and undo. Corrected misleading copy about personal spending versus money movement. No new dependencies or animation runtime.
- Mapped upstream Spring missing-resource workflow failures to 503 without leaking internal paths; added regression coverage. This improves error handling, not backend availability.
- Auth review: signup opens a Java account before identity insertion; partial failures/racing signup can orphan accounts. Provisioning needs durable idempotency/reconciliation. Existing scrypt/session/reset code does not establish enterprise readiness.
- Remaining requested scope: coherent Settle balance/activity model, simpler onboarding, identity provisioning redesign, verified-email/provider/passkey strategy, distributed abuse controls, operational readiness and real payment-provider integration. Existing funding remains simulated. Do not represent the current change as a complete product rebuild or production approval.
- Verification: typecheck passed; full app test/build results recorded in session output. Browser validation remains outstanding.
