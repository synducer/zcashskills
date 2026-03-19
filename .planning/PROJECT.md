# ZCashSkills

## What This Is

A privacy-preserving ZCash SDK for AI agents (OpenClaw, LangChain) that provides shielded wallet operations as an npm package. Uses librustzcash compiled to a native Node.js module via Neon bindings, enabling local cryptographic operations with zero external network calls for key generation and address management. Targets both developers building ZCash integrations and end-users running AI agents for private payments.

## Core Value

Users can generate, persist, and control a real ZCash shielded wallet through an AI agent — receiving, sending, and verifying private payments without ever exposing keys to external services.

## Requirements

### Validated

- ✓ Generate real ZCash shielded addresses (mainnet/testnet) via librustzcash — existing
- ✓ Validate ZCash address format with network/type detection — existing
- ✓ Create ZIP-321 compliant payment URIs — existing
- ✓ Parse ZIP-321 payment URIs into structured data — existing
- ✓ Rust native module builds and loads on darwin-arm64 — existing
- ✓ Platform detection with fallback to source build — existing

### Active

- [ ] Encrypted seed persistence so generated wallets are controllable
- [ ] Balance checking via lightwalletd connection
- [ ] Send shielded payments (z-to-z transactions)
- [ ] Viewing key generation for selective disclosure/compliance
- [ ] OpenClaw ClawHub skill packaging (SKILL.md + skill format)
- [ ] npm package publication readiness
- [ ] ZCG grant application materials

### Out of Scope

- Full node operation — lightwalletd light client only
- Transparent (t-addr) transaction support — shielded-first, privacy is the value prop
- Orchard pool support — Sapling first, Orchard can come later
- Mobile SDKs — Node.js/npm only for v1
- Exchange integration — self-custody focus
- Web wallet UI — SDK/agent interface only, no frontend
- Multi-account HD wallet — single account (AccountId::ZERO) for v1

## Context

**Ecosystem state (March 2026):**
- Entire ECC team resigned Dec 2025; Zcash Open Development Lab (ODL) formed, raised $25M seed from Paradigm/a16z
- 73 exchanges delisted privacy coins in 2025; EU AMLR (July 2027) will restrict further
- ~27-30% of ZCash transactions use shielded pool; growing due to Zashi/Zodl making shielded default
- npm ZCash library landscape is essentially abandoned (last packages 7-9 years old)
- Zero privacy-coin skills exist on OpenClaw; BankrBot has 16 EVM-chain skills but nothing for ZCash
- ZCG has $18M (71,390 ZEC) in grant funding; explicitly funds "SDK", "Key-management tools", "Easy one-click shielded payments"

**Technical state:**
- Working Rust native module (`native/src/lib.rs`) using zcash_keys 0.12, zcash_address 0.10, neon 0.10
- C++ mock addon exists (`native/src/addon.cpp`) but is superseded by real Rust implementation
- Skills pattern: each skill is an async function module with `.meta` export, returning `{ success, ... }` objects
- Native module loads at require-time from `prebuilds/<platform>/zcash-native.node` or `native/index.node`

**Competitive landscape:**
- ETHSkills (Austin Griffith, 155 stars): knowledge-correction markdown docs for Ethereum — different model
- Coinbase Agentic Wallets: EVM/Solana only, no privacy coins
- No comparable ZCash SDK for AI agents exists anywhere

## Constraints

- **Crypto library**: Must use official librustzcash crates — no custom cryptography
- **Privacy**: All key operations must be local — no keys transmitted over network
- **Network**: lightwalletd for balance/transaction queries — standard ZCash light client infrastructure
- **Platform**: Node.js >=16, Rust required for source builds, prebuilt binaries for linux-x64, darwin-x64, darwin-arm64, win32-x64
- **Security**: Seed encryption at rest using user-provided passphrase — keys must never be stored in plaintext
- **Compatibility**: ZIP-321 (payment URIs), ZIP-32 (key derivation), Sapling protocol

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Neon 0.10 for Rust-Node FFI | Stable release; neon 1.x still alpha | ✓ Good — builds and runs |
| Sapling-only (no Orchard) | Sapling has wider wallet support and larger anonymity set currently | — Pending |
| librustzcash for all crypto | Official ZCash cryptography; audited, maintained by ZCash ecosystem | ✓ Good |
| Light client via lightwalletd | No full node requirement; standard infrastructure; ZCG funds lightwalletd maintenance | — Pending |
| Local seed encryption with passphrase | Simple, no external KMS dependency; user controls their own security | — Pending |
| Single account (AccountId::ZERO) | Simplicity for v1; multi-account adds complexity without clear agent use case | — Pending |

---
*Last updated: 2026-03-20 after initialization*
