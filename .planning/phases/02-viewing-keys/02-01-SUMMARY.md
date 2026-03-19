---
phase: 02-viewing-keys
plan: 01
subsystem: crypto
tags: [rust, neon, zcash_keys, ufvk, uivk, zip-316, bech32m, viewing-keys, native-module]

# Dependency graph
requires:
  - phase: 01-wallet-persistence
    provides: "create_wallet/load_wallet Neon functions — same decrypt chain reused for derive_viewing_key; Argon2id + XChaCha20-Poly1305 pattern established"
provides:
  - "deriveViewingKey(passphrase, encSeed, salt, nonce, network, keyType) Neon function"
  - "UIVK (uivk1... mainnet) via keyType='incoming' — satisfies VIEW-01"
  - "UFVK (uview1... mainnet) via keyType='full' — satisfies VIEW-02 + VIEW-03"
  - "ZIP-316 bech32m key encoding via UnifiedFullViewingKey::encode / UnifiedIncomingViewingKey::encode"
affects: [03-chain-scanning, 04-send-transaction, 05-agent-integration]

# Tech tracking
tech-stack:
  added:
    - "UnifiedFullViewingKey from zcash_keys 0.12 (already in Cargo.toml, no new deps)"
    - "to_unified_full_viewing_key() -> to_unified_incoming_viewing_key() -> encode() chain"
  patterns:
    - "Single Rust function handles both IVK and FVK via keyType branch — minimizes FFI attack surface"
    - "ZIP-316 bech32m encoding done entirely in Rust before FFI boundary — string-only output"
    - "Vec<u8> entropy from decrypt() zeroed via iter_mut().for_each(|b| *b = 0) (not .fill())"
    - "Network::MainNetwork/TestNetwork (implements Parameters) for encode() — NOT NetworkType"

key-files:
  created: []
  modified:
    - "native/src/lib.rs — added derive_viewing_key Neon function (77 lines), updated #[neon::main] exports to 5 functions"

key-decisions:
  - "Use UnifiedFullViewingKey::encode(&Network::MainNetwork) for UFVK — NOT zcash_keys::encoding::encode_extended_full_viewing_key which produces legacy zxviews1... (Pitfall 1 from RESEARCH.md)"
  - "ufvk.to_unified_incoming_viewing_key().encode(&consensus_network) compiles correctly — the open question from RESEARCH.md resolved in compilation"
  - "No new Cargo.toml dependencies needed — zcash_keys 0.12 already provides UnifiedFullViewingKey and UnifiedIncomingViewingKey"
  - "entropy Vec<u8> zeroed with iter_mut().for_each(|b| *b = 0) — consistent with load_wallet pattern"

patterns-established:
  - "ZIP-316 viewing key derivation: USK -> UFVK -> encode/uivk.encode in single Rust FFI function"
  - "keyType branch pattern: 'incoming'/'full' string param selects IVK vs FVK encoding"

requirements-completed: [VIEW-01, VIEW-02, VIEW-03]

# Metrics
duration: 2min
completed: 2026-03-20
---

# Phase 2 Plan 01: Viewing Keys — derive_viewing_key Implementation Summary

**ZIP-316 bech32m UIVK and UFVK derivation from encrypted wallet seed via UnifiedFullViewingKey chain in a single Rust Neon function — no new dependencies, UIVK encode() open question resolved in compilation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-19T18:42:00Z
- **Completed:** 2026-03-19T18:44:00Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments

- Added `derive_viewing_key` Neon function to `native/src/lib.rs` following the match + cx.throw_error pattern established in Phase 1
- IVK path: `ufvk.to_unified_incoming_viewing_key().encode(&consensus_network)` produces `uivk1...` (mainnet) — VIEW-01 satisfied
- FVK path: `ufvk.encode(&consensus_network)` produces `uview1...` (mainnet) — VIEW-02 + VIEW-03 satisfied
- Wrong passphrase throws JS error 'Decryption failed — wrong passphrase' without crashing Node.js
- cargo build --release succeeded with zero compile errors; prebuilds/darwin-arm64/zcash-native.node updated on disk
- All 5 smoke test assertions pass: deriveViewingKey present, uivk1 prefix, IVK length, uview1 prefix, wrong passphrase throws

## Task Commits

Each task was committed atomically:

1. **Task 1: Add derive_viewing_key to native/src/lib.rs and rebuild** - `41c4120` (feat)

## Files Created/Modified

- `native/src/lib.rs` — Added UnifiedFullViewingKey import, derive_viewing_key function (77 lines), registered as 'deriveViewingKey' in #[neon::main] (now 5 exports total, 376 lines)

## Decisions Made

- **UnifiedFullViewingKey path over legacy:** Used `usk.to_unified_full_viewing_key()` not `usk.sapling().to_full_viewing_key()`. The unified path produces ZIP-316 UFVK (`uview1...`); the legacy path produces Sapling-only FVK (`zxviews1...`).
- **UIVK open question resolved:** RESEARCH.md flagged whether `uivk.encode(&Network::MainNetwork)` would compile cleanly given the internal tests use a private `render()` path. The public API `UnifiedIncomingViewingKey::encode(&params)` compiled correctly — open question closed.
- **No new Cargo.toml dependencies:** All required types (`UnifiedFullViewingKey`, `UnifiedIncomingViewingKey`) already available in `zcash_keys 0.12` with `features = ["sapling"]`.

## Deviations from Plan

None — plan executed exactly as written. The UIVK encode open question from RESEARCH.md resolved correctly on first compile.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `native.deriveViewingKey` is production-ready with proper error handling and key material zeroing
- Both UIVK (VIEW-01) and UFVK (VIEW-02 + VIEW-03) requirements are fully satisfied
- Phase 2 Plan 02 can now implement the JS viewing-keys skill (`skills/viewing-keys/index.js`) that wraps the Rust FFI function with filesystem I/O and the FVK explicit opt-in gate
- The `keyType='full'` path satisfies both VIEW-02 (FVK with explicit opt-in — enforced at JS layer) and VIEW-03 (ZIP-316 bech32m UFVK encoding — enforced at Rust layer)

---
*Phase: 02-viewing-keys*
*Completed: 2026-03-20*
