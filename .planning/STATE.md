# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Users can generate, persist, and control a real ZCash shielded wallet through an AI agent — receiving, sending, and verifying private payments without ever exposing keys to external services.
**Current focus:** Phase 1 — Wallet Persistence

## Current Position

Phase: 1 of 5 (Wallet Persistence)
Plan: 2 of 2 in current phase (phase complete)
Status: In progress
Last activity: 2026-03-20 — Plan 01-02 complete (wallet-persist JS skill, unit tests, lib/index.js wiring)

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 3.5 min
- Total execution time: 0.12 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-wallet-persistence | 2 | 7 min | 3.5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (3 min), 01-02 (4 min)
- Trend: stable

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3]: zcash_client_backend + zcash_client_sqlite WalletRead/WalletWrite trait boundary needs verification before planning — research flag from SUMMARY.md
- [Phase 4]: Sapling Builder API interaction with zcash_client_backend scanning — whether proposal/fulfill pattern or direct Builder applies is unresolved — research flag from SUMMARY.md
- [Phase 5]: Post-ClawHavoc ClawHub SHA-256 signature requirements need verification against current ClawHub CLI docs before planning

## Session Continuity

Last session: 2026-03-20
Stopped at: Completed 01-02-PLAN.md — wallet-persist JS skill, unit tests, lib/index.js wiring complete
Resume file: None
