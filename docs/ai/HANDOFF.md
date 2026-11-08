# Engineering Handoff (latest)

## Session: main redesign integrated with Google auth and contrast fixes (2026-11-08)
- Pulled origin/main (140ace3) into fix/verify-render-rollout; resolved Welcome, CSS and handoff conflicts retaining Sky redesign and existing Google OIDC/backend, consent, account access and policy routes. Restored Google entry inside the Sky account form; preserved owner .gitignore edit.
- Scoped daytime hero/auth tokens to their light surfaces even in dark mode; stopped hero fading into dark ground under dark text. Improved secondary text, dark-card labels, ring labels and Ask copy contrast; fixed stat-label specificity and removed dock color interpolation across opposite backgrounds. Retained shared account-access field styles.
- Locked AddSheet writes synchronously and disabled mode/amount/note/split changes and dismiss while saving. Delayed-request browser regression proved one POST, blocked Escape/mode switch, success and Undo. Reusable local practice check: assistant/scripts/check-add-sheet.browser.cjs via playwright-cli run-code.
- Validation: 222 unit tests pass, one optional PostgreSQL test skipped; production build passes. Browser: sample spend/undo, all four dock tabs in light/dark at 390px without horizontal overflow, desktop Activity, reset-form navigation, Google consent gating. Google entry/routing verified with local capability response stub (local provider intentionally unconfigured); no real Google token exchange or live-account writes in this session. Screenshots under ignored .verify/readiness-*.png; no browser errors, only expected reduced-motion development warning.
- Live read-only bootstrap on Nov 8: persistent identity true, Google capability absent, signupAvailable false, signin/password-reset available. This deployed release does not include this branch's Google implementation; signup unavailability may involve previously documented backend cold starts. No deployment, push or main merge performed. Fresh real-provider sign-in and production readiness check remain release gates; do not claim every function or live production is certified.


## Operational result: production accounts restored; verified recovery sender deployed (2026-11-06)
- PR #29 merged at 0a47e5161c6ef41109dd5e3e4adbfd382b56b5a7. Main CI run 42271204464 passed and deployed the native image to the correct Render service; authenticated workflow version 2 verified.
- Owner supplied the Cloudflare token. Added only the four Resend DNS records after conflict checks. All exact public DNS values match; existing root/www/ledger records are unchanged. Resend reports anthony-zhou.com and all four records verified; open/click tracking disabled.
- Created a sending-only credential restricted to the verified domain. Domain-management request returns 401 restricted_api_key (expected restriction, not an invalid credential). Installed it as Vercel Production RESEND_API_KEY and configured MAIL_FROM to Settle <no-reply@anthony-zhou.com>. Management credentials remain outside the repository and were not deployed.
- Redeployed existing production release through Vercel. Public deployment check reports Signup, Sign in, and Reset email AVAILABLE. All 15 production login/ledger checks passed again, including persisted login, wrong-password rejection, expense save/replay/reload/undo, unchanged ledger funds, logout/session revocation. Verification account remains unfunded and expense removed. No UI/design changes.
- Actual recovery inbox delivery remains unverified. Asked owner permission to send one reset verification email to their known Gmail; answer pending at this checkpoint. Do not claim delivery based on bootstrap availability or generic reset HTTP202. Do not change owner password or create an owner account silently. No real email sent in this phase.
- Private credentials remain under ~/.p2p-secrets, never committed or printed. Ignored .verify scripts/evidence hold operational metadata only. Preserve owner's existing .gitignore modification.
## Session: Settle "Sky" redesign: one add button, livelier Pip, sign-in above the clouds (2026-11-08)
- Branch design/settle-clouds from origin/main 0a47e51. Owner asked for easier use, fewer buttons, a more lively mascot and a sign-in/create-account screen "like you are in the clouds".
- Adding: new AddSheet.tsx replaces LogSpendSheet and IncomeSheet (removed from SimpleSheets.tsx). Amount first, then the category or income-source tile tap saves; "I spent / I got paid" switch; recent spends are one-tap repeats with Undo; note behind "+ Add a note"; "Splitting a bill?" opens Settle Up. Same API calls, idempotency key and optimistic walletRun path as before.
- Fewer controls: dock is Today, Activity, raised lime "+", Patterns, Ask (FloatingDock onAdd). Wallet moved to the account menu. Removed the top-bar Ask button, the floating "I spent $" button, the Today quick-action row, the Today settings icon, and the ask bar's chip buttons (the placeholder now cycles example questions; an empty submit asks the one shown). Today shows about 12 fewer buttons.
- Pip: sprout on a spring that leans against the gaze, hands and feet, idle fidgets, hover reaction, squash-and-stretch hop, lookAt/shy/peek/greet/idle props. Hands animate by position only (rotation on an SVG ellipse turns about its own box).
- Sheet focus fix (ui.tsx): showModal() focused the Close button and React's autoFocus lost, so typing went nowhere until the field was clicked. Sheets now focus an element marked data-autofocus after showModal. This also affected the old log sheet.
- Look: app tokens are a daylight sky palette with float shadows; Welcome hero is a daytime sky with drifting clouds; the account section is AuthSky.tsx (morning sky, cloud layers, sun, twinkles, Pip on a cloud, frosted card, floating labels, Show/Hide password, Pip covers its eyes on the password). Old dark hero, grain, lime account card and dead quick/fab/log-sheet CSS removed. docs/DESIGN.md updated to "Sky".
- Follow-up (owner: old background still showing mid-page and at the bottom; wanted the sky inside the app too): SkyBackdrop, a fixed sky with drifting clouds behind every screen; hero and sign-in scene fade into it; footer on the cloud floor; every black surface (Settle card, Ask card, stat tile, welcome Ask tile, toasts, dock, sheet overlay) is now evening-sky blue; cards are white cloud-glass.
- Verified: tsc, 212 tests pass (1 optional Postgres test skipped), vite build, desktop and 390 px phone screenshots of Welcome, sign-in, Today, add sheet, Activity, Patterns, Ask, Wallet. Two-tap spend and one-tap repeat confirmed in practice mode. Live sign-up was not exercised against the production database.

## Session: authenticated Render repair and native workflow failure (2026-11-06)
- Owner saved a Render API key at the agreed private path, authorizing service repair. Authenticated service srv-db5d8dg473hc73ao3nbg and found its last live deployment was October 16; later CI hook calls had not deployed it. Render had no service key.
- Confirmed Render and Vercel target the same PostgreSQL account store using credential comparisons and account fingerprint checks (361 accounts, Flyway V1). No credentials/PII printed. Diagnostic JDBC-to-Node adaptation initially rejected pooler login until credentials were embedded correctly for the Node driver; this was not a database credential defect. No database target/credentials changed.
- Generated a shared service key in .p2p-secrets, configured Render (then undeployed), Vercel Production and GitHub; redeployed current production BFF first, then deployed pinned CI-tested Java image 0c21dea directly via Render API. Render deploy dep-dbn1ivs9v7es739vscv0 became live; Java version 2/auth checks and /api/ready passed; signupAvailable=true. Reset email remains unconfigured.
- Live dedicated verification account proved signup, session issuance and empty account access, then exposed a native-only expense failure. Render logs identify UnsupportedFeatureError: record components unavailable for SpendingService.Input during JSON hash serialization. No real funding/transfers executed; owner email/password not used. Separate verification credentials are private; failed expense calls did not persist entries.
- Added RegisterReflectionForBinding for internal spending input and payment split/payer records; extended actual native smoke tests to spending/replay/read/undo and split/replay/cancel under service authentication. Java package compiles; native CI is the required regression gate.
- Replaced stale-hook CI deployment with authenticated Render API targeting the known service; polls exact deploy ID to live before workflow readiness. Set GitHub RENDER_API_KEY secret and RENDER_SERVICE_ID variable securely; service credential also configured. Seven standalone deploy-gate tests pass, Bash syntax and YAML checked. Existing design untouched.

## Session: production login, browser errors and Render rollout diagnosis (2026-11-06)
- User supplied the email they tried. Queried production app_users and app_signup_attempts with exact case-insensitive parameterized lookup; neither an account nor a pending signup exists. No PII, password hashes or secret values printed. Temporary production environment/account lookup files deleted. No password or auth bypass requested/implemented.
- Live bootstrap: persistent identity storage, signupAvailable=false, signinAvailable=true, reset unavailable, ledger live=true. /api/ready is 503. Render health is UP, but /v1/capabilities is 404. Thus basic ledger is up but required workflow API is still absent.
- Clean production browser produced zero Perplexity requests, CSP errors or extension runtime errors. Repository also has no Perplexity/FKGrotesk reference. Do not broaden CSP to accommodate browser-injected resources.
- Main ledger deployment run 42184983208 reported Deploy triggered after hook acceptance, with no verification of the deployed service. Added bounded authenticated workflow-version verification, five standalone Node regression tests, YAML validation, missing-config failure instead of successful skip, main-only production publication/deployment, and Render blueprint service-key declaration. Existing layout/auth behavior unchanged.
- Actual signup is not repaired by these pipeline changes. Requested authenticated Render access (integration or local credential location) to inspect rollout and configure matching Java/Vercel/GitHub service keys. No Render tools/credentials currently available. No production deploy/retry triggered and no main merge of this change.

## Session: owner-approved merge of follow-up fixes (2026-11-06)
- Owner requested merge to main if fixed. Confirmed PR #27 was already merged at 0c21dea. Created fix/account-readiness-feedback from current origin/main for the newer local message/preflight/form fixes.
- Full local verification: 212 tests pass, 1 optional PostgreSQL test skipped locally (CI enables it), production build and whitespace checks pass. Reviewed changes: no visual/CSS changes, no credential logging, no relaxation of signup authorization or backend compatibility guards.
- Follow-up includes accurate unavailable/signup wording, suppression of contradictory saved-state reassurance, native field validation/busy handling, ledger URL whitespace handling, release configuration/version preflight and regression coverage. Original user .gitignore change remains excluded.
- Merge authorization covers these verified code fixes. Production service-key and email-sender blockers remain separate; merging does not certify working signup or reset delivery.

## Session: contradictory account availability messages (2026-11-06)
- Owner reported an account-service failure alongside Saved with the ledger. Cause: Welcome showed persistence reassurance solely from identity.persistent even when signupAvailable=false.
- The original form now hides persistence reassurance when the selected account action is unavailable, while loading, or during password recovery. Available signup uses prospective wording rather than claiming success; sign-in copy describes returning to records. Existing styles and layout unchanged.
- Backend failure text now states account creation is unavailable rather than asserting an update is in progress. This copy correction does not configure or restore Java/account services.
- Added real component server-render regressions for persistent storage with disabled signup and available signup. Both plus auth regressions pass (10 tests); production build passes. Changes remain uncommitted with prior owner-reviewed release work.

## Session: production release verification and conservative component improvements (2026-11-06)
- Owner asked whether committing/pushing is sufficient, requested testing before release, and authorized improvements within the restored implementation without replacing the design.
- Read-only production checks: ledger.anthony-zhou.com/api/bootstrap returns 200 with identity.persistent=true but live=false; /api/ready is 404 on the existing release. Actual PostgreSQL connection succeeded and identity/session tables exist. No accounts, emails or ledger transactions were created during production checks.
- Downloaded production environment temporarily for checks, never printed secrets, and deleted each temporary environment file. LEDGER_URL was actually empty despite appearing in Vercel metadata. Confirmed GitHub's LEDGER_URL variable points to https://p2p-ledger.onrender.com; that service health returns 200/UP but /v1/capabilities returns 404 (old backend).
- Corrected production Vercel LEDGER_URL to the verified service, read back exact match, and set APP_URL to the verified production alias https://ledger.anthony-zhou.com. Used stdin without newline to avoid Windows escaped-CR corruption. No deployment or merge performed; environment edits apply to the next deployment. Matching LEDGER_API_KEY and Resend key/sender remain unconfigured and cannot be invented or set one-sided safely.
- Added npm run check:release and regression tests: required nonempty config, database presence, HTTPS URLs without embedded credentials, key length, then authenticated Java version check. This preflight is read-only and does not imply real inbox delivery.
- Existing Welcome form retains all layout/styles. Added required fields, password length bound, disabled fields while submitting, aria-busy, and duplicate availability-message suppression. No visual redesign. Instance normalizes whitespace/empty ledger URL for development fallback.
- Verification: 210 tests pass, one optional PostgreSQL integration skipped locally; build passes. Browser checked original form required/invalid-email validation, idle aria-busy state, and unavailable recovery being disabled; no CSS/layout changes. Production signup/reset cannot be certified until compatible Java, matching service credentials and mail delivery are configured. Do not answer that a push alone makes these work.
- Changes left for owner review/commit as requested. Preserve existing .gitignore change.

## Session: repeated deployment account-unavailable report (2026-11-06)
- Rechecked Vercel environment metadata: Preview still only has LEDGER_URL and GEMINI_API_KEY; LEDGER_DATABASE_URL remains Production-only. No Render/Supabase CLI, environment credentials, or local .p2p-secrets configuration was available. GitHub secrets include a Render deploy hook but cannot supply or configure database/API-key/email credentials.
- Discovered unconnected Render and Supabase plugins via Plugin Management and suggested both as the concrete access path to provision isolated preview services. Do not bypass durable signup guards, silently copy production identities, or resume visual changes. User connection/service access is the remaining dependency. No application code changed in this turn.

## Session: owner-requested design revert (2026-11-06)
- Owner explicitly requested reverting every design/UX change made in this conversation and retaining technical work. Restored consumer components, CSS, DESIGN.md and PRODUCT.md to 539815a (before my first design changes). Reverted bubble journey, Workbench layout, palette, navigation changes, hero removal, copy/motion changes and onboarding changes.
- Retained only functional wiring in restored UI: SetupSheet sends rebaseCash to prevent double deductions; original Welcome honors backend account/recovery availability using its existing form/styles. No new visual treatment added.
- Kept all backend, Java ledger, provisioning, security, reset, clock-consistency, capability-check, CI, deployment documentation and regression-test work. Preserved owner .gitignore edit. Design/UX ownership belongs to the user; do not resume redesign work without a new explicit request.
- Validation: 206 tests pass, 1 optional PostgreSQL integration test skipped locally; production build passes. Diff against 539815a confirms only SetupSheet.tsx and Welcome.tsx retain functional changes in the restored consumer UI.
- Existing external blocker is unchanged: Preview has no isolated identity/backend/service-key/email setup. Do not claim working preview signup or inbox delivery until those services are configured.

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

## Session: signup cold-start recovery (2026-11-07)
- Live bootstrap initially reported persistent identity with signup disabled; readiness returned 503 while Render health was UP. After warming, bootstrap reported all account actions available. Render deployment and configured environment names checked read-only.
- ConsumerApp now refreshes unavailable signup capabilities at 5, 20 and 45 seconds, with cleanup on recovery/unmount, so an initial cold-start failure can recover without reloading. No deployment performed; local typecheck passed.


## Session: signup recovery deployed (2026-11-07)
- User authorized production deployment. Production build passed. Installed Vercel CLI 41 was rejected by upload API; used npx vercel@latest (65.12.1) successfully.
- Deployment dpl_57S6RsDTKH73knjd4xmuj9j2qrNF is READY and aliased to https://ledger.anthony-zhou.com. Live bootstrap HTTP 200 confirms persistent identity and signup/signin/password reset available. No account or email created. Source changes remain uncommitted; preserve owner .gitignore changes.


## Session: border fix live; Google auth preparation (2026-11-07)
- Removed browser default consumer body margin and undefined --dot-grid background layer. Build passed; deployed dpl_AHggYiBjV1WAdy27pPHm4tgsxcvn. Live browser confirmed margin 0px, app left 0 and width 1280 matching viewport.
- User requested Google authentication and privacy/legal considerations, then confirmed no OAuth client exists. Added jose-based OIDC flow, signed state/nonce/PKCE, Google JWT validation, stable-subject mapping, explicit session-bound existing-account linking, minimal identity scopes, UI and focused tests. 13 targeted tests and build passed before final enable-flag change; targeted tests repeated after flag.
- Google work remains LOCAL and disabled behind GOOGLE_AUTH_ENABLED plus credentials. No Google Cloud client/consent configuration available. Setup and outstanding privacy/terms, disconnect/deletion UX and real-provider validation are documented in docs/ai/GOOGLE-AUTH-SETUP.md. Do not claim legal compliance or live Google sign-in. No real Google sign-in attempted. Existing owner changes preserved.


## Session: Google Cloud project created (2026-11-07)
- Owner now has a Google Cloud project. Provided current Google Auth Platform branding/audience/client setup instructions, exact production callback, and private credential storage path. OAuth client credentials remain pending; Google auth stays disabled and local.


- Opened private Google client secret text file in Notepad at owner's request; contents not read or printed.


- Owner confirmed Google secret saved; checked only nonempty status and whether OAuth JSON/client-ID file is available, without displaying credentials. Client ID still needed if plain secret only.


- Rechecked Google secret file after owner saved: nonempty status verified without printing contents. Client ID remains needed unless supplied separately.


## Session: Google credentials configured (2026-11-07)
- Owner supplied OAuth client ID; private secret file nonempty. Saved ID privately and configured GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in linked Vercel Production via stdin with credential output suppressed. Explicit GOOGLE_AUTH_ENABLED=false configured; no deployment or live Google sign-in attempted.
- Remaining work: privacy/terms with actual operator/contact and retention decisions; disconnect/deletion controls and provider validation. Need operator legal name/support email and intended geography/age audience to avoid inventing policy representations.


## Session: operator and audience clarification (2026-11-07)
- Owner provided public support Az040205@gmail.com and US-only audience. Operator legal name pending. Owner asked recommended age for budgeting/subscription/savings/financial-help app; explained operator and recommended an initial 18+ audience, with COPPA distinction and no assertion that age gate alone establishes compliance.


## Session: business and recruiting strategy (2026-11-07)
- Owner accepted initial 18+ audience. Asked whether to form company for Settle, Stencil and racket form, and how to improve 2027 SWE/analyst recruiting credibility. Recommended truthful independent product studio/founder-engineer positioning, one flagship with real user evidence, and considering home-state single-member LLC based on actual risk/cost rather than title. Reviewed SBA/IRS primary business-structure sources. Need operating state and legal operator name before specific formation/policy changes; no company formed or external profile changed.


- Owner confirmed Maryland. Checked Maryland SDAT formation/annual-report sources; discussed base LLC filing cost, annual reporting and resident agent, with staged recommendation tied to actual launch risk and recruiting priorities. No formation authorized or filed.


## Session: Google completion in progress (2026-11-07)
- Fixed origin validation, required JWT claims, authenticated link-start requirement, deterministic private signup reservation credential for ledger-outage retries, and OAuth callback reconciliation of stale local sessions.
- Added transactional Google disconnect/session revocation with password verification and an account-access UI; deletion/data requests use owner-provided support email with ownership verification. Added state/origin/link regressions. Targeted prior 13 tests and build passed; expanded Google regressions run separately.
- Operator legal name requested asynchronously and still pending. Policies and eligibility enforcement remain unfinished; production Google flag remains false. No new deployment yet. Do not present completed Google login or legal readiness.


## Session: Google sign-in deployed (2026-11-07)
- Owner confirmed legal operator Anthony Zhou. Published privacy/terms at /privacy and /terms with support email, U.S./18+ audience, data/provider disclosures and manual verified deletion/access request channel. Google entry requires eligibility/terms confirmation; this is self-attestation, not age verification.
- Enabled GOOGLE_AUTH_ENABLED in Vercel Production and deployed dpl_Cx8w51w7AhXWVZ7NFtChWMiLdJ3u to ledger.anthony-zhou.com. Build and 19 targeted tests passed. Live start endpoint returns 302 to accounts.google.com with exact callback and Secure cookie; browser confirms eligibility button disabled until checked and zero page margin.
- Real Google authentication/token exchange remains unverified and needs owner account interaction. Google console branding/privacy/terms URLs and audience publishing status must be set by owner if not already configured. No real user account created in this deployment verification. Source changes remain uncommitted.


## Session: post-setup live check (2026-11-07)
- Owner said done after Google branding/sign-in instructions; asked whether this includes completed Google sign-in or branding only. Read-only production checks: bootstrap HTTP 200, googleAvailable=true, signupAvailable=true; privacy and terms HTTP 200. End-to-end account login remains unconfirmed pending owner's clarification. No credentials or user records inspected.


## Session: auth polish deployed (2026-11-07)
- Owner confirmed real Google signup created their new account successfully. Requested professional auth UI and Google button.
- Added shared GoogleButton with multicolor G, dedicated responsive Google confirmation screen, busy/disabled states and policy/support links. Refined email auth panel from lime to neutral surface, clearer tab controls, bordered inputs, spacing and dark-mode text tokens. Kept backend flow.
- Build and 11 focused Google/welcome tests pass. Deployed dpl_7SmV5YbrgrfpzCiVjErp5df2UPTf to production. Browser screenshots reviewed at 390x844 and 1440x1000; no mobile horizontal overflow; consent keeps button disabled initially. Screenshots .verify/auth-mobile.png and auth-desktop.png. No new dependencies; JS gzip about +1.04KB and CSS +0.56KB versus prior release.


- Git status confirmation: Google auth and auth polish are deployed through Vercel CLI but remain uncommitted/unpushed. Current branch fix/verify-render-rollout at 5fa2be5 matches cached upstream (0 ahead/0 behind). No git commit or push performed in response to status question.

## Session: commit and push (2026-11-07)
- User authorized committing/pushing deployed Google sign-in, auth polish and related recovery/border changes. Full assistant suite: 221 passed, 1 optional test skipped. Prior production build passed. Staging only assistant source/dependency/test changes and project docs; owner .gitignore change remains local. Private secrets and verification artifacts excluded. Pushing existing fix/verify-render-rollout branch without merging main.

## Session: preview PR publication (2026-11-08)
- User authorized a new branch and PR for Vercel previews. Created codex/google-auth-contrast-preview from verified merge b813a95, retaining the Google restoration, contrast fixes and save guards. Publishing against main; no production deployment or main merge. Owner .gitignore change remains excluded.

