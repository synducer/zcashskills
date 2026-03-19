---
phase: 02-viewing-keys
plan: 02
subsystem: skills-js
tags: [javascript, viewing-keys, zip-316, uivk, ufvk, skill, jest, unit-tests, fvk-gate]

# Dependency graph
requires:
  - phase: 02-viewing-keys
    plan: 01
    provides: "deriveViewingKey(passphrase, encSeed, salt, nonce, network, keyType) Neon function — UIVK and UFVK outputs"
provides:
  - "getIncomingViewingKey skill — VIEW-01: JS wrapper reading wallet file, calling deriveViewingKey with keyType='incoming'"
  - "getFullViewingKey skill — VIEW-02: FVK_CONFIRMATION_REQUIRED gate without confirm: true; VIEW-03: UFVK encoding via Rust"
  - "viewingKeys namespace on zcashSkills and skills array — accessible as zcashSkills.viewingKeys.*"
  - "15 unit tests covering happy paths, validation, confirm gate, wrong passphrase, wallet file errors"
affects: [03-chain-scanning, 04-send-transaction, 05-agent-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JS skill owns filesystem I/O only — wallet JSON read in JS, all crypto delegated to native.deriveViewingKey"
    - "FVK explicit opt-in gate: confirm param checked before any I/O or native call (VIEW-02)"
    - "jest.mock native-loader + real temp wallet file for tests — same pattern as wallet-persist.test.js"
    - "_loadWalletFile private helper validates required wallet JSON fields before FFI call"
    - "Dual export: module.exports = {fn} and module.exports.fn = fn for named import compatibility"

key-files:
  created:
    - "skills/viewing-keys/index.js — getIncomingViewingKey + getFullViewingKey with .meta, 166 lines"
    - "test/unit/viewing-keys.test.js — 15 unit tests, 3 describe blocks, 0 failures"
  modified:
    - "lib/index.js — require + viewingKeys property on zcashSkills, 'viewing-keys' in skills array, skills.viewingKeys namespace"

key-decisions:
  - "FVK gate checked before any filesystem I/O — confirm: true must be explicit, not just truthy-via-passphrase"
  - "Jest mock strategy: mock native-loader globally, write real temp wallet file for happy path — avoids fs mock complexity"
  - "15 tests > 10 minimum: added native.deriveViewingKey call args test and missing-passphrase-with-confirm test for completeness"

requirements-completed: [VIEW-01, VIEW-02, VIEW-03]

# Metrics
duration: 3min
completed: 2026-03-20
---

# Phase 2 Plan 02: Viewing Keys — JS Skill, lib/index.js Wiring, Unit Tests Summary

**JS viewing-keys skill with FVK explicit opt-in gate (FVK_CONFIRMATION_REQUIRED), lib/index.js wiring, and 15 passing unit tests — all three VIEW requirements satisfied end-to-end**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T18:47:28Z
- **Completed:** 2026-03-19T18:50:07Z
- **Tasks:** 2 of 2
- **Files modified:** 3

## Accomplishments

- Created `skills/viewing-keys/index.js` following the wallet-persist skill pattern: JS owns filesystem I/O, all crypto delegated to `native.deriveViewingKey` via FFI
- `getIncomingViewingKey` satisfies VIEW-01: reads wallet JSON, calls `deriveViewingKey` with `keyType='incoming'`, returns `{ success: true, viewingKey: 'uivk1...', keyType: 'incoming', network }`
- `getFullViewingKey` satisfies VIEW-02: returns `{ success: false, code: 'FVK_CONFIRMATION_REQUIRED' }` without touching the wallet file or native module when `confirm` is falsy
- VIEW-03 satisfied via Rust layer (from Plan 01): UFVK encoded as `uview1...` via `UnifiedFullViewingKey::encode(&Network::MainNetwork)`
- `lib/index.js` updated: viewingKeys required, added to `zcashSkills` object, `skills` array, and `zcashSkills.skills.viewingKeys` namespace
- 15 unit tests written covering: IVK happy path, IVK native args, missing passphrase, missing wallet file, missing wallet field, native throws, .meta property, FVK no-confirm, FVK false-confirm, FVK happy path, FVK native throws, FVK missing passphrase, FVK missing file, FVK .meta, lib/index wiring
- Integration smoke test: real Argon2id + XChaCha20 decrypt chain produces `uivk1...` and `uview1...` prefixes
- Full test suite: 41/41 tests pass, 3 suites, no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create skills/viewing-keys/index.js skill** - `2705aa9` (feat)
2. **Task 2: Wire into lib/index.js and write unit tests** - `c5f1b9c` (feat)

## Files Created/Modified

- `skills/viewing-keys/index.js` — Created: getIncomingViewingKey (VIEW-01), getFullViewingKey (VIEW-02/03), _loadWalletFile helper, .meta objects (166 lines)
- `test/unit/viewing-keys.test.js` — Created: 15 tests, 3 describe groups, real temp wallet fixture + native mock (248 lines)
- `lib/index.js` — Modified: require viewing-keys, viewingKeys on zcashSkills object and skills array, skills.viewingKeys namespace

## Decisions Made

- **FVK gate before I/O:** `confirm` is checked as the very first statement in `getFullViewingKey` — before reading the wallet file or calling native. This is intentional: no I/O should happen when the user hasn't opted in explicitly.
- **Test strategy — real temp file, not fs mock:** Writing a real temp wallet JSON and cleaning up in `afterEach` is simpler and more realistic than mocking `fs.readFileSync`. The approach matches `wallet-persist.test.js`.
- **15 tests chosen over minimum 10:** Added native args verification test and `confirm: true` + missing passphrase test to improve coverage without redundancy.

## Deviations from Plan

None — plan executed exactly as written. All task code matched the plan specification verbatim.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 2 complete: both plans (02-01 native Rust function, 02-02 JS skill + tests) fully delivered
- All three VIEW requirements satisfied: VIEW-01 (IVK), VIEW-02 (FVK gate), VIEW-03 (ZIP-316 bech32m UFVK encoding)
- Phase 3 (Chain Scanning) can now build on the viewing key primitives for lightwalletd integration

## Self-Check: PASSED

- FOUND: skills/viewing-keys/index.js
- FOUND: test/unit/viewing-keys.test.js
- FOUND: lib/index.js
- FOUND: .planning/phases/02-viewing-keys/02-02-SUMMARY.md
- FOUND: commit 2705aa9 (Task 1)
- FOUND: commit c5f1b9c (Task 2)
- All 41 tests pass (npm test)
- Integration smoke: uivk1 prefix, uview1 prefix, FVK gate confirmed

---
*Phase: 02-viewing-keys*
*Completed: 2026-03-20*
