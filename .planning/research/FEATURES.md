# Feature Research

**Domain:** ZCash SDK / AI agent skill package (npm)
**Researched:** 2026-03-20
**Confidence:** MEDIUM — ZCash protocol docs HIGH confidence; AI agent skill packaging MEDIUM confidence; sending complexity flagged LOW confidence pending implementation research

---

## Context

This is a subsequent milestone on an existing package. Four skills already ship and work:
- `generate-address` — Sapling address generation via librustzcash (local, native Rust module)
- `validate-address` — Address format validation with network/type detection
- `create-payment-uri` — ZIP-321 compliant payment URI generation
- `parse-payment-uri` — ZIP-321 payment URI parsing

The milestone adds: wallet persistence, balance checking, shielded send, viewing keys, and OpenClaw packaging.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features any crypto wallet SDK must have to be taken seriously. Missing these = product feels broken or toy-grade.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Encrypted seed persistence** | Without persistence, every agent run generates a new wallet — funds become inaccessible. Users cannot receive payments if address changes. | MEDIUM | AES-256 + Argon2id KDF is the modern standard (referenced in ZCash issue #1207 and NozyWallet). Store encrypted blob to disk; decrypt with passphrase at runtime. Never store plaintext seed. |
| **Balance checking** | Useless to have an address without knowing if ZEC arrived. Core to any payment workflow. | MEDIUM | Requires lightwalletd gRPC connection. For Sapling shielded notes, must scan compact blocks and decrypt notes using the full viewing key — cannot use GetTaddressBalance (transparent only). `GetLatestBlock` + `GetBlockRange` + note scanning pipeline. |
| **Confirmed vs unconfirmed balance display** | ZCash UX checklist explicitly requires showing both "total balance" and "spendable (confirmed) balance" separately. Single balance figure is incorrect per ZCash standards. | LOW | After scanning notes, filter by confirmation count. Default: 10 confirmations for spendable. |
| **Shielded send (z-to-z)** | Core value prop of the package. Without send, users can only receive — wallet is read-only from agent perspective. | HIGH | Most complex feature: requires note selection, Sapling spend proof generation (zk-SNARK via librustzcash), anchor/witness from tree state, fee calculation, transaction serialization, and broadcast via `SendTransaction`. Likely requires additional Rust native code. |
| **Viewing key generation** | Watch-only wallets are a standard ZCash pattern. Compliance/auditing use case. ZIP-316 defines both UFVK (full) and UIVK (incoming-only). | LOW | `zcash_keys` crate already supports viewing key derivation. Mostly a matter of exposing what librustzcash already does. |
| **Fee transparency** | ZCash standard fee is 0.00001 ZEC (ZIP-317 ZIP-fees). UX checklist says display it clearly and do NOT let users customize it (uniform fees protect privacy). | LOW | Hardcode ZIP-317 fee. Do not expose fee parameter to callers. |
| **Transaction pending/expiry status** | ZCash UX checklist requires marking sent transactions as "pending" and showing expiry (default 20-block / ~1 hour). | LOW | Track outgoing tx by txid; poll `GetTransaction` until confirmed or expired. |

### Differentiators (Competitive Advantage)

Features the market does not have. This is where ZCash Skills wins.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **OpenClaw ClawHub skill packaging** | First and only ZCash/privacy-coin skill on ClawHub (13,729 skills, zero ZCash). BankrBot has 16 EVM skills but nothing for privacy coins. Discoverable by any OpenClaw user searching "ZCash" or "private payment". | MEDIUM | SKILL.md format with YAML frontmatter (name, description, triggers, bins, env requirements). ClawHub requires SHA-256 signature field and disable-model-invocation flag post-ClawHavoc security incident. `clawhub login` + `clawhub publish`. |
| **Incoming viewing key (UIVK) selective disclosure** | Allows agent to share proof of received payment with third party without exposing spending capability. Valuable for compliance, grants, escrow. No existing npm ZCash package supports this. | LOW | UIVK is derivable from UFVK per ZIP-316. ZCash UX checklist notes viewing keys should only be shared over secure channels — document this clearly. |
| **Full viewing key (UFVK) for outgoing + incoming** | Auditor can see both inflows and outflows. Required for tax/accounting integrations. | LOW | Already supported in zcash_keys via `ExtendedFullViewingKey`. Surface as a named export. |
| **Shielded memo field support** | Encrypted private message attached to transaction — unique to ZCash shielded. No cost increase (memos don't increase fees). Agents can attach payment references, invoice IDs, or instructions. | MEDIUM | Sapling notes include a 512-byte memo field. Encode memo bytes during transaction construction. Decrypt on receive during scanning. |
| **Local-only cryptographic operations** | All key generation, proof generation, and signing happen in-process. No keys sent to external services. Coinbase Agentic Wallets require their infrastructure; this is self-sovereign. | LOW (design decision) | Already the pattern. Native Rust module constraint enforces this. Document explicitly as privacy guarantee. |
| **npm package + OpenClaw dual delivery** | Available as `npm install zcashskills` for Node.js developers AND as a ClawHub installable skill for OpenClaw users. No other package bridges these two ecosystems for ZCash. | LOW (packaging) | npm publish + clawhub publish are independent operations. |
| **ZCG grant-ready documentation** | ZCG explicitly funds "SDK", "Key-management tools", "Easy one-click shielded payments". Well-documented SDK with clear privacy guarantees directly maps to grant criteria ($18M pool available). | LOW | CONTRIBUTING.md, grant application materials, feature parity with ZCG checklist items. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Transparent address (t-addr) support** | Perceived as simpler; ETH developers expect it; some exchanges only support t-addrs | Defeats the privacy value proposition. t-addr transactions are fully public. Adds dual-path complexity. Conflates "ZCash" with "Bitcoin clone". | Document that the package is shielded-first by design. If a caller needs t-addr compatibility, they should use a different tool. |
| **User-configurable transaction fees** | Power users want control | ZCash UX checklist explicitly prohibits: "Prevent users from customizing transaction fees to maintain privacy consistency." Custom fees create timing/fingerprinting attack vectors. | Hardcode ZIP-317 fee. No fee parameter exposed. |
| **Orchard pool support** | Orchard is the newer ZCash protocol with better privacy proofs | Sapling has the larger anonymity set currently; Orchard wallet support is still maturing; adding Orchard multiplies implementation surface 2x for unclear benefit in v1. | Sapling-first, Orchard in v2 once ecosystem matures. Document this decision. |
| **Multi-account HD wallet** | Power users with multiple identities want account separation | Adds wallet management complexity (account enumeration, per-account state, UI surface) without clear agent use case — agents typically represent a single entity. | Single account (AccountId::ZERO) for v1. HD derivation path is ZIP-32 compliant so multi-account is additive later without breaking changes. |
| **Key export / plaintext seed reveal** | Users want backups | Exporting keys in plaintext to agent responses risks key material appearing in logs, LLM context windows, or tool call outputs. | Offer encrypted export only. Never return seed phrase or spending key as a string in skill response. Document the risk. |
| **Web wallet UI** | Looks polished; easier for non-developers | SDK/agent interface is the value prop. A frontend adds React/build tooling, auth, CORS, CSP — doubles project scope without serving the target user (agent developers). | SDK-only. Direct callers to Zashi or Zodl for UI wallets. |
| **Full node operation** | Maximally trustless | Running zcashd or zebrad requires 40+ GB disk, multi-day sync, significant ops burden. Light client via lightwalletd is the industry standard for wallet SDKs (Zashi, Ywallet, Zodl all use it). | lightwalletd light client only. Document the trust model (semi-trusted lightwalletd server, as specified in ZCash wallet threat model). |

---

## Feature Dependencies

```
[Encrypted seed persistence]
    └──required by──> [Balance checking]
                          └──required by──> [Shielded send]
    └──required by──> [Viewing key generation]

[Balance checking]
    └──requires──> [lightwalletd gRPC connection]
                       └──requires──> [compact block scanning]
                                          └──requires──> [note decryption with UFVK]

[Shielded send]
    └──requires──> [Balance checking] (know what notes to spend)
    └──requires──> [Tree state / witness] (from lightwalletd GetTreeState)
    └──requires──> [Sapling spend proof] (Rust native, most complex)
    └──requires──> [Transaction broadcast] (lightwalletd SendTransaction)

[Viewing key generation]
    └──requires──> [Encrypted seed persistence] (derive from stored seed)
    └──enhances──> [Balance checking] (UFVK enables shielded note scanning)

[OpenClaw ClawHub packaging]
    └──wraps──> [generate-address, validate-address, create-payment-uri, parse-payment-uri]
    └──wraps──> [balance-checking] (after it ships)
    └──does not require──> [Shielded send] (can ship skills without send)

[Memo field support]
    └──requires──> [Shielded send] (for outgoing memos)
    └──requires──> [Balance checking / scanning] (to read incoming memos)
```

### Dependency Notes

- **Balance checking requires seed persistence:** Without a stored seed, the agent has no Full Viewing Key to decrypt incoming Sapling notes. The scan yields nothing.
- **Shielded send requires balance checking:** The note selection algorithm (choose notes to spend) depends on having scanned and indexed available notes.
- **Shielded send requires tree state:** The Sapling spend proof must commit to a Merkle tree anchor (a recent block's note commitment tree root). This comes from `GetTreeState` or `GetLatestTreeState` in lightwalletd. This is the step most implementors underestimate.
- **OpenClaw packaging does not block on send:** The four existing skills (address, validate, URI) can be packaged and published to ClawHub before send ships. Balance-checking can be added incrementally.
- **Viewing key generation does not require lightwalletd:** Derivation is pure cryptography (local). But a viewing key is only useful if you can actually scan with it — so balance scanning is the prerequisite for a useful UFVK export.

---

## MVP Definition

### Launch With (this milestone, v1.1)

- [ ] **Encrypted seed persistence** — Without this, every agent restart loses the wallet. Blocks all other features. Use Argon2id + AES-256-GCM. Store to configurable file path. Return address on load so callers don't need to re-derive.
- [ ] **Balance checking via lightwalletd** — Core promise of the milestone. gRPC connection to lightwalletd, compact block scan using UFVK, return confirmed and unconfirmed balances separately (per ZCash UX checklist).
- [ ] **Viewing key generation** — Low complexity, high value. Exposes UFVK (full) and UIVK (incoming-only). Required for selective disclosure. Documents ZIP-316 key types clearly.
- [ ] **OpenClaw ClawHub packaging** — Packages existing four skills plus balance skill into SKILL.md format. Achieves first-mover advantage on ClawHub for ZCash. Publish before send ships.

### Add After Validation (v1.2)

- [ ] **Shielded send (z-to-z)** — Highest complexity; requires Sapling proof generation in Rust. Build after persistence and balance are stable. Risk: proof generation may require significant additional librustzcash crates (`zcash_proofs`, `masp_primitives` or equivalent).
- [ ] **Memo field on send** — Add to shielded send implementation once the basic send works. One additional parameter; minimal extra complexity once the send pipeline exists.
- [ ] **Transaction pending/expiry tracking** — Polish feature. Add after send ships so there are actual pending transactions to track.

### Future Consideration (v2+)

- [ ] **Orchard pool support** — Wait for broader wallet ecosystem adoption and larger Orchard anonymity set. ZIP-224, different proving system.
- [ ] **Multi-account HD wallet** — Wait for demonstrated agent use case requiring multiple identities.
- [ ] **Hardware wallet PCZT support** — `zcash_client_backend` 0.13 mentions PCZT (Partially Created Zcash Transaction) for hardware wallets. Relevant if enterprise agents need offline signing.
- [ ] **LangChain tool adapter** — After OpenClaw packaging validates the skill format, adapt the same skills as LangChain tools. Different wrapper, same underlying functions.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Encrypted seed persistence | HIGH | MEDIUM | P1 |
| Balance checking | HIGH | MEDIUM | P1 |
| Viewing key generation | HIGH | LOW | P1 |
| OpenClaw ClawHub packaging | HIGH | MEDIUM | P1 |
| Shielded send | HIGH | HIGH | P2 |
| Memo field support | MEDIUM | MEDIUM | P2 |
| Transaction pending/expiry | MEDIUM | LOW | P2 |
| Orchard support | MEDIUM | HIGH | P3 |
| Multi-account HD wallet | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone (v1.1)
- P2: Ship when P1 is solid (v1.2)
- P3: Defer until product-market fit is established (v2+)

---

## Competitor Feature Analysis

| Feature | Coinbase AgentKit | BankrBot Skills | ETHSkills | ZCash Skills (ours) |
|---------|-------------------|-----------------|-----------|---------------------|
| Address generation | EVM/Solana | EVM (Base) | Docs only | Sapling shielded |
| Balance checking | EVM/Solana | EVM (Base) | None | Sapling shielded (planned) |
| Send transactions | EVM/Solana USDC/ETH | EVM (Base) | None | z-to-z shielded (planned) |
| Privacy / shielded | None | veil skill (EVM ZK) | None | Native ZCash protocol |
| Viewing keys | None | None | None | UFVK + UIVK (planned) |
| npm package | Yes | Yes | No | Yes (existing) |
| OpenClaw/ClawHub | Yes (agentic-wallet) | Yes (16 skills) | No | Planned (first ZCash) |
| Local key ops | No (CDP infrastructure) | No | N/A | Yes (native Rust) |
| Memo fields | None | None | None | Planned |

**Key gap we fill:** Zero privacy-coin skills exist on ClawHub. Zero npm ZCash packages with active maintenance exist. Coinbase and BankrBot are EVM-only. This is a clean first-mover position in a specific niche with ZCG grant backing.

---

## Implementation Complexity Notes

### Why Shielded Send Is HIGH complexity

Sending a Sapling shielded transaction requires:

1. **Note selection** — Choose which received notes to spend. Notes are discovered by scanning compact blocks. Must track note commitment tree position (note index) for each note.
2. **Merkle witness construction** — Prove each spent note exists in the note commitment tree. The witness is a Merkle path. It must be updated each time a new block extends the tree. `GetTreeState` returns the current Sapling tree state; the wallet must compute the witness from it.
3. **Sapling spend proof (zk-SNARK)** — Generate a zero-knowledge proof that: (a) you know the spending key for the note, (b) the nullifier is correctly computed, (c) the Merkle path is valid. This requires `zcash_proofs` crate (Sapling proving key, ~50 MB). This is additional native Rust code not currently in the module.
4. **Output note construction** — Create the output note (recipient address, amount, memo), generate the Sapling output proof.
5. **Transaction assembly and signing** — Assemble spends + outputs into a valid Sapling transaction, compute binding signature.
6. **Broadcast** — Call lightwalletd `SendTransaction` with the serialized raw transaction bytes.

The proving key download (~50 MB) and proof generation time (~1-3 seconds per spend) are user-facing concerns to document and set expectations around.

### Why Balance Checking Is MEDIUM complexity (not LOW)

For shielded notes, `GetTaddressBalance` does NOT work — it's transparent-only. Shielded balance requires:

1. Connect to lightwalletd gRPC
2. Call `GetLatestBlock` for chain tip
3. Call `GetBlockRange` to download compact blocks since wallet birthday
4. For each compact block, try to decrypt each output using the Sapling incoming viewing key from the UFVK
5. Track decrypted notes (amount, note commitment, position in tree)
6. Track nullifiers to detect spent notes
7. Sum unspent notes = balance

This is a full note-scanning pipeline. The `zcash_client_backend` crate implements this but it requires a data persistence layer (`WalletRead`/`WalletWrite` traits). Without using `zcash_client_backend`, it must be partially reimplemented. Consider using `zcash_client_backend` with an in-memory or SQLite backend to avoid reimplementing from scratch.

---

## Sources

- [ZCash Wallet Feature UX Checklist](https://zcash.readthedocs.io/en/latest/rtd_pages/ux_wallet_checklist.html) — HIGH confidence (official ZCash docs)
- [lightwalletd gRPC service.go](https://github.com/zcash/lightwalletd/blob/master/frontend/service.go) — HIGH confidence (official ZCash repo)
- [ZIP-316: Unified Addresses and Unified Viewing Keys](https://zips.z.cash/zip-0316) — HIGH confidence (official ZCash ZIP)
- [ZIP-32: Shielded Hierarchical Deterministic Wallets](https://zips.z.cash/zip-0032) — HIGH confidence (official ZCash ZIP)
- [zcash_client_backend crate docs](https://docs.rs/zcash_client_backend/latest/zcash_client_backend/) — HIGH confidence (official Rust docs)
- [ZCash Wallet Threat Model](https://zcash.readthedocs.io/en/latest/rtd_pages/wallet_threat_model.html) — HIGH confidence (official ZCash docs)
- [OpenClaw Skills documentation](https://docs.openclaw.ai/tools/skills) — MEDIUM confidence (official OpenClaw docs but platform is evolving)
- [ClawHub publishing guide](https://advenboost.com/en/clawhub/) — MEDIUM confidence (third-party guide, verified against OpenClaw docs)
- [Coinbase Agentic Wallet Skills](https://github.com/coinbase/agentic-wallet-skills) — HIGH confidence (official Coinbase repo, competitive reference)
- [BankrBot OpenClaw Skills](https://github.com/BankrBot/openclaw-skills) — HIGH confidence (official BankrBot repo, competitive reference)
- [Sapling Transaction Anatomy](https://electriccoin.co/blog/sapling-transaction-anatomy/) — MEDIUM confidence (ECC blog, pre-ODL)
- ZCash issue #1207 (Argon2id KDF) — MEDIUM confidence (GitHub issue, validated direction)

---

*Feature research for: ZCash SDK / AI agent skill package (npm + OpenClaw)*
*Researched: 2026-03-20*
