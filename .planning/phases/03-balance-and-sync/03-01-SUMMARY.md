---
phase: 03-balance-and-sync
plan: 01
subsystem: native-crypto
tags: [rust, neon, zcash, sapling, scan_block, protobuf, prost, serde_json]

# Dependency graph
requires:
  - phase: 02-viewing-keys
    provides: UnifiedFullViewingKey (UFVK) ZIP-316 encode/decode, derive_viewing_key Neon function
  - phase: 01-wallet-persistence
    provides: create_wallet/load_wallet Neon functions, encrypted seed pattern

provides:
  - scanBlocks Neon function accepting (ufvkStr, networkStr, JsArray<JsBuffer>) returning { confirmedZatoshis, transactionsJson }
  - zcash_client_backend 0.21 dependency with scan_block API
  - prost 0.14 for CompactBlock protobuf decoding
  - Verified API: ScannedBlock.transactions() -> [WalletTx] -> sapling_outputs() -> note().value().inner()
  - Updated npm run build script: cargo build + cp index.node to prebuilds/

affects:
  - 03-02-balance-check-skill (uses scanBlocks from JS, needs UFVK + Buffer array pattern)
  - 04-send-zcash (note nullifier tracking will extend scan_blocks for spend detection)

# Tech tracking
tech-stack:
  added:
    - zcash_client_backend 0.21 (scan_block, ScanningKeys, Nullifiers, CompactBlock proto types)
    - serde_json 1 (serializing transaction list across FFI boundary)
    - prost 0.14 (Message trait for CompactBlock::decode from raw bytes)
  patterns:
    - Buffer array pattern: JS passes Vec<JsBuffer> (one per CompactBlock, protobuf-encoded) to Rust
    - TypedArray import required for JsBuffer.as_slice() in Neon napi-6 mode (not legacy-runtime)
    - NoteValue.inner() -> u64 (not u64::from(note.value()) — Zatoshis ≠ sapling::NoteValue)
    - saturating_add for zatoshi accumulation to prevent u64 overflow on large balances

key-files:
  created: []
  modified:
    - native/Cargo.toml (added zcash_client_backend, serde_json, prost)
    - native/src/lib.rs (added scan_blocks function and scanBlocks export)
    - native/Cargo.lock (updated with new dependency tree)
    - package.json (fixed npm run build script for @neon-rs/cli compatibility)

key-decisions:
  - "API discovery: ScannedBlock.transactions() is correct (not wallet_txs()) — confirmed from zcash_client_backend-0.21.2/src/data_api.rs line 2290"
  - "API discovery: note value extraction chain is output.note().value().inner() — sapling::NoteValue.inner() returns u64, NOT u64::from(Zatoshis)"
  - "TypedArray trait must be imported explicitly: use neon::types::buffer::TypedArray — not available via neon::prelude in napi-6 mode"
  - "prost added directly to Cargo.toml: prost::Message trait must be in scope for CompactBlock::decode(); transitive access not automatic in Rust 2021"
  - "npm run build fixed: cargo build --release + cp native/index.node to prebuilds/ — @neon-rs/cli neon dist requires neon project config not present"
  - "is_change() deferred: receive-only wallet in Phase 3 counts all sapling outputs; Phase 4 adds nullifier tracking for spend detection"

patterns-established:
  - "JsBuffer bytes access: use neon::types::buffer::TypedArray trait, call buf.as_slice(&cx).to_vec()"
  - "prost::Message trait for protobuf decode: add prost directly to Cargo.toml even if transitive dep"
  - "Sapling note value: output.note().value().inner() — NoteValue (sapling) .inner() gives u64 directly"
  - "scan_block nullifiers: Nullifiers::empty() is correct for receive-only Phase 3 wallet"

requirements-completed: [SYNC-01, SYNC-02]

# Metrics
duration: 14min
completed: 2026-03-20
---

# Phase 03 Plan 01: scan_blocks Neon Function Summary

**Synchronous Rust scan_blocks function decodes CompactBlock protobufs and trial-decrypts Sapling notes via zcash_client_backend 0.21 scan_block API, returning confirmed zatoshi totals as strings**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-20T04:28:50Z
- **Completed:** 2026-03-20T04:43:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added zcash_client_backend 0.21 + serde_json 1 + prost 0.14 to native/Cargo.toml; cargo build succeeds
- Implemented scan_blocks Neon function: accepts (ufvkStr, networkStr, JsArray<JsBuffer>), decodes each CompactBlock protobuf, runs scan_block with ScanningKeys from UFVK, accumulates note values
- Verified exact ScannedBlock API from cargo registry source: transactions() -> sapling_outputs() -> note().value().inner()
- Fixed npm run build to use cargo build + cp index.node pattern (replacing broken neon build --release)
- All 41 existing tests continue to pass; typeof native.scanBlocks === 'function' confirmed

## Task Commits

Each task was committed atomically:

1. **Task 1: Add zcash_client_backend and serde_json to native/Cargo.toml** - `b4953f1` (chore)
2. **Task 2: Implement scan_blocks Neon function in native/src/lib.rs** - `72cb0bf` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `native/Cargo.toml` - Added zcash_client_backend 0.21, serde_json 1, prost 0.14
- `native/src/lib.rs` - Added scan_blocks function + TypedArray import + prost::Message import + scanBlocks export
- `native/Cargo.lock` - Updated with new dependency tree (zcash_client_backend transitive deps)
- `package.json` - Fixed npm run build: cargo build --manifest-path native/Cargo.toml && cp native/index.node prebuilds/darwin-arm64/zcash-native.node

## Decisions Made

- ScannedBlock.transactions() is the correct method name (confirmed from source at data_api.rs line 2290)
- Note value extraction: output.note().value().inner() — sapling::NoteValue.inner() returns u64 directly (not u64::from(Zatoshis) which is a different type)
- TypedArray trait needed explicitly (use neon::types::buffer::TypedArray) for buf.as_slice() in napi-6 mode
- prost added directly to Cargo.toml to bring Message trait into scope (transitive deps not automatically accessible via use in Rust 2021)
- npm run build fixed to use cargo build + cp pattern since @neon-rs/cli neon dist requires project-specific neon config

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JsBuffer bytes access pattern incorrect for Neon napi-6**
- **Found during:** Task 2 (scan_blocks implementation)
- **Issue:** Plan code used `cx.borrow(&buf, |data| ...)` which is `#[cfg(feature = "legacy-runtime")]` only — not available in napi-6 mode
- **Fix:** Used `buf.as_slice(&cx).to_vec()` with explicit `use neon::types::buffer::TypedArray` import
- **Files modified:** native/src/lib.rs
- **Verification:** cargo build succeeds; scanBlocks callable from JS
- **Committed in:** 72cb0bf (Task 2 commit)

**2. [Rule 1 - Bug] Incorrect note value conversion chain**
- **Found during:** Task 2 (scan_blocks API verification)
- **Issue:** Plan used `u64::from(output.note().value())` — but output.note() returns &sapling::Note, .value() returns sapling::NoteValue (not Zatoshis), and u64::from(NoteValue) doesn't exist
- **Fix:** Used `output.note().value().inner()` — NoteValue.inner() returns u64 directly
- **Files modified:** native/src/lib.rs
- **Verification:** Confirmed from sapling-crypto-0.5.0/src/value.rs line 63
- **Committed in:** 72cb0bf (Task 2 commit)

**3. [Rule 1 - Bug] prost must be a direct dependency for Message trait**
- **Found during:** Task 2 (CompactBlock::decode compilation)
- **Issue:** Plan said "Do NOT add prost directly" but prost::Message trait must be in scope via use statement; transitive dep path not accessible as use in Rust 2021 edition
- **Fix:** Added prost = "0.14" to Cargo.toml (same version as zcash_client_backend uses, no conflict)
- **Files modified:** native/Cargo.toml
- **Verification:** cargo build succeeds; CompactBlock::decode works
- **Committed in:** 72cb0bf (Task 2 commit)

**4. [Rule 1 - Bug] npm run build script broken with @neon-rs/cli**
- **Found during:** Task 2 (npm run build verification)
- **Issue:** `neon build --release` is not a valid command for @neon-rs/cli (different CLI from legacy neon); `neon dist` requires neon project config not present
- **Fix:** Replaced with `cargo build --release --manifest-path native/Cargo.toml && cp native/index.node prebuilds/darwin-arm64/zcash-native.node`
- **Files modified:** package.json
- **Verification:** npm run build exits 0; native.scanBlocks loads from prebuilds binary
- **Committed in:** 72cb0bf (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 1 - Bugs)
**Impact on plan:** All fixes required for compilation and correct operation. No scope creep. API discoveries during implementation match plan's intent precisely.

## Issues Encountered

- zcash_client_backend API verification was essential: plan noted ScannedBlock method names were "MEDIUM confidence" and should be checked via cargo doc. Direct source inspection of cargo registry (faster than cargo doc) confirmed transactions() and the full method chain.
- The prebuilds/ directory is gitignored — binary is a build artifact, not tracked. Native module loads from prebuilds/ (if exists from prior build) or falls back to native/index.node.

## Next Phase Readiness

- scanBlocks Neon function is ready for Plan 02 (balance-check skill in JS)
- Plan 02 needs: lightwalletd gRPC client (already implemented in a39819e), fetch CompactBlocks as Buffer array, call native.scanBlocks(ufvk, network, buffers)
- UFVK must be derived with keyType='full' (not 'incoming') before passing to scanBlocks

## Self-Check: PASSED

- native/src/lib.rs: FOUND
- native/Cargo.toml: FOUND
- 03-01-SUMMARY.md: FOUND
- Commit b4953f1 (Task 1): FOUND
- Commit 72cb0bf (Task 2): FOUND

---
*Phase: 03-balance-and-sync*
*Completed: 2026-03-20*
