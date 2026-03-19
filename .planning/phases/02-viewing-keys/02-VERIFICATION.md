---
phase: 02-viewing-keys
verified: 2026-03-20T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 2: Viewing Keys Verification Report

**Phase Goal:** Users can export privacy-appropriate viewing keys for selective disclosure and compliance auditing
**Verified:** 2026-03-20
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Calling `native.deriveViewingKey(..., 'mainnet', 'incoming')` returns a bech32m string starting with `uivk1` | VERIFIED | Live smoke test: `IVK prefix correct (uivk1): true` |
| 2 | Calling `native.deriveViewingKey(..., 'mainnet', 'full')` returns a bech32m string starting with `uview1` | VERIFIED | Live smoke test: `FVK prefix correct (uview1): true` |
| 3 | Wrong passphrase causes `derive_viewing_key` to throw a JS error (not crash the process) | VERIFIED | Live smoke test: `Wrong passphrase throws: true` |
| 4 | Invalid `keyType` causes a descriptive JS error | VERIFIED | Live smoke test: `Invalid keyType throws descriptive error: true` |
| 5 | `getIncomingViewingKey({ passphrase, walletPath })` returns `{ success: true, viewingKey: 'uivk1...', keyType: 'incoming', network: 'mainnet' }` | VERIFIED | 15/15 unit tests pass; IVK happy path test confirmed |
| 6 | `getFullViewingKey({ passphrase, walletPath })` without `confirm` returns `{ success: false, code: 'FVK_CONFIRMATION_REQUIRED' }` | VERIFIED | Unit tests confirm gate fires before any native call |
| 7 | `getFullViewingKey({ passphrase, walletPath, confirm: true })` returns `{ success: true, viewingKey: 'uview1...', keyType: 'full', network: 'mainnet' }` | VERIFIED | Unit test passes; FVK happy path confirmed |
| 8 | `npm test` passes — all viewing-keys unit tests green with no regressions | VERIFIED | 41/41 tests pass across 3 suites |
| 9 | `zcashSkills.viewingKeys` is accessible from `lib/index.js` with both functions | VERIFIED | Node probe: all 5 wiring assertions return true |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `native/src/lib.rs` | `derive_viewing_key` Neon function registered as `deriveViewingKey`, min 340 lines | VERIFIED | 376 lines; `fn derive_viewing_key` at line 296; exported at line 374 |
| `skills/viewing-keys/index.js` | `getIncomingViewingKey` and `getFullViewingKey` async skill functions with `.meta`, min 100 lines | VERIFIED | 166 lines; both functions exported with `.meta` objects |
| `test/unit/viewing-keys.test.js` | Unit tests for both skills, min 80 lines | VERIFIED | 255 lines; 15 tests across 3 describe blocks |
| `lib/index.js` | `viewingKeys` registered on `zcashSkills` and in skills array | VERIFIED | `require('../skills/viewing-keys')` at line 16; `viewingKeys` in object (line 28), skills array (line 65), and namespace (line 75) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `derive_viewing_key` | `UnifiedSpendingKey::from_seed` | decrypted entropy | WIRED | Pattern found at `lib.rs:343` — same AccountId::ZERO pattern as create_wallet |
| `derive_viewing_key` | `ufvk.encode / uivk.encode` | key_type branch | WIRED | `to_unified_full_viewing_key()` at line 353; `to_unified_incoming_viewing_key().encode()` at line 361 |
| `skills/viewing-keys/index.js` | `native.deriveViewingKey` | `require('../../lib/native-loader')` | WIRED | `native.deriveViewingKey(...)` called at lines 44 and 103; response assigned and returned |
| `lib/index.js` | `skills/viewing-keys/index.js` | `require('../skills/viewing-keys')` | WIRED | Pattern found at line 16; assigned to `viewingKeys` and placed on zcashSkills object |
| `getFullViewingKey` | `FVK_CONFIRMATION_REQUIRED` error | `confirm` parameter gate | WIRED | Gate at line 83: `if (!confirm)` returns error object with `code: 'FVK_CONFIRMATION_REQUIRED'` before any I/O or native call |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VIEW-01 | 02-01-PLAN.md, 02-02-PLAN.md | User can export Incoming Viewing Key (IVK) — privacy-safe default for auditors | SATISFIED | `getIncomingViewingKey` calls `deriveViewingKey(..., 'incoming')`; returns `uivk1...` prefix confirmed by live smoke test |
| VIEW-02 | 02-01-PLAN.md, 02-02-PLAN.md | User can export Full Viewing Key (FVK) with explicit opt-in (exposes outgoing transaction graph) | SATISFIED | `getFullViewingKey` returns `FVK_CONFIRMATION_REQUIRED` without `confirm: true`; gate verified not to call native; unit test confirms `native.deriveViewingKey` not called |
| VIEW-03 | 02-01-PLAN.md, 02-02-PLAN.md | User can export Unified Full Viewing Key (UFVK) encoded per ZIP-316 | SATISFIED | `deriveViewingKey(..., 'full')` returns `uview1...` prefix; implemented via `UnifiedFullViewingKey::encode(&Network::MainNetwork)` (ZIP-316 bech32m); confirmed by live smoke test |

No orphaned requirements: REQUIREMENTS.md maps VIEW-01, VIEW-02, VIEW-03 to Phase 2. All three are claimed by both plans and verified in the codebase.

### Anti-Patterns Found

No anti-patterns detected. Scanned `native/src/lib.rs`, `skills/viewing-keys/index.js`, `lib/index.js`, and `test/unit/viewing-keys.test.js` for TODO/FIXME/placeholder comments, empty implementations, and console.log-only handlers. All clear.

### Human Verification Required

None. All observable truths are verifiable programmatically:
- Bech32m prefix correctness: verified via live Node.js smoke test against real compiled binary
- FVK gate (no native call when confirm absent): verified by Jest mock spy assertion
- Wiring: verified via grep and live require probes

### Gaps Summary

No gaps. All phase must-haves from both PLAN frontmatter definitions are fully implemented, wired, and tested. The native binary is built and functional. The 41-test full suite passes with zero regressions.

---

## Verification Evidence Summary

**Native binary functional:** Live smoke test executed against `prebuilds/darwin-arm64/zcash-native.node` — 7/7 assertions returned `true`:
- `deriveViewingKey` present as a function
- IVK prefix `uivk1`: true
- IVK length > 50: true
- FVK prefix `uview1`: true
- FVK length > 50: true
- Wrong passphrase throws (includes "Decryption failed"): true
- Invalid keyType throws descriptive error: true

**Unit tests:** 15/15 passing in `test/unit/viewing-keys.test.js`; 41/41 passing full suite (wallet-persist, viewing-keys, and integration test suites).

**Artifact sizes exceed minimums:**
- `native/src/lib.rs`: 376 lines (plan minimum: 340)
- `skills/viewing-keys/index.js`: 166 lines (plan minimum: 100)
- `test/unit/viewing-keys.test.js`: 255 lines (plan minimum: 80)

**All five wiring points confirmed:** Rust FFI export registered, JS skill calls native, lib/index.js requires skill, skill placed on zcashSkills object and skills array, FVK confirmation gate fires before native call.

---

_Verified: 2026-03-20_
_Verifier: Claude (gsd-verifier)_
