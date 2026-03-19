---
phase: 01-wallet-persistence
plan: 02
subsystem: wallet-js
tags: [javascript, skill, wallet-persist, argon2, xchacha20, bip39, filesystem, jest]

# Dependency graph
requires:
  - "01-01: createWallet(passphrase, network) and loadWallet(passphrase, encryptedSeed, salt, nonce, network) Neon FFI functions"
provides:
  - "skills/wallet-persist/index.js: createWallet and loadWallet async JS functions with .meta"
  - "SAPLING_ACTIVATION birthday heights in lib/constants.js (mainnet: 2750000, testnet: 280000)"
  - "zcashSkills.walletPersist.createWallet({ passphrase, network }) registered public API"
  - "zcashSkills.walletPersist.loadWallet({ passphrase, walletPath }) registered public API"
  - "wallet.json disk format: version, network, address, encryptedSeed, salt, nonce, kdf, cipher, birthdayHeight, createdAt"
affects: [03-chain-scanning, 04-send-transaction, 05-agent-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill owns filesystem I/O only — all crypto delegated to Rust via native.createWallet / native.loadWallet"
    - "0600 file permissions set immediately after writeFileSync via chmodSync"
    - "birthdayHeight default from SAPLING_ACTIVATION constants — never zero (WALL-03)"
    - "Jest jest.mock('../../lib/native-loader') pattern for unit tests that avoid native binary"
    - "{ success: false, error, code } return on all failure paths — skill never throws"

key-files:
  created:
    - "skills/wallet-persist/index.js — createWallet and loadWallet skill functions with .meta (146 lines)"
    - "test/unit/wallet-persist.test.js — 14 unit tests covering create, load, validation, metadata"
  modified:
    - "lib/constants.js — added SAPLING_ACTIVATION export (mainnet: 2750000, testnet: 280000)"
    - "lib/index.js — added walletPersist require, property on zcashSkills, skills array entry, skills.walletPersist"

key-decisions:
  - "JS layer owns file I/O and wallet JSON format; Rust owns all crypto — clean separation maintained"
  - "SAPLING_ACTIVATION defaults are conservative 2026 block height estimates; Phase 3 will query live chain tip via lightwalletd"
  - "mnemonic returned only from createWallet, never from loadWallet — enforced structurally by API design"
  - "Prebuilt binary (prebuilds/darwin-arm64/zcash-native.node) updated on disk to match Neon-built binary with all 4 functions — not committed (gitignored), rebuilt at install time"

requirements-completed: [WALL-01, WALL-02, WALL-03, WALL-04]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 1 Plan 02: Wallet Persistence JS Skill Summary

**JS wallet-persist skill wrapping Rust createWallet/loadWallet with filesystem I/O, 0600 permissions, birthdayHeight constants, and 14 unit tests — fully registered as zcashSkills.walletPersist**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-19T18:00:35Z
- **Completed:** 2026-03-19T18:04:35Z
- **Tasks:** 2 of 2
- **Files modified:** 4

## Accomplishments

- Created `skills/wallet-persist/index.js` with async `createWallet` and `loadWallet` functions following the established skill pattern
- `createWallet` validates passphrase/network, calls `native.createWallet`, builds wallet JSON with kdf/cipher metadata, writes with `fs.writeFileSync` + `fs.chmodSync(0o600)`, returns `{ success, address, mnemonic, walletPath, network, birthdayHeight }`
- `loadWallet` reads and validates wallet JSON from disk, calls `native.loadWallet` with hex-encoded blobs, returns `{ success, address, network, birthdayHeight, createdAt }` — never exposes mnemonic
- Added `SAPLING_ACTIVATION` export to `lib/constants.js` with mainnet: 2750000 and testnet: 280000 birthday heights
- Registered `walletPersist` in `lib/index.js` — accessible as `zcashSkills.walletPersist.createWallet()` and `zcashSkills.walletPersist.loadWallet()`
- Created 14 Jest unit tests with full native module mock — covers happy paths, validation errors, wrong passphrase, missing wallet file, birthdayHeight presence, .meta properties
- Integration smoke test: createWallet writes wallet.json, loadWallet re-derives same address, wrong passphrase returns `{ success: false, code: 'LOAD_WALLET_ERROR' }`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create wallet-persist skill and update constants** - `43928b3` (feat)
2. **Task 2: Wire skill into lib/index.js and write unit tests** - `9f8c0c7` (feat)

## Files Created/Modified

- `skills/wallet-persist/index.js` — 146 lines, createWallet + loadWallet with .meta (created)
- `lib/constants.js` — added SAPLING_ACTIVATION export (modified)
- `lib/index.js` — added walletPersist require, registration, skills array, skills.walletPersist (modified)
- `test/unit/wallet-persist.test.js` — 14 unit tests with jest.mock of native-loader (created)

## Decisions Made

- **JS owns I/O, Rust owns crypto:** The skill never performs any cryptographic operation — it only calls `native.createWallet` and `native.loadWallet`. All key derivation, encryption, and decryption happen in Rust. The security invariant from Plan 01 is preserved.
- **birthdayHeight defaults:** Used conservative 2026 block height estimates (mainnet: 2750000, testnet: 280000) as fallback. Custom `birthdayHeight` param accepted. Phase 3 will replace with live lightwalletd chain-tip query.
- **mnemonic returned once:** Structurally enforced — only `createWallet` returns `mnemonic`; `loadWallet` has no code path that touches the mnemonic.
- **Prebuilt binary updated on disk:** The stale prebuilt (from initial scaffold) only had 2 functions. Updated to the Neon-built binary (4 functions) so smoke test passes. Binary is gitignored per project convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prebuilt binary missing createWallet/loadWallet from Plan 01**
- **Found during:** Integration smoke test (verification phase)
- **Issue:** The prebuilt binary at `prebuilds/darwin-arm64/zcash-native.node` was the original scaffold binary with only `generateShieldedAddress` and `validateAddress`. The native-loader finds the prebuilt first (it exists), loads it, and native-loader's validation only checks for the original two functions. Result: `native.createWallet` was undefined, skill returned `{ success: false, error: 'native.createWallet not found' }`.
- **Fix:** Copied `native/index.node` (Neon-built in Plan 01, has all 4 functions) over the prebuilt path. The prebuilt binary is gitignored so no commit was needed — it's rebuilt at install time.
- **Files modified:** `prebuilds/darwin-arm64/zcash-native.node` (on disk, not committed)
- **Verification:** Integration smoke test passes — all 7 checks log `true`

---

**Total deviations:** 1 auto-fixed (Rule 1 — stale prebuilt binary missing new Neon functions)
**Impact on plan:** Required fix for smoke test. No scope creep; security properties preserved.

## Issues Encountered

- Prebuilt binary was stale (from initial scaffolding) — lacked the `createWallet` and `loadWallet` functions added in Plan 01. Fixed by updating the on-disk prebuilt. This will need to be repeated when distributing release binaries.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `zcashSkills.walletPersist.createWallet()` and `zcashSkills.walletPersist.loadWallet()` are production-ready
- Wallet JSON format established with all required fields: `encryptedSeed`, `salt`, `nonce`, `network`, `birthdayHeight`, `createdAt`, `kdf`, `cipher`
- SAPLING_ACTIVATION constants available for Phase 3 chain scanning
- Security invariant maintained: raw entropy never in JS; mnemonic shown only at creation time

---
*Phase: 01-wallet-persistence*
*Completed: 2026-03-20*
