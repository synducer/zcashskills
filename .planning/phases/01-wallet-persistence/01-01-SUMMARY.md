---
phase: 01-wallet-persistence
plan: 01
subsystem: crypto
tags: [rust, neon, bip39, argon2, chacha20poly1305, xchacha20, zcash, sapling, native-module]

# Dependency graph
requires: []
provides:
  - "createWallet(passphrase, network): returns { encryptedSeed, salt, nonce, address, mnemonic } — raw entropy never leaves Rust"
  - "loadWallet(passphrase, encryptedSeed, salt, nonce, network): returns { address, network } or throws JS error"
  - "BIP-39 24-word mnemonic generation from 256-bit OsRng entropy"
  - "Argon2id key derivation (OWASP minimum params) from passphrase + 32-byte random salt"
  - "XChaCha20-Poly1305 authenticated encryption with 24-byte random nonce"
  - "Sapling address derivation from entropy via UnifiedSpendingKey"
affects: [02-wallet-persistence, 03-chain-scanning, 04-send-transaction, 05-agent-integration]

# Tech tracking
tech-stack:
  added:
    - "bip39 2.0.0 (with zeroize feature)"
    - "argon2 0.5.3"
    - "chacha20poly1305 0.10.1"
    - "hex 0.4"
  patterns:
    - "All crypto ops in Rust before FFI boundary — raw key material never in JS heap"
    - "Neon error handling via match + cx.throw_error (no map_err + ? double-Result issue)"
    - "Sensitive arrays zeroed with .fill(0) on all return paths including error paths"
    - "Hex encoding for all binary data crossing FFI boundary"

key-files:
  created: []
  modified:
    - "native/Cargo.toml — added bip39, argon2, chacha20poly1305, hex dependencies"
    - "native/src/lib.rs — added create_wallet and load_wallet Neon functions (260 lines added)"

key-decisions:
  - "Use match + cx.throw_error pattern instead of map_err + ? for Neon error handling — Neon 0.10.x cx.throw_error returns JsResult<T> not Throw, so map_err(|e| cx.throw_error(...))?  produces a double-Result that doesn't compile"
  - "XChaCha20Poly1305 with 24-byte XNonce (not ChaCha20Poly1305 with 12-byte Nonce) per RESEARCH.md Pitfall 3"
  - "hash_password_into with &[u8] salt (not SaltString) per RESEARCH.md Pitfall 2"
  - "native/index.node is gitignored as compiled binary — only source lib.rs is committed"

patterns-established:
  - "Neon error pattern: use match arms to return cx.throw_error, never map_err + ? with cx.throw_error"
  - "Crypto security: zero all sensitive byte arrays (.fill(0)) before every return path"
  - "FFI data: encode all binary as hex strings crossing the Rust/JS boundary"

requirements-completed: [WALL-01, WALL-02, WALL-03, WALL-04]

# Metrics
duration: 3min
completed: 2026-03-20
---

# Phase 1 Plan 01: Wallet Persistence — Create/Load Implementation Summary

**Argon2id + XChaCha20-Poly1305 wallet encryption in Rust via Neon FFI with BIP-39 mnemonic and Sapling address derivation — raw entropy never crosses the JS boundary**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T17:53:39Z
- **Completed:** 2026-03-19T17:56:39Z
- **Tasks:** 2 of 2
- **Files modified:** 2

## Accomplishments

- Added bip39, argon2, chacha20poly1305, hex crates to native/Cargo.toml and verified cargo build succeeds
- Implemented create_wallet Neon function: generates 32-byte OsRng entropy, derives BIP-39 24-word mnemonic, derives Sapling address, derives Argon2id key from passphrase, encrypts entropy with XChaCha20-Poly1305, zeroes key material, returns { encryptedSeed, salt, nonce, address, mnemonic }
- Implemented load_wallet Neon function: decodes hex inputs, re-derives Argon2id key, decrypts with XChaCha20-Poly1305, re-derives Sapling address from plaintext entropy, throws JS error on wrong passphrase
- All verification checks pass: address prefix, 24-word mnemonic, hex encoding, round-trip address match, wrong-passphrase JS error without process crash

## Task Commits

Each task was committed atomically:

1. **Task 1: Add crypto crate dependencies to Cargo.toml** - `b42a23f` (chore)
2. **Task 2: Implement create_wallet and load_wallet Neon functions** - `3160e60` (feat)

## Files Created/Modified

- `native/Cargo.toml` — added bip39, argon2, chacha20poly1305, hex to [dependencies]
- `native/src/lib.rs` — added create_wallet and load_wallet Neon functions, updated #[neon::main] exports

## Decisions Made

- **Neon error pattern:** Used `match` + `cx.throw_error` instead of `map_err(|e| cx.throw_error(...))?`. In Neon 0.10.x, `cx.throw_error` returns `JsResult<T>` (i.e., `Result<T, Throw>`), not `Throw` directly. Using `map_err` with it produces `Result<_, Result<_, Throw>>`, which `?` cannot convert — causing compile errors. The correct pattern is `match result { Ok(v) => v, Err(e) => return cx.throw_error(msg) }`.
- **XChaCha20Poly1305 with XNonce (24 bytes):** Used the X variant explicitly per RESEARCH.md Pitfall 3 — avoids 12-byte nonce nonce-reuse risks.
- **hash_password_into with raw &[u8] salt:** Used salt bytes directly (not SaltString) per RESEARCH.md Pitfall 2.
- **native/index.node is gitignored:** Compiled binary not committed — source-only approach, binary rebuilt at install time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Neon error handling — map_err + ? pattern doesn't compile with cx.throw_error**
- **Found during:** Task 2 (implement create_wallet and load_wallet)
- **Issue:** The plan provided `map_err(|e| cx.throw_error(...))?` patterns throughout both functions. In Neon 0.10.x, `cx.throw_error` returns `JsResult<T>` not `Throw`, so `map_err` produces `Result<_, Result<_, Throw>>` — the `From<Result<_, Throw>>` trait is not implemented for `Throw`, causing 10 compile errors.
- **Fix:** Replaced all `map_err(|e| cx.throw_error(...)?` with explicit `match` arms: `match expr { Ok(v) => v, Err(e) => { /* zero keys */ return cx.throw_error(msg); } }`
- **Files modified:** native/src/lib.rs
- **Verification:** `cargo build --release` succeeded with zero errors; all functional checks passed
- **Committed in:** 3160e60 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in plan's code pattern)
**Impact on plan:** Required fix — the provided code pattern was incompatible with the Neon 0.10.x API. No scope creep; security properties fully preserved.

## Issues Encountered

- The plan's Rust code used `map_err(|e| cx.throw_error(...))?` which is incompatible with Neon 0.10.x's error type system. Fixed by switching to explicit `match` with `return cx.throw_error(...)` — same functional behavior, correct types.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- createWallet and loadWallet are production-ready cryptographic functions with proper error handling
- Security invariant established: raw 32-byte entropy never appears in any JS return value
- Ready for Phase 1 Plan 02 (wallet persistence to disk — reading/writing the encrypted blob JSON file)
- The address/encryptedSeed/salt/nonce schema from createWallet defines the wallet file format for the next plan

---
*Phase: 01-wallet-persistence*
*Completed: 2026-03-20*
