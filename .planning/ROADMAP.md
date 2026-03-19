# Roadmap: ZCashSkills

## Overview

Starting from a working native module (address generation, validation, ZIP-321 payment URIs), this roadmap builds a complete ZCash shielded wallet SDK for AI agents. The dependency chain is strict: wallet persistence must exist before anything else, viewing keys unlock balance scanning, balance scanning enables shielded send, and packaging wraps the full capability for distribution. Five phases, each delivering verifiable capability that unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Wallet Persistence** - Users can create and unlock encrypted wallets with seed persistence (completed 2026-03-19)
- [ ] **Phase 2: Viewing Keys** - Users can export IVK, FVK, and UFVK for selective disclosure and auditing
- [ ] **Phase 3: Balance and Sync** - Users can query confirmed and unconfirmed shielded balances via lightwalletd
- [ ] **Phase 4: Shielded Send** - Users can send z-to-z shielded payments with encrypted memo fields
- [ ] **Phase 5: Packaging and Distribution** - Package is publishable to npm and listed on OpenClaw ClawHub with ZCG grant materials

## Phase Details

### Phase 1: Wallet Persistence
**Goal**: Users can create, save, and reload an encrypted ZCash wallet without ever exposing the raw seed
**Depends on**: Nothing (first phase)
**Requirements**: WALL-01, WALL-02, WALL-03, WALL-04
**Success Criteria** (what must be TRUE):
  1. User can create a new wallet and receive a 24-word BIP-39 mnemonic backup phrase
  2. User can unlock an existing wallet file with their passphrase and get a ready-to-use wallet handle
  3. Wallet file on disk is encrypted (Argon2id KDF + XChaCha20-Poly1305); plaintext seed never appears in the file or JS memory
  4. Wallet file records birthday block height so subsequent scans do not replay the full chain
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md — Rust crypto: create_wallet and load_wallet Neon functions (bip39 + argon2 + chacha20poly1305)
- [ ] 01-02-PLAN.md — JS skill: wallet-persist skill, constants, lib/index.js wiring, unit tests

### Phase 2: Viewing Keys
**Goal**: Users can export privacy-appropriate viewing keys for selective disclosure and compliance auditing
**Depends on**: Phase 1
**Requirements**: VIEW-01, VIEW-02, VIEW-03
**Success Criteria** (what must be TRUE):
  1. User can export an Incoming Viewing Key (IVK) — default path; reveals only inbound transactions
  2. User can export a Full Viewing Key (FVK) — requires explicit opt-in; exposes outgoing transaction graph
  3. User can export a Unified Full Viewing Key (UFVK) encoded per ZIP-316 as a bech32m string
**Plans**: TBD

### Phase 3: Balance and Sync
**Goal**: Users can see their current confirmed and spendable shielded balance along with transaction history
**Depends on**: Phase 2 (IVK for note decryption), Phase 1 (birthday height for scan start)
**Requirements**: SYNC-01, SYNC-02, SYNC-03
**Success Criteria** (what must be TRUE):
  1. User can query shielded balance and receive separate confirmed and spendable amounts (not a single merged number)
  2. Balance query runs compact block scanning in Rust using the wallet IVK — no note decryption happens in JavaScript
  3. User can view transaction history with memo field contents for received notes
**Plans**: TBD

### Phase 4: Shielded Send
**Goal**: Users can broadcast a z-to-z shielded payment with encrypted memo and correct ZIP-317 fee
**Depends on**: Phase 3 (scanned notes, lightwalletd infrastructure)
**Requirements**: PAY-01
**Success Criteria** (what must be TRUE):
  1. User can send ZEC to a shielded address and receive a transaction ID confirming broadcast
  2. Payment includes an optional encrypted 512-byte memo field visible only to the recipient
  3. Fee is calculated via ZIP-317 formula (not a hardcoded constant); a simple z-to-z costs 10,000 zatoshis minimum
  4. Sapling proving parameters are downloaded once to ~/.zcash-params/ and reused on subsequent sends
**Plans**: TBD

### Phase 5: Packaging and Distribution
**Goal**: The package is publishable on npm, listed on OpenClaw ClawHub as the first ZCash skill, and supported by ZCG grant materials
**Depends on**: Phase 3 (balance-check skill ships with ClawHub listing), Phase 4 (complete workflow for example agent)
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04
**Success Criteria** (what must be TRUE):
  1. npm publish succeeds with prebuilt binaries for linux-x64, darwin-x64, darwin-arm64, and win32-x64 — no local Rust toolchain required for consumers
  2. ClawHub listing is live with valid SKILL.md files (SHA-256 signature, correct metadata) for all shipped skills
  3. ZCG grant application document covers SDK, key-management tools, and payment skills with required sections
  4. Example OpenClaw agent demonstrates complete payment workflow: create wallet, receive address, check balance, send
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Wallet Persistence | 2/2 | Complete   | 2026-03-19 |
| 2. Viewing Keys | 0/? | Not started | - |
| 3. Balance and Sync | 0/? | Not started | - |
| 4. Shielded Send | 0/? | Not started | - |
| 5. Packaging and Distribution | 0/? | Not started | - |
