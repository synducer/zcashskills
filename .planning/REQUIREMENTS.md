# Requirements: ZCashSkills

**Defined:** 2026-03-20
**Core Value:** Users can generate, persist, and control a real ZCash shielded wallet through an AI agent — receiving, sending, and verifying private payments without ever exposing keys to external services.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Wallet Management

- [ ] **WALL-01**: User can create a new wallet with encrypted seed persistence (Argon2id KDF + XChaCha20-Poly1305 AEAD, seed encrypted inside Rust before crossing FFI boundary)
- [ ] **WALL-02**: User can load/unlock an existing wallet file with passphrase decryption
- [ ] **WALL-03**: Wallet stores birthday block height at creation time for efficient chain scanning
- [ ] **WALL-04**: User can generate BIP-39 24-word mnemonic backup phrase for seed recovery

### Balance & Sync

- [ ] **SYNC-01**: User can query shielded balance via lightwalletd compact block scanning (note decryption in Rust using IVK)
- [ ] **SYNC-02**: Balance display shows both total and spendable amounts
- [ ] **SYNC-03**: User can view transaction history with memos

### Payments

- [ ] **PAY-01**: User can send a shielded payment (z-to-z) with memo field, using ZIP-317 fee calculation and Sapling zk-SNARK proof generation

### Viewing Keys

- [ ] **VIEW-01**: User can export Incoming Viewing Key (IVK) — privacy-safe default for auditors
- [ ] **VIEW-02**: User can export Full Viewing Key (FVK) with explicit opt-in (exposes outgoing transaction graph)
- [ ] **VIEW-03**: User can export Unified Full Viewing Key (UFVK) encoded per ZIP-316

### Packaging & Distribution

- [ ] **PKG-01**: npm package is publishable with prebuilt binaries for linux-x64, darwin-x64, darwin-arm64, win32-x64
- [ ] **PKG-02**: OpenClaw SKILL.md created for ClawHub listing with proper metadata and SHA-256 signature
- [ ] **PKG-03**: ZCG grant application document prepared covering SDK, key-management, and payment skills
- [ ] **PKG-04**: Example OpenClaw agent with full payment workflow (create wallet, receive, check balance, send)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Wallet Management

- **WALL-05**: Multi-wallet support (manage multiple wallet files)
- **WALL-06**: Wallet import from existing seed/mnemonic

### Balance & Sync

- **SYNC-04**: Incremental sync with last-scanned-height persistence for resumable scanning
- **SYNC-05**: Pending transaction tracking with expiry countdown

### Payments

- **PAY-02**: Multi-output batch payments (send to multiple recipients in one transaction)
- **PAY-03**: Non-blocking proof generation via Neon worker threads

### Viewing Keys

- **VIEW-04**: Viewing key import for watch-only wallet capability

### Packaging

- **PKG-05**: Orchard pool support alongside Sapling
- **PKG-06**: LangChain tool integration example

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full node operation | Light client via lightwalletd only; full nodes are heavy infrastructure |
| Transparent (t-addr) transactions | Shielded-first; privacy is the core value proposition |
| Orchard pool support | Sapling first; Orchard adds complexity, can be layered in v2 |
| Mobile SDKs (iOS/Android) | Node.js/npm only for v1; mobile has official ZCash SDKs |
| Exchange integration | Self-custody focus; exchanges have their own APIs |
| Web wallet UI | SDK/agent interface only; no frontend rendering |
| Multi-account HD wallet | Single account (AccountId::ZERO) for v1 simplicity |
| USK serialization | librustzcash explicitly documents no stable serialization; persist seed only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WALL-01 | — | Pending |
| WALL-02 | — | Pending |
| WALL-03 | — | Pending |
| WALL-04 | — | Pending |
| SYNC-01 | — | Pending |
| SYNC-02 | — | Pending |
| SYNC-03 | — | Pending |
| PAY-01 | — | Pending |
| VIEW-01 | — | Pending |
| VIEW-02 | — | Pending |
| VIEW-03 | — | Pending |
| PKG-01 | — | Pending |
| PKG-02 | — | Pending |
| PKG-03 | — | Pending |
| PKG-04 | — | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after initial definition*
