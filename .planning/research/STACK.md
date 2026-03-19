# Stack Research

**Domain:** ZCash wallet features — seed encryption, lightwalletd connectivity, transaction construction, viewing keys — in a Node.js/Rust hybrid npm package
**Researched:** 2026-03-20
**Confidence:** MEDIUM (ZCash Rust crate ecosystem verified via official docs; neon 1.x migration guidance MEDIUM confidence; OpenClaw skill format HIGH confidence from official spec)

---

## Existing Foundation (Do Not Re-research)

The project already has these locked in and working:

| Technology | Version | Purpose |
|------------|---------|---------|
| neon | 0.10.1 | Rust-Node FFI (cdylib via napi-6) |
| zcash_keys | 0.12.0 | Key derivation, UnifiedSpendingKey |
| zcash_address | 0.10.1 | Address encoding/decoding |
| zcash_protocol | 0.7 | Network constants, consensus types |
| zip32 | 0.2 | HD key derivation, AccountId |
| rand | 0.8 | Cryptographic randomness (OsRng) |

---

## Recommended Stack — New Milestone Additions

### Core Rust Crates (add to `native/Cargo.toml`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `zcash_client_backend` | `0.21` | lightwalletd gRPC client, wallet sync state machine, viewing key types | Official librustzcash crate; provides `lightwalletd-tonic` feature for tonic gRPC bindings and `sync` feature for the block-scanning state machine. Only official Rust API for lightwalletd. Verified at docs.rs v0.21.2. |
| `zcash_primitives` | `0.26` | Transaction builder for shielded sends (Sapling spends/outputs) | Official transaction construction crate. `Builder` struct handles Sapling spend proofs and output creation. Co-versioned with `zcash_client_backend` in the same workspace. Verified at docs.rs v0.26.4. |
| `zcash_proofs` | `0.26` | Groth16 proving keys for Sapling ZK proofs | Required to construct valid Sapling transactions. Has `download-params` and `local-prover` cargo features; download sapling-spend.params + sapling-output.params at build time or first run. Co-versioned with zcash_primitives. |
| `zcash_client_sqlite` | `0.19` | SQLite-backed wallet state: scanned blocks, notes, nullifiers | Official reference implementation of WalletRead/WalletWrite/BlockSource traits. Avoids having to implement the entire wallet state layer. Verified at docs.rs v0.19.5. |
| `chacha20poly1305` | `0.10.1` | Seed encryption at rest (XChaCha20-Poly1305) | Pure Rust, RustCrypto-maintained, no C dependencies. XChaCha20 variant provides 192-bit nonce (eliminates nonce reuse risk for a single-file persisted seed). Already in the dependency tree via `aead 0.5.2` in the current Cargo.lock. Verified at docs.rs v0.10.1. |
| `argon2` | `0.5.3` | Key derivation from user passphrase to encryption key | Purpose-built memory-hard KDF. `hash_password_into()` fills a 32-byte buffer for use as ChaCha20 key. Better than PBKDF2 for this use case: GPU-resistant by default. Verified at docs.rs v0.5.3. |
| `tonic` | `0.14.5` | gRPC transport layer for lightwalletd (used via `zcash_client_backend`) | `zcash_client_backend` activates tonic internally via its `lightwalletd-tonic` feature; you do NOT add tonic directly unless building your own proto stubs. Listed here so the version is visible for tokio runtime compatibility. Verified at docs.rs v0.14.5. |
| `tokio` | `1.x` (latest 1.x) | Async runtime for gRPC calls and block sync | Required by tonic's async transport. Use `tokio::runtime::Runtime::block_on()` to bridge from Neon's synchronous call context to async Rust. Must be 1.x (not 0.x). |

### Supporting Rust Crates

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `serde` + `serde_json` | `1.x` | Serialize wallet state to/from JSON for JS layer | When passing structured data across the FFI boundary; prefer JSON strings over complex Neon type mapping |
| `rusqlite` | `0.31` | Direct SQLite access if you bypass `zcash_client_sqlite` | Only if you need custom queries that WalletRead doesn't expose; normally prefer `zcash_client_sqlite` |
| `zcash_lightwallet_proto` | latest | Protobuf definitions for lightwalletd gRPC protocol | Only needed if generating your own gRPC client stubs; `zcash_client_backend` bundles them, so check if you need this separately |

### JavaScript / Node Layer (add to `package.json`)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new npm deps required for core features | — | All crypto and network I/O is Rust-side | Key principle: keep crypto and network calls in Rust, export results to JS as plain objects |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `neon build --release` (existing) | Compile Rust to .node binary | No changes needed; existing build pipeline is correct |
| `prebuildify` (existing) | Package prebuilt binaries | Add linux-x64 and win32-x64 prebuilds to existing darwin prebuilds |
| OpenClaw ClawHub CLI (`npx clawhub publish`) | Publish skill to ClawHub registry | SKILL.md + npm package; MIT-0 license required |

---

## Cargo Feature Flags to Enable

When adding `zcash_client_backend` to `native/Cargo.toml`, enable these features:

```toml
[dependencies]
zcash_client_backend = { version = "0.21", features = [
    "lightwalletd-tonic",              # gRPC tonic client for lightwalletd
    "lightwalletd-tonic-tls-webpki-roots", # TLS with bundled webpki roots (no system certs needed)
    "sync",                            # Block scanning state machine
] }

zcash_primitives = { version = "0.26", features = [
    "circuits",     # Default — needed for Groth16 proof creation
    "multicore",    # Default — parallel proof computation
] }

zcash_proofs = { version = "0.26", features = [
    "local-prover",    # Load proving params from disk
    "download-params", # Download sapling params if not present
] }

zcash_client_sqlite = { version = "0.19" }

chacha20poly1305 = "0.10.1"
argon2 = "0.5.3"

tokio = { version = "1", features = ["rt", "rt-multi-thread", "macros"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

---

## OpenClaw Skill Packaging (SKILL.md format)

**Confidence:** HIGH — verified from official `openclaw/clawhub` skill-format.md spec.

Each skill directory requires a `SKILL.md` with YAML frontmatter:

```yaml
---
name: zcash-generate-address
description: Generate ZCash shielded addresses using librustzcash
version: 1.0.0
metadata:
  openclaw:
    install:
      - kind: node
        package: zcashskills
    requires:
      bins: []
      env: []
---
# Generate ZCash Shielded Address

[Markdown instructions for the agent go here]
```

**Key constraints:**
- Slug must be lowercase alphanumeric with hyphens
- Total skill bundle: 50MB max
- All text-based files only (no compiled binaries in the skill itself; the npm package install handles that)
- License: MIT-0 required for ClawHub publication (no copyright reservation)
- The `install.kind: node` + `package: zcashskills` instructs ClawHub to run `npm install zcashskills` when the skill is activated

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `chacha20poly1305` (XChaCha20) | `aes-gcm` (AES-256-GCM) | AES-GCM requires hardware AES for constant-time safety; XChaCha20 is safe in pure software on all platforms including ARM Macs without hardware AES acceleration |
| `argon2` (Argon2id) | `pbkdf2` | PBKDF2 is GPU-parallelizable; Argon2id is memory-hard and GPU-resistant by design — better for a seed file that must withstand offline attack |
| `zcash_client_sqlite` | Custom SQLite schema | Rolling your own WalletRead/WalletWrite means handling note commitment trees, nullifier sets, wallet birthday sync, and anchor calculation — months of work; use the reference implementation |
| `zcash_client_backend` gRPC via `lightwalletd-tonic` | Raw proto + tonic generated client | `zcash_client_backend` already bundles the protobuf definitions and generates the gRPC stubs; adding them separately creates version skew risk |
| Stay on `neon 0.10` for now | Migrate to `neon 1.x` (latest 1.1.1) | Neon 1.0 fixed several unsoundness issues but is a breaking API change. The existing 0.10 code works and is production-stable. Migrating mid-milestone adds risk without feature benefit. Plan a separate migration milestone after this one. |
| `tokio` `block_on()` bridge | `neon-serde` async channels | Neon 0.10 has limited async support; `tokio::runtime::Runtime::new().block_on(async { ... })` is the simplest safe bridge pattern for Neon 0.10. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ring` (encryption) | Compiles a C/C++ static lib; creates cross-compilation headaches for prebuilt binary packaging on Windows and musl targets | `chacha20poly1305` (pure Rust, no C deps) |
| `openssl` (TLS) | Same C compilation problem; adds 10MB+ to binary; hard to cross-compile | `rustls` (bundled via `webpki-roots` TLS feature in `zcash_client_backend`) |
| `sapling-crypto` directly | Low-level; the `zcash_primitives` Builder API is the correct entry point for transaction construction; going lower causes proof integration bugs | `zcash_primitives::transaction::builder::Builder` |
| Any npm ZCash library (`zcash-js`, `bitgo-utxo-lib` with zcash fork, `zecwallet-lib`) | All unmaintained; last npm ZCash packages are 7-9 years old; no Sapling support | Keep all ZCash crypto in Rust via librustzcash |
| Neon 1.x API | Breaking changes from 0.10; all existing skill exports use 0.10 API (`FunctionContext`, `JsResult`, neon prelude pattern); migrating during this milestone adds risk | Stay on neon 0.10.1 for this milestone; plan migration later |
| `zcash_client_memory` | In-memory wallet — no persistence; does not survive process restart | `zcash_client_sqlite` |

---

## Stack Patterns by Variant

**For seed encryption (store wallet seed to disk):**
- User passphrase → Argon2id KDF → 32-byte key → XChaCha20-Poly1305 encrypt(seed) → write ciphertext + salt + nonce to `~/.zcashskills/wallet.enc`
- Never store the seed or key in plaintext; never log it

**For balance checking (read-only, no spending):**
- Use `zcash_client_backend` + `zcash_client_sqlite` for block scanning
- `lightwalletd-tonic` feature for gRPC connection to `mainnet.lightwalletd.com:443` or community endpoint `zec.rocks:443`
- Sync from wallet birthday (block height at key creation) to avoid full chain scan

**For shielded send (z-to-z transaction):**
- Requires proving params on disk (sapling-spend.params, sapling-output.params, ~50MB total)
- `zcash_proofs` with `local-prover` feature; params downloaded once to `~/.zcash-params/`
- `zcash_primitives` Builder constructs the transaction; `zcash_client_backend` submits via lightwalletd

**For viewing key export:**
- `UnifiedSpendingKey.to_unified_full_viewing_key()` from existing `zcash_keys` crate (already a dependency)
- Encode to string via `zcash_keys::encoding` (NOT the deprecated `zcash_client_backend::encoding`)

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `zcash_client_backend 0.21` | `zcash_primitives 0.26`, `zcash_keys 0.12`, `zcash_address 0.10` | All from the same librustzcash workspace; must stay in sync |
| `zcash_client_sqlite 0.19` | `zcash_client_backend 0.21` | Co-released; always match minor versions |
| `zcash_proofs 0.26` | `zcash_primitives 0.26` | Must match exactly — they share the same proving key format |
| `neon 0.10.1` | Node.js >=16 with napi-6 | Do NOT mix neon 0.10 and neon 1.x in the same crate |
| `tokio 1.x` | `tonic 0.14.5` | tonic 0.14.x requires tokio 1.x; tokio 0.x is incompatible |
| `argon2 0.5.3` | `chacha20poly1305 0.10.1` | No direct dependency; both use RustCrypto trait ecosystem; compatible |

---

## Installation

```bash
# No new npm packages needed — all new capabilities are in Rust

# Update native/Cargo.toml with the additions above, then:
cd native && cargo build --release

# For the sapling proving params (~50MB, one-time download):
# zcash_proofs download-params feature handles this at runtime
# Or manually:
# mkdir -p ~/.zcash-params && curl -O https://download.z.cash/downloads/sapling-spend.params
# curl -O https://download.z.cash/downloads/sapling-output.params
```

---

## lightwalletd Endpoints

**Confidence:** MEDIUM — verified from community sources; ECC-maintained endpoints went offline; community endpoints are maintained by ZEC Operators program.

| Network | Endpoint | Port | TLS |
|---------|----------|------|-----|
| Mainnet | `zec.rocks` | 443 | Yes (TLS) |
| Testnet | `testnet.lightwalletd.com` | 443 | Yes (TLS) |
| Local dev | `127.0.0.1` | 9067 | No |

Make the endpoint configurable via environment variable (`ZCASH_LIGHTWALLETD_URL`); do not hardcode.

---

## Sources

- [zcash_client_backend docs.rs v0.21.2](https://docs.rs/zcash_client_backend/latest/zcash_client_backend/) — Feature flags, lightwalletd-tonic, sync, viewing keys — MEDIUM confidence
- [zcash_primitives docs.rs v0.26.4](https://docs.rs/zcash_primitives/latest/zcash_primitives/) — Transaction builder, Cargo features — MEDIUM confidence
- [zcash_client_sqlite docs.rs v0.19.5](https://docs.rs/zcash_client_sqlite/latest/zcash_client_sqlite/) — WalletRead/WalletWrite/BlockSource traits, SQLite storage — MEDIUM confidence
- [zcash_keys docs.rs v0.12.0](https://docs.rs/zcash_keys/latest/zcash_keys/) — Current version, viewing key encoding — MEDIUM confidence
- [chacha20poly1305 docs.rs v0.10.1](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/) — Version, XChaCha20 variant API — HIGH confidence
- [argon2 docs.rs v0.5.3](https://docs.rs/argon2/latest/argon2/) — Version, hash_password_into() KDF — HIGH confidence
- [neon docs.rs v1.1.1](https://docs.rs/neon/latest/neon/) — Current version; 0.10 vs 1.x assessment — MEDIUM confidence
- [tonic docs.rs v0.14.5](https://docs.rs/tonic/latest/tonic/) — Current version — HIGH confidence
- [librustzcash GitHub Cargo.toml](https://github.com/zcash/librustzcash/blob/main/Cargo.toml) — Workspace version alignment confirmation — HIGH confidence
- [zcash_proofs source](https://github.com/zcash/librustzcash/blob/main/zcash_proofs/src/lib.rs) — download-params and local-prover features — MEDIUM confidence
- [OpenClaw clawhub skill-format.md](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md) — SKILL.md frontmatter spec, Node.js install kind — HIGH confidence
- [Zec.rocks Workshop](https://forum.zcashcommunity.com/t/zec-rocks-workshop-host-a-light-wallet-server/52024) — Community lightwalletd endpoint — MEDIUM confidence

---
*Stack research for: ZCash wallet features (seed encryption, lightwalletd, shielded send, viewing keys, OpenClaw packaging)*
*Researched: 2026-03-20*
