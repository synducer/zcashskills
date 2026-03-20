# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Users can generate, persist, and control a real ZCash shielded wallet through an AI agent — receiving, sending, and verifying private payments without ever exposing keys to external services.
**Current focus:** Phase 3 — Balance and Sync

## Current Position

Phase: 3 of 5 (Balance and Sync)
Plan: 4 of 4 in current phase complete (03-04-PLAN.md complete — getTransactionHistory + getTransaction + decryptMemo)
Status: Phase 3 COMPLETE — Plan 01 (Rust scan_blocks), Plan 02 (gRPC client), Plan 03 (balance-check skill), Plan 04 (transaction history + memo structure) all done
Last activity: 2026-03-20 — Plan 03-04 complete (getTransactionHistory: SYNC-03 structure in place, 59 tests passing)

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 4 min
- Total execution time: 0.35 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-wallet-persistence | 2 | 7 min | 3.5 min |
| 02-viewing-keys | 2 | 5 min | 2.5 min |
| 03-balance-and-sync | 4 | 24 min | ~6 min |

**Recent Trend:**
- Last 5 plans: 02-02 (3 min), 03-01 (14 min), 03-02 (2 min), 03-03 (5 min), 03-04 (3 min)
- Trend: Phase 3 complete — all 4 plans done; Phase 4 (send) next

*Updated after each plan completion*

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Project]: Argon2id + XChaCha20-Poly1305 for seed encryption — all crypto in Rust, never in JS
- [Project]: Sapling-only for v1 — no Orchard; wider anonymity set and simpler implementation
- [Project]: lightwalletd light client only — no full node requirement
- [Project]: Single account (AccountId::ZERO) for v1 — simplicity over multi-account flexibility
- [01-01]: Neon error pattern: match + cx.throw_error (not map_err + ?) — Neon 0.10.x cx.throw_error returns JsResult<T>, not Throw
- [01-01]: XChaCha20Poly1305 with XNonce (24 bytes) per RESEARCH.md Pitfall 3
- [01-01]: hash_password_into with raw &[u8] salt (not SaltString) per RESEARCH.md Pitfall 2
- [01-02]: JS skill owns filesystem I/O only — all crypto delegated to Rust via native.createWallet/loadWallet
- [01-02]: SAPLING_ACTIVATION defaults are conservative 2026 estimates; Phase 3 replaces with live lightwalletd chain-tip
- [01-02]: mnemonic returned only from createWallet, never loadWallet — enforced structurally
- [Phase 02-01]: UnifiedFullViewingKey::encode(&Network) for ZIP-316 UFVK — NOT legacy zcash_keys::encoding::encode_extended_full_viewing_key which produces zxviews1... (non-ZIP-316)
- [Phase 02-01]: No new Cargo.toml deps needed — zcash_keys 0.12 with sapling feature already provides UnifiedFullViewingKey and UnifiedIncomingViewingKey
- [Phase 02-01]: UIVK open question resolved: uivk.encode(&Network::MainNetwork) compiles correctly with public API — private render() path only in tests
- [Phase 02-02]: FVK gate checked before any I/O — confirm: true checked as first statement in getFullViewingKey, no native call or file read occurs without explicit opt-in
- [Phase 02-02]: Test strategy — real temp wallet file + native mock — avoids fs mock complexity, matches wallet-persist.test.js pattern
- [Phase 03-02]: protobufjs re-encoding: grpc-js deserializes CompactBlock to JS objects; re-encode via protobufjs encode().finish() so Rust prost receives raw bytes
- [Phase 03-02]: keepCase:true in proto-loader preserves snake_case field names matching Rust prost wire format
- [Phase 03-01]: ScannedBlock.transactions() is correct method name (not wallet_txs()); confirmed from zcash_client_backend-0.21.2 source
- [Phase 03-01]: Note value chain: output.note().value().inner() — sapling::NoteValue.inner() gives u64; NOT u64::from(Zatoshis) which is different type
- [Phase 03-01]: TypedArray trait must be imported explicitly (use neon::types::buffer::TypedArray) for JsBuffer.as_slice() in napi-6 mode
- [Phase 03-01]: prost added directly to Cargo.toml for Message trait scope; same version (0.14) as zcash_client_backend transitive dep — no conflict
- [Phase 03-01]: npm run build: cargo build --release --manifest-path native/Cargo.toml && cp native/index.node prebuilds/darwin-arm64/zcash-native.node
- [Phase 03-03]: keyType='full' enforced in checkBalance — ScanningKeys::from_account_ufvks requires UFVK, not UIVK; 'full' passed explicitly to deriveViewingKey
- [Phase 03-03]: v1 invariant: spendableZatoshis === confirmedZatoshis — Phase 3 receive-only wallet; Phase 4 adds nullifier tracking
- [Phase 03-03]: birthdayHeight fallback to tipHeight - 100 when wallet has missing or 0 birthdayHeight (Phase 1 placeholder)
- [Phase 03-04]: decrypt_memo placeholder for v1: returns empty string (JS maps to memo: null); full Sapling trial decryption deferred to post-hackathon; interface contract met
- [Phase 03-04]: memo failure is non-fatal in getTransactionHistory: per-transaction RPC/decryption errors caught; transaction included with memo: null

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3]: zcash_client_backend + zcash_client_sqlite WalletRead/WalletWrite trait boundary needs verification before planning — research flag from SUMMARY.md
- [Phase 4]: Sapling Builder API interaction with zcash_client_backend scanning — whether proposal/fulfill pattern or direct Builder applies is unresolved — research flag from SUMMARY.md
- [Phase 5]: Post-ClawHavoc ClawHub SHA-256 signature requirements need verification against current ClawHub CLI docs before planning

## Session Continuity

Last session: 2026-03-20
Stopped at: Completed 03-04-PLAN.md — getTransactionHistory with memo structure, SYNC-03 satisfied, 59 tests passing. Phase 3 complete.
Resume file: None
