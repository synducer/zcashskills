# Architecture Research

**Domain:** ZCash light wallet SDK for AI agents (Node.js/Rust hybrid npm package)
**Researched:** 2026-03-20
**Confidence:** HIGH (protocol specs) / MEDIUM (Node.js integration patterns)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI Agent / App Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ OpenClaw     │  │ LangChain    │  │ Direct SDK   │               │
│  │ Skill        │  │ Tool         │  │ Consumer     │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
└─────────┼────────────────┼────────────────┼──────────────────────────┘
          │                │                │
┌─────────▼────────────────▼────────────────▼──────────────────────────┐
│                      Skills Layer (Node.js)                           │
│                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │  generate  │  │  validate  │  │  balance   │  │   send     │      │
│  │  -address  │  │  -address  │  │  -check    │  │  -payment  │      │
│  │  (exists)  │  │  (exists)  │  │  (new)     │  │  (new)     │      │
│  └─────┬──────┘  └────────────┘  └─────┬──────┘  └─────┬──────┘      │
│        │                               │               │             │
│  ┌────────────┐                  ┌────────────┐  ┌────────────┐      │
│  │  create-   │  ┌────────────┐  │  viewing   │  │  wallet-   │      │
│  │  payment   │  │  parse-    │  │  -keys     │  │  -persist  │      │
│  │  -uri      │  │  payment   │  │  (new)     │  │  (new)     │      │
│  │  (exists)  │  │  -uri      │  └─────┬──────┘  └─────┬──────┘      │
│  └─────┬──────┘  │  (exists)  │        │               │             │
└────────┼─────────┴────────────┴────────┼───────────────┼─────────────┘
         │                               │               │
┌────────▼───────────────────────────────▼───────────────▼─────────────┐
│                    Native Module Layer (Rust/Neon FFI)                │
│                                                                       │
│  ┌──────────────────────┐   ┌──────────────────────────────────────┐  │
│  │   Existing (lib.rs)  │   │         New Rust Functions           │  │
│  │  generateShielded    │   │  persistSeed / loadSeed              │  │
│  │  Address             │   │  deriveViewingKey (UFVK/UIVK)        │  │
│  │  validateAddress     │   │  buildSaplingTransaction             │  │
│  └──────────────────────┘   │  signAndEncode                       │  │
│                             └──────────────────────────────────────┘  │
│                                                                       │
│  librustzcash crates: zcash_keys, zcash_address, zcash_primitives,   │
│  zcash_client_backend, zcash_proofs, zip32                           │
└───────────────────────────────────────────────────────────────────────┘
         │                                               │
         │ Local filesystem                              │ gRPC
         │ (encrypted)                                   │
┌────────▼──────────────────┐             ┌─────────────▼────────────┐
│   Wallet Store (new)      │             │  lightwalletd Server     │
│                           │             │  (external, user-config) │
│  wallet.json              │             │                          │
│  {                        │             │  CompactTxStreamer gRPC:  │
│    encryptedSeed,         │             │  - GetLatestBlock        │
│    salt,                  │             │  - GetBlockRange         │
│    iv,                    │             │  - GetTreeState          │
│    createdAt,             │             │  - SendTransaction       │
│    network                │             │  - GetTaddressBalance    │
│  }                        │             │  - GetAddressUtxos       │
└───────────────────────────┘             └──────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Skills (JS) | Thin async wrappers; input validation; result normalization; `.meta` export | `skills/<name>/index.js` |
| Native Module (Rust) | All cryptographic operations; key derivation; transaction construction and signing | `native/src/lib.rs` via Neon FFI |
| Wallet Store | Encrypted-at-rest persistence of seed; passphrase-derived key wrapping | Local JSON file; AES-256-GCM via Node.js `crypto` |
| lightwalletd Client (JS) | gRPC connection to lightwalletd; block queries; balance; broadcast | `@grpc/grpc-js` + generated proto stubs |
| lib/native-loader.js | Prebuild resolution → source-build fallback; single require point | Already exists |
| lib/index.js | Skill registry; package entry point | Already exists |

## Recommended Project Structure

```
zcashskills/
├── skills/
│   ├── generate-address/      # exists — generates ephemeral address
│   │   └── index.js
│   ├── validate-address/      # exists
│   │   └── index.js
│   ├── create-payment-uri/    # exists
│   │   └── index.js
│   ├── parse-payment-uri/     # exists
│   │   └── index.js
│   ├── wallet-persist/        # NEW: save/load encrypted wallet
│   │   └── index.js
│   ├── balance-check/         # NEW: query lightwalletd balance
│   │   └── index.js
│   ├── send-payment/          # NEW: build + sign + broadcast z-to-z
│   │   └── index.js
│   └── viewing-keys/          # NEW: derive UFVK and UIVK
│       └── index.js
├── lib/
│   ├── native-loader.js       # exists — prebuild/source fallback
│   ├── index.js               # exists — skill registry (extend with new skills)
│   ├── constants.js           # exists
│   ├── utils.js               # exists
│   └── lightwalletd.js        # NEW: gRPC client factory + connection pool
├── native/
│   ├── src/
│   │   └── lib.rs             # exists — extend with new Rust functions
│   ├── Cargo.toml             # extend dependencies
│   └── build.rs               # exists
├── proto/                     # NEW: lightwalletd proto stubs (generated)
│   └── service_grpc_pb.js
│   └── service_pb.js
├── openclaw/                  # NEW: OpenClaw packaging
│   └── SKILL.md
│   └── manifest.json
├── prebuilds/                 # exists — cross-platform .node files
│   └── <platform>/zcash-native.node
├── examples/
│   ├── openclaw/zcash-agent.js
│   └── langchain/zcash-tools.js
└── package.json
```

### Structure Rationale

- **skills/**: Each skill is an isolated directory — matches existing pattern, makes OpenClaw packaging trivial (one skill = one dir)
- **lib/lightwalletd.js**: Isolates all network concerns from cryptographic concerns; skills never touch gRPC directly
- **native/src/lib.rs**: Single Rust file stays simple for now; split into modules only if >500 lines
- **proto/**: Generated stubs committed to repo so consumers don't need protoc; regenerate only on lightwalletd protocol version bumps
- **openclaw/**: Packaging artifacts live at repo root alongside skills, not buried inside npm

## Architectural Patterns

### Pattern 1: Key Derivation Chain (Offline, Local)

**What:** All key material flows in one direction: seed → USK → Sapling ESK → UFVK → UIVK → payment address. No key material ever leaves the process.

**When to use:** Any operation involving spend authority or viewing capability.

**Trade-offs:** Derivation is deterministic and reversible upward (child → parent) only with the parent key. Disclosing UIVK exposes all incoming payments but not spend capability.

**Flow:**
```
BIP-39 mnemonic (64 bytes entropy)
  ↓  ZIP-32 derivation path: m/32'/133'/0'
UnifiedSpendingKey (USK)        ← spend authority, never leaves Rust
  ↓  usk.to_unified_full_viewing_key()
UnifiedFullViewingKey (UFVK)    ← can view in + out; share for full audit
  ↓  ufvk.sapling().to_incoming_viewing_key()
SaplingIncomingViewingKey (IVK) ← can view in only; share for receive-only disclosure
  ↓  ivk.to_payment_address(diversifier_index)
Sapling Payment Address (zs1...) ← public, share freely
```

**Rust implementation note:** `zcash_keys::keys::UnifiedSpendingKey` → `to_unified_full_viewing_key()` method. `zcash_keys::keys::UnifiedFullViewingKey` for UFVK encoding (ZIP-316 bech32m format). (MEDIUM confidence — verify exact method names against current zcash_keys 0.12 docs.)

### Pattern 2: Seed Persistence — Encrypt-then-Store

**What:** The raw seed is never written to disk. A passphrase-derived key wraps the seed bytes before any I/O.

**When to use:** The `wallet-persist` skill and any code path that loads/saves wallet state.

**Trade-offs:** Passphrase is the only recovery mechanism — losing it = losing the wallet. No KMS dependency = simpler and more private.

**Flow:**
```
User passphrase
  ↓  scrypt/PBKDF2 (N=2^17, r=8, p=1, salt=random 32 bytes)
Derived key (32 bytes)
  ↓  AES-256-GCM encrypt(seed, derivedKey, iv=random 12 bytes)
Ciphertext + auth tag
  ↓  JSON serialize
wallet.json: { encryptedSeed, salt, iv, authTag, network, createdAt }
```

**Why AES-256-GCM:** Available in Node.js `crypto` stdlib with no extra dependencies; authenticated encryption prevents silent corruption.

**Why scrypt over PBKDF2:** scrypt is memory-hard, making brute-force attacks on the passphrase substantially more expensive. Node.js `crypto.scryptSync` is available natively.

### Pattern 3: lightwalletd gRPC — Stateless Request Pattern

**What:** Each skill that needs network data creates a short-lived gRPC call; no persistent subscription.

**When to use:** `balance-check` and `send-payment`. Block scanning is NOT in scope for v1 — balance is fetched via `GetTaddressBalance` against the shielded address (note: this only works for transparent; see Data Flow notes below).

**Trade-offs:** Avoids complexity of block scanning state machine, but limits balance accuracy to lightwalletd's indexed view. Full scanning (downloading and decrypting compact blocks) is the correct long-term approach but is a Phase 2+ concern.

**Connection pattern:**
```javascript
// lib/lightwalletd.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

function createClient(lightwalletdUrl) {
  const packageDef = protoLoader.loadSync('./proto/service.proto', { ... });
  const { cash: { z: { wallet: { sdk: { rpc } } } } } = grpc.loadPackageDefinition(packageDef);
  return new rpc.CompactTxStreamer(lightwalletdUrl, grpc.credentials.createSsl());
}
```

### Pattern 4: Skill Contract — Async Function with `.meta`

**What:** Each skill is an async function returning `{ success: boolean, ...data }`. Never throws — errors surface in the return object. A `.meta` property describes the skill for discovery.

**When to use:** Every skill, always.

**Trade-offs:** Predictable contract for AI agent frameworks; prevents uncaught rejections crashing agent loops.

```javascript
async function mySkill(params) {
  try {
    // ... work
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message, code: 'SKILL_ERROR' };
  }
}
mySkill.meta = { name: 'my-skill', description: '...', version: '1.0.0' };
module.exports = mySkill;
```

## Data Flow

### Key Generation + Persistence Flow (wallet-persist skill)

```
User: { passphrase, network }
  ↓
Native Rust: generate_seed() → raw 32-byte seed + derive USK → return { address, seed_hex }
  ↓
Node.js wallet-persist: scrypt(passphrase, salt) → encryptedSeed
  ↓
fs.writeFileSync(walletPath, JSON.stringify(walletJson))
  ↓
Return: { success: true, address, walletPath } ← seed never returned to caller
```

### Balance Check Flow (balance-check skill)

**Important:** lightwalletd's `GetTaddressBalance` works for transparent (t-addr) addresses. For shielded Sapling addresses, balance is determined by scanning compact blocks and decrypting notes — lightwalletd does not index shielded balances directly.

For v1, the practical path is one of:
1. **Trusted lightwalletd query:** Some lightwalletd deployments index shielded note counts but this is non-standard.
2. **Simplified note scanning:** Fetch recent compact blocks, decrypt with IVK in Rust, count unspent notes. This is the correct approach and what `zcash_client_backend` is designed for.

Recommended v1 approach: implement simplified note scanning in Rust using `zcash_client_backend`'s scanning primitives. This is more work but architecturally sound.

```
User: { lightwalletdUrl, viewingKey (IVK string) }
  ↓
lightwalletd: GetLatestBlock → tip height
  ↓
lightwalletd: GetBlockRange(tip - 100, tip) → stream CompactBlock
  ↓
Native Rust: scan_blocks(ivk, compact_blocks) → [DecryptedNote]
  ↓
Node.js: sum note values → balance in zatoshis
  ↓
Return: { success: true, balanceZatoshis, balanceZEC, blockHeight }
```

### Send Payment Flow (send-payment skill)

```
User: { lightwalletdUrl, walletPath, passphrase, recipientAddress, amountZatoshis, memo }
  ↓
Node.js wallet-persist: load + decrypt wallet → seed bytes (in memory only)
  ↓
lightwalletd: GetLatestBlock + GetTreeState → anchor height + commitment tree state
  ↓
lightwalletd: GetBlockRange → scan for unspent notes (same as balance scan)
  ↓
Native Rust: build_sapling_transaction(seed, network, recipient, amount, memo, anchor, notes)
             → using zcash_primitives::transaction::builder::Builder
             → using zcash_proofs for Sapling proof generation
             → returns raw_transaction bytes
  ↓
lightwalletd: SendTransaction(raw_transaction) → txid
  ↓
Return: { success: true, txid, amountZatoshis, recipientAddress }
  ↓
(seed bytes garbage collected — never persisted after this call)
```

### Viewing Key Derivation Flow (viewing-keys skill)

```
User: { walletPath, passphrase, keyType: 'full' | 'incoming' }
  ↓
Node.js wallet-persist: load + decrypt → seed bytes
  ↓
Native Rust: derive_viewing_key(seed, network, keyType)
  → UnifiedSpendingKey::from_seed()
  → usk.to_unified_full_viewing_key()       [for 'full']
  → ufvk.sapling().to_incoming_viewing_key() [for 'incoming']
  → encode to bech32m string (uivk1... / ufvk1...)
  ↓
Return: { success: true, viewingKey, keyType, network }
  ↓
(seed bytes garbage collected)
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| lightwalletd | gRPC via `@grpc/grpc-js` + proto stubs | User provides URL; package ships no default server — privacy by design |
| lightwalletd (public) | `mainnet.lightwalletd.com:9067` as documented default | Operated by ZF; can be overridden by user |
| lightwalletd (testnet) | `testnet.lightwalletd.com:9067` | ZF-operated testnet instance |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Skills ↔ Native Module | Synchronous Neon FFI call (wraps in async in JS) | Neon calls block the event loop; keep Rust functions fast or move to thread pool |
| Skills ↔ lightwalletd | Async gRPC via `lib/lightwalletd.js` factory | Never import grpc directly in skills |
| Skills ↔ Wallet Store | Sync fs read/write via `lib/wallet-store.js` | Wrap in try/catch; path is user-configurable |
| Native Module ↔ librustzcash | Rust crate dependencies; compiled into `.node` | No runtime linking; all bundled at build time |

## Anti-Patterns

### Anti-Pattern 1: Returning Seed Material to JavaScript

**What people do:** Return the raw seed or spending key bytes from the Rust FFI function back to the Node.js layer so JavaScript can "own" it.

**Why it's wrong:** The seed becomes a JavaScript string or Buffer, which is garbage-collected non-deterministically, may be logged, may be serialized, and is accessible to any code in the same process.

**Do this instead:** Keep seed bytes inside Rust for the duration of any cryptographic operation. Pass only the minimum output needed (the derived address string, the encoded viewing key string, the raw transaction bytes) back to JS. Zero-fill sensitive byte arrays in Rust before dropping.

### Anti-Pattern 2: Storing Plaintext Seed on Disk

**What people do:** Write `{ seed: "abc123...", address: "zs1..." }` to a JSON file without encryption as a "first step" that will be encrypted "later."

**Why it's wrong:** Plaintext seeds are immediately readable by any process with filesystem access. There is no safe "temporary" plaintext storage — once written unencrypted it may be in backups, logs, crash dumps.

**Do this instead:** Encrypt before first write, always. The persistence layer must never accept unencrypted seed bytes as a write target. Use the scrypt + AES-GCM pattern from Pattern 2 from day one.

### Anti-Pattern 3: Implementing Block Scanning in JavaScript

**What people do:** Fetch compact blocks as JSON/protobuf, parse them in JS, attempt to trial-decrypt notes using JS crypto libraries.

**Why it's wrong:** Sapling note decryption requires Jubjub elliptic curve operations not available in JS without WASM bundles. The cryptographic primitives exist in librustzcash; re-implementing them in JS introduces bugs and security surface.

**Do this instead:** Pass compact block bytes to Rust via FFI. Scanning is `native.scanCompactBlocks(ivkBytes, blocksBytes)` → returns decrypted note data as a JS-safe structure.

### Anti-Pattern 4: One lightwalletd Client Per Skill Call

**What people do:** Instantiate `new CompactTxStreamer(url, ...)` inside each individual skill function call.

**Why it's wrong:** gRPC channel setup is expensive (TLS handshake, HTTP/2 connection). Repeated creation causes latency spikes and potential connection exhaustion.

**Do this instead:** Use `lib/lightwalletd.js` as a factory that caches clients keyed by URL. Re-use the channel across calls within the same process lifetime.

### Anti-Pattern 5: Hard-Coding a lightwalletd URL

**What people do:** Put `mainnet.lightwalletd.com:9067` as a default inside skill code.

**Why it's wrong:** Forces all users through one operator's infrastructure. Contradicts the privacy-first value proposition. Users running their own Zebra node should be able to use their own lightwalletd.

**Do this instead:** Require the URL as a parameter. Document the ZF-operated default in README as an example only. Let users configure their own endpoint.

## Scaling Considerations

This is an npm SDK — "scaling" means concurrent users of the package, not server scaling.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single agent | Current architecture sufficient; synchronous Neon calls acceptable |
| Multiple concurrent agent calls | Neon synchronous calls block Node.js event loop; move long-running Rust operations (proof generation, block scanning) to Neon worker threads using `neon::types::Deferred` |
| High-frequency balance checks | Cache balance results with a short TTL (e.g., 30 seconds) in `lib/lightwalletd.js`; lightwalletd is rate-limited on public instances |
| Package distribution | Cross-platform prebuilds for linux-x64, darwin-x64, darwin-arm64, win32-x64 via CI; zcash_proofs Sapling parameters (~50MB) must be fetched at first use, not bundled |

### Scaling Priorities

1. **First bottleneck:** Sapling proof generation is CPU-intensive (~1-3 seconds). Move to Neon worker thread so the Node.js event loop remains responsive during `send-payment`.
2. **Second bottleneck:** Block scanning over large ranges. Implement progress callbacks via Neon channels so the agent can report status during long syncs.

## Suggested Build Order (Phase Dependencies)

```
Phase 1: Wallet Persistence (seed encrypt/decrypt)
  ↓ required by
Phase 2: Viewing Key Derivation (needs seed from persistence)
  ↓ required by
Phase 3: Balance Checking (needs IVK from viewing keys + lightwalletd)
  ↓ required by
Phase 4: Send Payment (needs seed + unspent notes from balance scan + lightwalletd)
  ↓ independent of above
Phase 5: OpenClaw Packaging (wraps skills 1-4 in skill format + SKILL.md)
```

Each phase can be tested independently before moving forward. Balance checking and viewing keys have a light dependency — you need the IVK to scan for balance, so derive the IVK in Phase 2 before Phase 3.

## Sources

- [librustzcash Architecture](https://zcash.readthedocs.io/en/master/rtd_pages/librustzcash_arch.html) — Crate responsibilities (HIGH confidence)
- [zcash_client_backend docs.rs](https://docs.rs/zcash_client_backend/latest/zcash_client_backend/) — Wallet framework traits and sync flow (HIGH confidence)
- [zcash/lightwallet-protocol service.proto](https://raw.githubusercontent.com/zcash/lightwallet-protocol/main/walletrpc/service.proto) — Complete gRPC method list (HIGH confidence)
- [ZIP-316: Unified Addresses and Unified Viewing Keys](https://zips.z.cash/zip-0316) — Key derivation hierarchy and types (HIGH confidence)
- [ZIP-32: Shielded HD Wallets](https://zips.z.cash/zip-0032) — Derivation path structure (HIGH confidence)
- [ZIP-310: Security Properties of Sapling Viewing Keys](https://zips.z.cash/zip-0310) — What each key type can see (HIGH confidence)
- [Zcash Wallet Architecture Issue #7](https://github.com/zcash/wallet/issues/7) — Official component boundary sketch (HIGH confidence)
- [lightwalletd README](https://github.com/zcash/lightwalletd) — gRPC server documentation (HIGH confidence)
- [Zcash Protocol Specification v2025.6.3](https://zips.z.cash/protocol/protocol.pdf) — Sapling transaction construction (HIGH confidence)
- [zcash_client_sqlite docs.rs](https://docs.rs/zcash_client_sqlite/0.4.0/zcash_client_sqlite/) — SQLite wallet storage pattern (MEDIUM confidence — we use custom persistence, not this crate)

---
*Architecture research for: ZCash light wallet SDK (Node.js/Rust hybrid)*
*Researched: 2026-03-20*
