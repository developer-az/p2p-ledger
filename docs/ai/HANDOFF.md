# Engineering Handoff: Performance Optimizations (Rebased on Latest Main)

## Overview
Rebased performance optimizations onto latest `origin/main` (commit `0f0b70f`), resolving all branch divergences and conflicts with merged PRs #10, #11, and #12.

## Changes Completed

### 1. Database Indexing (`ledger-service`)
- **File:** `ledger-service/src/main/resources/db/migration/V2__performance_indexes.sql`
- **Fixes:**
  - Added composite index on `transfers(destination_account_id, created_at)` and keyset indexes on `(destination_account_id, id desc)` and `(source_account_id, id desc)` to eliminate full table scans during transfer lookups in `TransferRepository.findByAccount()`.
  - Added partial index on `transfers(id) where status = 'REJECTED'` for `AuditRepository.rejectedWithEntries()`.
  - Added covering index `ledger_entries(account_id, amount_minor)` enabling index-only scans for `AuditRepository.accountsDrifted()`.
  - Added partial index `outbox_events(published_at, created_at) where published_at is not null` for P95 latency percentile queries.

### 2. N+1 Queries & Request Hotspots (`assistant/src/server`)
- **Files:**
  - `assistant/src/server/peer-ledger.ts`
  - `assistant/src/server/ledger.ts`
  - `assistant/src/server/app.ts`
- **Fixes:**
  - Converted sequential `for ... of` await loop in `listPeerRefs()` to concurrent `Promise.all` resolution.
  - Added in-flight request coalescing and short-lived caching (5s TTL) in `HttpLedgerClient.getAccount()` to eliminate duplicate account HTTP roundtrips between `loadAccountView()` and `listPeerRefs()`. Cache is purged upon write mutations (`openAccount`, `deposit`, `transfer`, `postDeposit`, `postTransfer`).
  - Removed full 8-query database integrity run from `/api/bootstrap` startup probe.

### 3. Re-render Loops & 60fps Animations (`assistant/src/web`)
- **Files:**
  - `assistant/src/web/TerminalApp.tsx`
  - `assistant/src/web/pixel/PixelStage.tsx`
  - `assistant/src/web/GuidedLedgerStory.tsx`
- **Fixes:**
  - Isolated the 1,000ms clock interval into `<LiveClock />` leaf component, preventing root-level re-render thrashing.
  - Replaced 70ms React interval re-renders in `GuidedLedgerStory` with an internal `requestAnimationFrame` loop in `PixelStage`, throttling canvas buffer resizing to client dimension changes and upgrading canvas animation to 60fps.

### 4. Bundle Optimization & Vendor Splitting (`assistant`)
- **File:** `assistant/vite.config.ts`
- **Fixes:**
  - Added Rollup manual chunking to isolate `vendor-react` (`react`, `react-dom`) from application code.
  - Reduced main application bundle chunk size from 323.83 kB down to 104.90 kB (28.97 kB gzipped) — a 68% reduction in initial app payload.

## Verification
- Vitest suite passed: 29 test files, 129 tests.
- TypeScript compiler (`tsc --noEmit`) and Vite production build passed.
- Branch rebased cleanly on latest `origin/main` (`0f0b70f`) with zero conflicts.
