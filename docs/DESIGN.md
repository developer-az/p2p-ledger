# Settle: Workbench

One quiet application, with a small friendly companion. Utility-first like a desktop tool: obvious controls, readable records, little decoration. Familiar language and Pip provide warmth without a mascot competing with every task.

- Ground: sage gray #e6ebe3, distinct off-white panels #fdfefb, forest #214e39 summary/action anchors; system dark mode supported. Existing ink, muted text and accessible category colors remain.
- Typography: Geist UI, Geist Mono for metadata. Regular sentence case. No oversized condensed headlines in the app.
- Flat surfaces, hairline dividers, 6px controls and 8px panels. No glass, sheen, tilt, marquee, gradient cards or decorative hero objects.
- Welcome is a compact two-column introduction and account form, stacking on mobile. Available account/recovery capabilities come from bootstrap. Unavailable controls explain why and offer the sample before collecting input.
- Today: one small Pip, category choices, income/split/pattern shortcuts, three summary numbers and recent activity. Starting numbers stay optional. The sample guide opens only on request.
- Navigation: Today, Activity, Wallet in a fixed full-width bar. Ask stays contextual. Forms retain category/amount/review, idempotency and undo.
- Money estimates never imply a connected bank balance. Sample data is identified explicitly. Missing email delivery must never display a sent-email confirmation.
- Motion: installed motion/react only. Pip is the sole expressive visual. Honor reduced motion. No new dependencies. Keep interactions below 300ms except existing optional Pip character playback.

Verification: inspect mobile 390px and desktop 1280px, keyboard focus, unavailable-account and email-recovery states, spend save and undo. Existing Patterns, Activity and Ask reuse flat typography and surface tokens.
