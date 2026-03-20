---
phase: 03-balance-and-sync
plan: 03
subsystem: api
tags: [balance-check, skill, grpc, native, lightwalletd, sapling, ufvk]

# Dependency graph
requires:
  - phase: 03-balance-and-sync
    plan: 01
    provides: native.scanBlocks(ufvk, network, buffers) Neon function
  - phase: 03-balance-and-sync
    plan: 02
    provides: createClient, getLatestBlock, fetchBlocksAsProtoBytes from lib/lightwalletd.js

provides:
  - skills/balance-check/index.js with checkBalance async function and .meta object
  - lib/index.js wired with balanceCheck skill
  - test/unit/balance-check.test.js with 13 unit tests covering SYNC-01 and SYNC-02

affects:
  - 03-04-PLAN.md (memo retrieval skill — can reuse checkBalance pattern for SYNC-03)
  - lib/index.js (balance-check skill now exported alongside wallet-persist and viewing-keys)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "birthday height fallback: if birthdayHeight is missing or 0, use Math.max(0, tipHeight - 100)"
    - "UFVK keyType='full' enforcement: checkBalance explicitly passes 'full' to deriveViewingKey (not 'incoming') — scan_block requires UFVK, not UIVK"
    - "v1 invariant: spendableZatoshis === confirmedZatoshis — receive-only wallet, no nullifier tracking yet"
    - "Jest mock pattern: mock native-loader, lightwalletd, and fs BEFORE require to prevent module side effects"

key-files:
  created:
    - skills/balance-check/index.js
    - test/unit/balance-check.test.js
  modified:
    - lib/index.js

key-decisions:
  - "keyType='full' enforced in checkBalance: deriveViewingKey must use 'full' (UFVK) not 'incoming' (UIVK) — Rust ScanningKeys::from_account_ufvks requires UFVK"
  - "v1 spendable === confirmed: Phase 3 is receive-only; Phase 4 adds nullifier tracking to exclude spent notes"
  - "birthdayHeight fallback to tipHeight - 100: handles wallets created in Phase 1 with placeholder birthday heights"
  - "Balance as BigInt for ZEC conversion: Number(BigInt(confirmedZatoshis)) / 100_000_000 avoids JS Number precision loss on large balances"

requirements-completed: [SYNC-01, SYNC-02]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 03 Plan 03: balance-check Skill Summary

**JS skill orchestration layer wiring Rust scan_blocks (Plan 01) and gRPC client (Plan 02) into checkBalance async function — returns confirmed and spendable zatoshi amounts with ZEC formatting for SYNC-01 and SYNC-02**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-20
- **Completed:** 2026-03-20
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created skills/balance-check/index.js: checkBalance reads wallet file, derives UFVK via native.deriveViewingKey('full'), fetches compact blocks via lightwalletd, passes to native.scanBlocks, returns structured balance result
- Wired balanceCheck into lib/index.js alongside walletPersist and viewingKeys following established skill pattern
- Created test/unit/balance-check.test.js with 13 tests: happy path (4), input validation (2), zero balance (1), birthday height fallback (1), error handling (4), skill metadata (1)
- npm test: 54 tests pass (41 existing + 13 new), zero failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement skills/balance-check/index.js** - `881a531` (feat)
2. **Task 2: Wire balance-check into lib/index.js and add unit tests** - `a628563` (feat)

## Files Created/Modified

- `skills/balance-check/index.js` - checkBalance async function with .meta object, SYNC-01 + SYNC-02 requirements referenced in comments
- `lib/index.js` - Added balanceCheck require, wired into zcashSkills object + skills array + direct skill access
- `test/unit/balance-check.test.js` - 13 Jest unit tests mocking native, lightwalletd, and fs

## Decisions Made

- keyType='full' enforced in checkBalance: deriveViewingKey must produce UFVK (not UIVK) — Rust ScanningKeys::from_account_ufvks requires UFVK. This is the most critical constraint from Plan 01.
- v1 invariant documented: spendableZatoshis === confirmedZatoshis (Phase 3 receive-only; Phase 4 adds nullifier tracking for spend detection)
- birthdayHeight fallback implemented: if wallet has missing or 0 birthdayHeight (placeholder from Phase 1), falls back to tipHeight - 100 — safe for new wallets
- Balance ZEC conversion uses BigInt to avoid Number precision loss on large zatoshi amounts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — plan code was correct as provided. All mocks worked as expected in Jest. No compilation or dependency issues.

## Next Phase Readiness

- balance-check skill is ready for integration testing with a live lightwalletd endpoint
- Plan 04 (memo retrieval / SYNC-03) can follow the same skill pattern
- transactionsJson from native.scanBlocks is available in scanResult but not exposed in v1 balance response — Plan 04 will use it for memo extraction

## Self-Check: PASSED

- skills/balance-check/index.js: FOUND
- lib/index.js (contains balanceCheck): FOUND
- test/unit/balance-check.test.js: FOUND
- Commit 881a531 (Task 1): FOUND
- Commit a628563 (Task 2): FOUND

---
*Phase: 03-balance-and-sync*
*Completed: 2026-03-20*
