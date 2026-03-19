# Project Research Summary

**Project:** ZCash Skills — AI agent skill package (npm + OpenClaw)
**Domain:** ZCash light wallet SDK for AI agents (Node.js/Rust hybrid npm package)
**Researched:** 2026-03-20
**Confidence:** MEDIUM

## Executive Summary

ZCash Skills is a Node.js/Rust hybrid npm package that exposes ZCash wallet capabilities as composable AI agent skills. The existing package already ships four working skills (address generation, validation, payment URI creation/parsing) built on a Neon 0.10 FFI layer backed by librustzcash. The next milestone adds the features that transform this from a utility kit into a functional wallet: encrypted seed persistence, lightwalletd-based balance checking, shielded send (z-to-z), viewing key derivation, and OpenClaw ClawHub packaging. Every piece of research converges on a clear implementation order: persistence first, then viewing keys, then balance, then send — because each layer depends strictly on the one before it.

The recommended approach keeps all cryptographic operations in Rust (librustzcash crates: `zcash_client_backend`, `zcash_primitives`, `zcash_proofs`, `zcash_client_sqlite`) and limits the JavaScript layer to thin async skill wrappers, gRPC orchestration via `@grpc/grpc-js`, and encrypted file I/O. No npm-level ZCash libraries exist that are maintained — the Rust path is the only sound option. Seed encryption uses Argon2id + XChaCha20-Poly1305 (pure Rust, no C deps, GPU-resistant KDF). Balance checking requires compact block scanning via `zcash_client_backend` because lightwalletd does not index shielded balances directly. Shielded send is the highest-complexity feature, requiring zk-SNARK proof generation and ~50MB of Sapling proving parameters fetched at first use.

The primary risks are cryptographic and operational: storing any key material unencrypted — even briefly during development — is catastrophic and unrecoverable. Missing the wallet birthday height forces full chain rescans that take hours. Neon panics in Rust kill the entire Node.js process rather than throwing a catchable JS exception. The ZIP-317 fee formula is counterintuitive and commonly implemented wrong. All of these pitfalls must be addressed at the phase where they first appear, not retrofitted later. The project has a clear first-mover position: zero ZCash/privacy-coin skills exist on ClawHub's 13,729-skill registry, and no maintained npm ZCash package supports Sapling shielded operations.

---

## Key Findings

### Recommended Stack

The existing Neon 0.10 + librustzcash foundation is solid and should not be changed for this milestone. New capabilities come from adding four librustzcash workspace crates (`zcash_client_backend 0.21`, `zcash_primitives 0.26`, `zcash_proofs 0.26`, `zcash_client_sqlite 0.19`) plus two RustCrypto crates (`chacha20poly1305 0.10.1`, `argon2 0.5.3`) and a Tokio runtime (`tokio 1.x`) to bridge Neon's synchronous FFI context with the async gRPC client inside `zcash_client_backend`. All these crates must be version-locked together — the librustzcash workspace versions move in sync and cannot be mixed. No new npm dependencies are needed; all crypto and network I/O stays Rust-side. The JS layer gets a new `lib/lightwalletd.js` gRPC client factory (using `@grpc/grpc-js`) and a `lib/wallet-store.js` persistence helper.

**Core technologies:**
- `zcash_client_backend 0.21`: lightwalletd gRPC client, compact block scanning, viewing key types — the only official Rust API for lightwalletd
- `zcash_primitives 0.26`: Sapling transaction builder — correct entry point; do not go lower into `sapling-crypto` directly
- `zcash_proofs 0.26`: Groth16 proving keys for Sapling zk-SNARKs — required for shielded send; fetches ~50MB params at first use
- `zcash_client_sqlite 0.19`: SQLite-backed wallet state (notes, nullifiers, tree state) — avoids reimplementing WalletRead/WalletWrite traits from scratch
- `chacha20poly1305 0.10.1`: XChaCha20-Poly1305 seed encryption — pure Rust, no C deps, safe on all platforms including ARM
- `argon2 0.5.3`: Argon2id KDF for passphrase-to-key derivation — memory-hard, GPU-resistant; superior to PBKDF2 for offline-attack resistance
- `tokio 1.x` + `tokio::runtime::Runtime::block_on()`: async bridge pattern for calling async gRPC code from Neon 0.10's synchronous FFI context
- `@grpc/grpc-js`: lightwalletd gRPC transport in Node.js — connection pooled via `lib/lightwalletd.js` factory, never instantiated per-call

**Critical version constraints:** `zcash_client_backend 0.21` must pair with `zcash_primitives 0.26`, `zcash_keys 0.12`, `zcash_address 0.10`, and `zcash_client_sqlite 0.19` — all from the same librustzcash workspace. `zcash_proofs 0.26` must exactly match `zcash_primitives 0.26`. Do not mix neon 0.10 and neon 1.x in the same crate.

### Expected Features

Four skills already ship. This milestone adds five capabilities in a dependency-ordered sequence.

**Must have (table stakes for v1.1):**
- Encrypted seed persistence — blocks all other new features; use Argon2id + XChaCha20-Poly1305; never write plaintext seed; store wallet birthday height alongside ciphertext
- Balance checking via lightwalletd — requires compact block scanning with UFVK (not `GetTaddressBalance`, which is transparent-only); return confirmed and unconfirmed separately per ZCash UX checklist
- Viewing key generation — UFVK (full, for self-audit) and UIVK (incoming-only, for selective disclosure); default path must return IVK, not FVK
- OpenClaw ClawHub packaging — first ZCash skill on ClawHub; can ship wrapping existing four skills before send ships; MIT-0 license required

**Should have (competitive, v1.2):**
- Shielded send (z-to-z) — highest complexity; note selection, Merkle witness, Sapling spend proof, ZIP-317 fee, broadcast; build after persistence and balance are stable
- Memo field on shielded send — 512-byte encrypted memo per Sapling note; add as a parameter during send implementation
- Transaction pending/expiry tracking — poll `GetTransaction` for outgoing txids; add after send ships

**Defer (v2+):**
- Orchard pool support — Sapling has larger anonymity set now; Orchard multiplies implementation surface 2x
- Multi-account HD wallet — no clear agent use case for v1; ZIP-32 derivation stays compatible for future addition
- Hardware wallet PCZT support — relevant for enterprise; wait for demonstrated need
- LangChain tool adapter — same skills, different wrapper; validate OpenClaw packaging first

**Anti-features (explicitly excluded):** transparent address (t-addr) support, user-configurable fees, plaintext seed/key export, web UI, full node operation.

### Architecture Approach

The architecture is a strict three-layer system: a thin JavaScript Skills Layer wraps an async facade around a synchronous Neon FFI boundary into the Native Module Layer (Rust), which holds all cryptographic operations. Neither the skills layer nor the lightwalletd client ever touch raw key material. The wallet store is a local encrypted JSON file; the only external network dependency is a user-configurable lightwalletd endpoint. Block scanning and note decryption happen in Rust via `native.scanCompactBlocks(ivkBytes, blocksBytes)` — never in JavaScript. The gRPC client is instantiated once per URL in a `lib/lightwalletd.js` factory and reused across calls.

**Major components:**
1. Skills (`skills/<name>/index.js`) — thin async wrappers; input validation; `{ success, ...data }` contract; `.meta` export; never throw
2. Native Module (`native/src/lib.rs` via Neon FFI) — seed generation, key derivation, block scanning/note decryption, transaction construction and signing; all crypto stays here
3. Wallet Store (`lib/wallet-store.js`) — Argon2id KDF + XChaCha20-Poly1305 encrypt/decrypt; `wallet.json` with `{ encryptedSeed, salt, nonce, birthday_height, network, createdAt }`
4. lightwalletd Client (`lib/lightwalletd.js`) — gRPC channel factory; connection pooling by URL; deadline on every call; `GetLatestBlock`, `GetBlockRange`, `GetTreeState`, `SendTransaction`
5. Proto stubs (`proto/`) — committed generated stubs; regenerate only on lightwalletd protocol bumps

### Critical Pitfalls

1. **Storing seed unencrypted, even briefly** — derive seed in Rust and encrypt before returning any bytes to JS; never log seed hex; return only encrypted blob to JS; zero-fill byte arrays in Rust before drop. Address in wallet persistence phase, not retrofitted.

2. **Missing wallet birthday height** — query lightwalletd for chain tip height at wallet creation and store as `birthday_height` in wallet.json; always resume scanning from `last_scanned_height`, not `birthday_height`, on subsequent calls. Missing this causes hours-long full rescans.

3. **Neon panic kills the Node.js process** — use `cx.throw_error()` for all error conditions; never `unwrap()` or `expect()` on external input; wrap Neon function bodies in `std::panic::catch_unwind`. Test with empty string, null bytes, 1MB string on every Neon function.

4. **Wrong ZIP-317 fee formula** — use `zcash_primitives::transaction::fees::zip317::FeeRule`; the formula is `5,000 × max(nSpends, nOutputs)`, not additive; never hardcode a fee constant. A simple z-to-z with change costs 10,000 zatoshis minimum.

5. **FVK exposed when IVK is sufficient** — UFVK reveals all outgoing transactions to anyone who holds it; IVK reveals only incoming; default API must return IVK; FVK must require explicit opt-in. This is a privacy leak that cannot be undone once the key is shared.

6. **Note witness stale after chain reorg** — use `zcash_client_backend`'s `handle_chain_error` for reorg detection; always fetch a fresh anchor from lightwalletd rather than using a cached height; require minimum 10 confirmations before marking notes spendable.

---

## Implications for Roadmap

The phase order is dictated by hard feature dependencies, not preference. Each phase both delivers usable capability and unblocks the next phase.

### Phase 1: Wallet Persistence and Native Module Hardening

**Rationale:** All subsequent features require a persistent, encrypted seed. This phase also addresses the Neon panic risk (Pitfall 6) that affects all future Rust additions — fix the loader and error handling before adding more native functions.
**Delivers:** Encrypted wallet creation, load, and passphrase-change. Lazy native module loading. Safe Neon error boundary on all existing and new functions.
**Addresses:** Encrypted seed persistence (P1 feature); native loader structural fix (Pitfall 10)
**Avoids:** Seed stored unencrypted (Pitfall 1), weak KDF (Pitfall 2), USK serialization (Pitfall 4), Neon panics (Pitfall 6), native loader crashes all skills (Pitfall 10)
**Key decisions:** Argon2id + XChaCha20-Poly1305 in Rust (not Node.js `crypto`); store `birthday_height` from day one; never serialize `UnifiedSpendingKey`; wallet.json permissions `0600`
**Research flag:** Standard patterns — this is well-documented in STACK.md and PITFALLS.md. Skip `/gsd:research-phase`.

### Phase 2: Viewing Key Derivation

**Rationale:** Low complexity, high value. UFVK is needed by the balance scanning phase (Phase 3) — the IVK for note decryption is derived from it. Publishing viewing key capability also delivers standalone value for compliance/audit use cases.
**Delivers:** `viewing-keys` skill exposing UFVK and UIVK as bech32m strings; documented ZIP-316 key type semantics.
**Addresses:** Viewing key generation (P1 feature), incoming viewing key selective disclosure (differentiator)
**Avoids:** FVK vs IVK confusion (Pitfall 5) — API design must default to IVK; FVK requires explicit argument
**Uses:** `zcash_keys 0.12` (already a dependency); `to_unified_full_viewing_key()` → `sapling().to_incoming_viewing_key()`; bech32m encoding per ZIP-316
**Research flag:** Verify exact method names against `zcash_keys 0.12` docs at implementation time — MEDIUM confidence flag in ARCHITECTURE.md.

### Phase 3: Balance Checking via lightwalletd

**Rationale:** Depends on Phase 2 (needs IVK for note decryption) and Phase 1 (needs wallet birthday height to scan from). The lightwalletd gRPC client infrastructure built here is also reused by Phase 4 (send).
**Delivers:** `balance-check` skill returning confirmed and unconfirmed balances separately; `lib/lightwalletd.js` connection factory; compact block scanning pipeline in Rust.
**Addresses:** Balance checking (P1 feature), confirmed vs unconfirmed display (ZCash UX checklist requirement)
**Avoids:** Scanning in JS (Anti-Pattern 3 — use Rust FFI for note decryption), no timeout on gRPC streams (Pitfall 7), scanning from birthday every call instead of `last_scanned_height` (performance trap), one gRPC client per call (Anti-Pattern 4)
**Uses:** `zcash_client_backend 0.21` with `lightwalletd-tonic` + `sync` features; `zcash_client_sqlite 0.19` for wallet state; `tokio 1.x` `block_on()` bridge; `@grpc/grpc-js` with deadline on every call
**Research flag:** The scanning pipeline with `zcash_client_backend` + `zcash_client_sqlite` has complexity around WalletRead/WalletWrite trait implementation. Consider `/gsd:research-phase` if the trait boundary is unclear during planning.

### Phase 4: Shielded Send (z-to-z)

**Rationale:** Highest complexity; depends on all prior phases. Note selection requires scanned notes from Phase 3. Merkle witness requires tree state from lightwalletd (also Phase 3 infrastructure). Sapling proof generation adds ~50MB proving params and 1-3 second CPU cost per transaction.
**Delivers:** `send-payment` skill; z-to-z shielded transaction with encrypted memo; ZIP-317 fee; txid returned; proving params downloaded once to `~/.zcash-params/`
**Addresses:** Shielded send (P2 feature), memo field (P2), transaction pending/expiry (P2)
**Avoids:** Wrong ZIP-317 fee formula (Pitfall 8), stale witness after reorg (Pitfall 9), broadcasting without balance check (security mistake in PITFALLS.md), building proof before validating spendable balance (expensive failure)
**Uses:** `zcash_primitives 0.26` Builder, `zcash_proofs 0.26` with `local-prover` + `download-params`, `zcash_client_backend` `SendTransaction`; Neon worker thread for proof generation (avoid blocking event loop)
**Research flag:** This phase needs `/gsd:research-phase`. Sapling Builder API interaction with `zcash_client_backend`'s proposal/fulfill pattern vs direct Builder use is not fully resolved. The `build_sapling_transaction` function signature in ARCHITECTURE.md is a sketch, not a verified API.

### Phase 5: OpenClaw ClawHub Packaging

**Rationale:** Independent of Phase 4 — can and should ship wrapping existing skills (Phases 1-3) before shielded send is ready. First-mover advantage on ClawHub is time-sensitive.
**Delivers:** SKILL.md files for all skills, `openclaw/manifest.json`, ClawHub publication at `clawhub publish`, npm + ClawHub dual delivery
**Addresses:** OpenClaw ClawHub packaging (P1 feature), first-mover position in ZCash on ClawHub
**Uses:** SKILL.md YAML frontmatter format per official spec; `install.kind: node`, `package: zcashskills`; MIT-0 license; SHA-256 signature field per post-ClawHavoc security requirement; `npx clawhub publish`
**Research flag:** ClawHub post-ClawHavoc security requirements (SHA-256 signature field, disable-model-invocation flag) are MEDIUM confidence — verify against current ClawHub docs at publication time.

### Phase Ordering Rationale

- Phases 1 → 2 → 3 → 4 is a strict dependency chain enforced by the feature dependency graph in FEATURES.md and the data flow diagrams in ARCHITECTURE.md. Deviating from this order means building features that cannot be tested end-to-end.
- Phase 5 (OpenClaw) is independent but benefits from shipping after Phase 3 so balance-check can be included. It should not wait for Phase 4 (send).
- The native module hardening (Pitfall 6, Pitfall 10) is bundled into Phase 1 rather than made a separate phase, because it affects all future Rust additions and costs less to fix upfront than to retrofit.
- Shielded send is Phase 4 (not earlier) because: (a) note selection requires a scanned note database from Phase 3, (b) the infrastructure (lightwalletd client, wallet store) must be proven stable before adding the most complex operation.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Balance Checking):** `zcash_client_backend` + `zcash_client_sqlite` WalletRead/WalletWrite/BlockSource trait implementation details; `sync` feature state machine initialization; whether in-memory vs SQLite backend changes the scanning API surface
- **Phase 4 (Shielded Send):** Sapling Builder API — specifically how to interface `zcash_primitives::transaction::builder::Builder` with notes discovered via `zcash_client_backend` scanning; whether to use the proposal/fulfill pattern or direct Builder; Neon worker thread integration for proof generation
- **Phase 5 (OpenClaw):** Post-ClawHavoc ClawHub security requirements — SHA-256 skill bundle signature format and `disable-model-invocation` flag semantics

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1 (Wallet Persistence):** Argon2id + XChaCha20-Poly1305 pattern is fully specified in STACK.md; RustCrypto crate APIs are straightforward; wallet.json format is defined
- **Phase 2 (Viewing Keys):** Derivation chain is a one-liner in zcash_keys 0.12; bech32m encoding is handled by the crate; main risk is verifying exact method names, which is a documentation lookup, not research

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core librustzcash crates verified via docs.rs; version alignment from GitHub workspace Cargo.toml (HIGH); lightwalletd community endpoints and neon 0.10 vs 1.x migration path are MEDIUM |
| Features | MEDIUM | ZCash protocol docs (ZIPs, zcash.readthedocs.io) are HIGH; OpenClaw ClawHub platform details are MEDIUM (platform evolving); shielded send complexity assessment is based on protocol understanding not implementation validation |
| Architecture | MEDIUM | Protocol specs (ZIPs) are HIGH; Node.js/Neon integration patterns and exact librustzcash API method names are MEDIUM (need verification against current crate docs at implementation time) |
| Pitfalls | MEDIUM | Cryptographic pitfalls (seed exposure, KDF weakness) are HIGH confidence from security first principles; ZCash-specific pitfalls (witness staleness, ZIP-317 fee) are MEDIUM from official specs; Neon-specific pitfalls are MEDIUM from Neon docs |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Exact Rust API method names for zcash_keys 0.12:** ARCHITECTURE.md notes MEDIUM confidence on `to_unified_full_viewing_key()` and `sapling().to_incoming_viewing_key()` — verify at implementation start for Phase 2.
- **zcash_client_backend scanning API surface with SQLite backend:** How to initialize the `WalletDb`, register the wallet birthday, and drive the sync state machine in a Neon synchronous context needs a targeted code read of `zcash_client_sqlite` examples before Phase 3 implementation.
- **Sapling Builder integration with scanned notes:** Whether `zcash_primitives::transaction::builder::Builder` accepts notes directly from `zcash_client_backend`'s data types or requires a translation layer is unresolved — needs research before Phase 4.
- **ClawHub post-ClawHavoc requirements:** The SHA-256 signature field and `disable-model-invocation` flag for ClawHub publication are noted in FEATURES.md as MEDIUM confidence — verify against current ClawHub CLI docs before Phase 5.
- **lightwalletd community endpoint reliability:** `zec.rocks:443` is community-operated; always make the endpoint configurable via `ZCASH_LIGHTWALLETD_URL` environment variable; document the trust model (semi-trusted light client server).

---

## Sources

### Primary (HIGH confidence)
- [ZCash Wallet UX Checklist](https://zcash.readthedocs.io/en/latest/rtd_pages/ux_wallet_checklist.html) — confirmed/unconfirmed balance display, fee policy
- [ZIP-316: Unified Addresses and Unified Viewing Keys](https://zips.z.cash/zip-0316) — UFVK/UIVK types, bech32m encoding
- [ZIP-32: Shielded HD Wallets](https://zips.z.cash/zip-0032) — derivation path structure
- [ZIP-317: Proportional Transfer Fee Mechanism](https://zips.z.cash/zip-0317) — fee formula
- [ZIP-310: Security Properties of Sapling Viewing Keys](https://zips.z.cash/zip-0310) — FVK vs IVK disclosure
- [librustzcash GitHub Cargo.toml](https://github.com/zcash/librustzcash/blob/main/Cargo.toml) — workspace version alignment
- [OpenClaw clawhub skill-format.md](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md) — SKILL.md frontmatter spec
- [lightwalletd service.proto](https://raw.githubusercontent.com/zcash/lightwallet-protocol/main/walletrpc/service.proto) — gRPC method list
- [Coinbase Agentic Wallet Skills](https://github.com/coinbase/agentic-wallet-skills) — competitive reference
- [BankrBot OpenClaw Skills](https://github.com/BankrBot/openclaw-skills) — competitive reference

### Secondary (MEDIUM confidence)
- [zcash_client_backend docs.rs v0.21.2](https://docs.rs/zcash_client_backend/latest/zcash_client_backend/) — feature flags, lightwalletd-tonic, sync
- [zcash_primitives docs.rs v0.26.4](https://docs.rs/zcash_primitives/latest/zcash_primitives/) — transaction builder
- [zcash_client_sqlite docs.rs v0.19.5](https://docs.rs/zcash_client_sqlite/latest/zcash_client_sqlite/) — WalletRead/WalletWrite traits
- [chacha20poly1305 docs.rs v0.10.1](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/) — XChaCha20 variant API
- [argon2 docs.rs v0.5.3](https://docs.rs/argon2/latest/argon2/) — KDF API
- [OWASP Password Storage Cheat Sheet 2025](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — KDF iteration recommendations
- [Neon bindings thread safety docs](https://docs.neon-bindings.com/neon/thread/) — panic behavior, worker threads
- [Zec.rocks community lightwalletd endpoint](https://forum.zcashcommunity.com/t/zec-rocks-workshop-host-a-light-wallet-server/52024) — community endpoint

### Tertiary (LOW confidence)
- [DAGSync design doc](https://hackmd.io/@str4d/dagsync-graph-aware-zcash-wallets) — witness cache architecture (needs validation at Phase 4)
- [ClawHub publishing guide](https://advenboost.com/en/clawhub/) — third-party ClawHub guide (verify against official docs before Phase 5)

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
