# Phase 3: Balance and Sync - Research

**Researched:** 2026-03-20
**Domain:** ZCash compact block scanning, lightwalletd gRPC, Sapling note decryption, shielded balance
**Confidence:** MEDIUM-HIGH (scan_block API: HIGH via direct source read; tokio bridge: HIGH via official docs; zecscope-scanner: MEDIUM via lib.rs; lightwalletd gRPC: HIGH via official proto)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SYNC-01 | User can query shielded balance via lightwalletd compact block scanning (note decryption in Rust using IVK) | Option B approach: JS fetches compact blocks via gRPC, passes protobuf bytes to Rust scan_block function which decrypts with UFVK |
| SYNC-02 | Balance display shows both total and spendable amounts | Sapling note decryption returns note values; confirmed notes from birthday to tip are total; spendable requires nullifier check (notes without matching spend nullifier). Simplification: v1 reports confirmed balance only with note that all confirmed == spendable for new wallets |
| SYNC-03 | User can view transaction history with memos | WalletSaplingOutput from scan_block contains note data; memo is in the full decrypted note (requires full note decryption, not compact-only) |
</phase_requirements>

---

## Summary

This is the most architecturally complex phase because shielded balance has no lightwalletd RPC — lightwalletd only provides `GetTaddressBalance` for transparent addresses. Shielded balance **must** be computed by downloading compact blocks and decrypting notes with the wallet's incoming viewing key (IVK). No shortcut exists.

The critical architectural question is: where does the gRPC network I/O happen (Rust or JavaScript), and does this require tokio in Rust? Research reveals that `zcash_client_backend`'s `scan_block` function is **purely synchronous and CPU-bound** — it accepts already-downloaded `CompactBlock` structs and requires no async runtime. This enables a clean split: JavaScript fetches compact blocks via `@grpc/grpc-js` (which it already handles async natively), encodes them as `Buffer` objects, and passes them to a synchronous Neon Rust function that decodes protobuf and runs `scan_block`. This eliminates tokio from Rust entirely and is the recommended approach.

**Option B (direct scan_block) with Option D's JS gRPC architecture** is the recommended approach. It avoids zcash_client_sqlite, avoids tokio in Rust, avoids the full WalletRead/WalletWrite trait hierarchy, and works within the existing neon 0.10 synchronous FFI model. A helper crate `zecscope-scanner` 0.1.0 exists that wraps scan_block more simply and is version-compatible with our existing dependencies — it may reduce implementation complexity further.

**Primary recommendation:** Use `@grpc/grpc-js` in JavaScript to fetch compact blocks as protobuf bytes, serialize as `Buffer` array, pass to a new synchronous Neon function `scanBlocks(ufvkString, compactBlocksBuffer)` that uses `zcash_client_backend::scanning::scan_block` (no tokio, no sqlite needed).

---

## Four Options Evaluated

### Option A: Full zcash_client_backend + zcash_client_sqlite

**What it is:** Use the official WalletRead/WalletWrite/BlockSource trait hierarchy with SQLite storage.

**Crates needed:**
- `zcash_client_backend 0.21` with `sync` + `lightwalletd-tonic` features
- `zcash_client_sqlite 0.19`
- `tonic 0.14.5`
- `tokio 1.x`

**Verdict: TOO HEAVY for this phase.** Reasons:
- Requires implementing WalletWrite/WalletRead/WalletCommitmentTrees traits — massive API surface
- Brings in tokio, tonic, SQLite, rusqlite as compile dependencies
- Creates a permanent SQLite database per wallet — conflicts with the project's file-based wallet model
- Total build time estimated at 8-12 minutes (first clean build), 250+ transitive crates
- The sync state machine (`sync` feature) targets wallets doing incremental sync — overkill for a balance query
- Confirmed/spendable balance distinction requires maintaining nullifier sets in SQLite — significant extra state

**Use when:** You need a production wallet with incremental sync, reorg handling, multi-account support. Not for this project.

---

### Option B: Direct scan_block (Recommended Core)

**What it is:** Use only `zcash_client_backend::scanning::scan_block` directly, without any storage layer.

**Confirmed via source reading:**
- `scan_block` signature: `fn scan_block<P, AccountId, IvkTag>(params, block: CompactBlock, scanning_keys, nullifiers, prior_block_metadata) -> Result<ScannedBlock<AccountId>, ScanError>`
- `scan_block` is **synchronous** — no async, no tokio required
- The scanning module has **no feature flag guard** — available with any zcash_client_backend addition
- `ScanningKeys::from_account_ufvks` accepts `impl IntoIterator<Item = (AccountId, UnifiedFullViewingKey)>`
- `ScannedBlock` gives access to `WalletTx` items, each with `sapling_outputs() -> &[WalletSaplingOutput<AccountId>]`
- `WalletSaplingOutput.note().value()` returns `Zatoshis`

**Crates needed (only new additions):**
- `zcash_client_backend 0.21` (no features needed, defaults include scanning)
- `prost 0.11` (for CompactBlock protobuf decoding — already used by zcash_client_backend internally)

**What it does NOT need:** tokio, tonic, zcash_client_sqlite, rusqlite, SQLite

**Key limitation:** No memo access via compact block scanning. Compact blocks contain only 52 bytes of ciphertext — enough for note detection but not full memo. To get memos, use `GetTransaction` RPC and full note decryption (separate scope).

**Verdict: RECOMMENDED CORE** — use scan_block directly, feed it already-decoded CompactBlock structs.

---

### Option C: GetTaddressBalance + Manual Tracking

**What it is:** Use lightwalletd's `GetTaddressBalance` RPC for transparent balance and add some shielded tracking.

**Verdict: NON-VIABLE.** `GetTaddressBalance` only works for transparent (t-addr) addresses. There is no equivalent lightwalletd RPC for shielded (Sapling/Orchard) balances. The proto file confirmed: only `GetTaddressBalance` and `GetAddressUtxos` exist, both for transparent only. Shielded balance requires block scanning.

---

### Option D: JS gRPC + Rust Decryption (Recommended Architecture)

**What it is:** JavaScript handles the async gRPC streaming (what it's already good at), Rust handles the cryptographic decryption (what it must do).

**Flow:**
```
JS: @grpc/grpc-js connects to lightwalletd
JS: GetLatestBlock → tip height
JS: GetBlockRange(birthday_height, tip) → stream of CompactBlock protobuf messages
JS: collect serialized protobuf bytes for each block into Buffer array
Rust (Neon sync): scanBlocks(ufvkStr, blocksAsBytes) → sum note values
JS: return { confirmedBalance, blockHeight }
```

**Why this is better than Option A's "gRPC in Rust":**
- No tokio needed in Rust (eliminates major complexity)
- No new Cargo deps for networking (saves ~15 compile crates)
- @grpc/grpc-js is already a natural fit for streaming in Node.js
- Neon 0.10 is synchronous — bridging tokio adds `Runtime::new().block_on()` boilerplate and blocks the event loop anyway
- ChainSafe research confirms: passing bytes from JS to Rust is a known, working pattern

**Why this works technically:**
- CompactBlock implements `prost::Message`, so raw protobuf bytes decode to `CompactBlock` via `CompactBlock::decode(buf)?`
- `zcash_client_backend::proto::compact_formats::CompactBlock` already has this decode impl
- Neon 0.10 `JsBuffer::as_slice()` gives `&[u8]` from a Node.js Buffer argument
- For passing multiple blocks: accept a `JsArray` of `JsBuffer`, or concatenate with length-prefixing

**Verdict: RECOMMENDED ARCHITECTURE** — combine with Option B core.

---

### Option E: zecscope-scanner Crate (Simplification Layer)

**What it is:** A third-party crate (`zecscope-scanner 0.1.0`) that wraps `scan_block` with a higher-level API.

**Compatibility:** Verified version-compatible with our exact deps:
- `zcash_client_backend 0.21.0` ✓
- `zcash_keys 0.12.0` ✓
- `zcash_protocol 0.7` ✓
- `zip32 0.2` ✓

**API:**
```rust
let scanner = Scanner::new(Network::Mainnet);
let request = ScanRequest {
    viewing_key: "uview1...".to_string(),  // UFVK string
    key_id: "wallet".to_string(),
    compact_blocks: blocks,  // Vec<CompactBlock>
};
let summary = scanner.scan(&request)?;  // ScanSummary with ZecTransaction items
```

**Verdict: LOWER PRIORITY OPTION** — assess during planning. Using scan_block directly (Option B) is more auditable for a security-critical wallet SDK. zecscope-scanner is maintained by one person (Dec 2025), not ECC/ZF. Prefer direct use of the official crate unless the scanner significantly reduces implementation. Flag as alternative if implementation complexity is higher than expected.

---

## Standard Stack

### Core (new additions for Phase 3)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zcash_client_backend` | `0.21` (no new features) | `scan_block`, `ScanningKeys`, `CompactBlock` proto types | Official librustzcash scanning API; scan_block is synchronous, no tokio |
| `@grpc/grpc-js` | `^1.9.0` | lightwalletd gRPC client in Node.js | Official Google gRPC for Node.js; native gRPC (not gRPC-web); async streaming native |
| `@grpc/proto-loader` | `^0.7.0` | Load .proto file at runtime | Paired with @grpc/grpc-js; avoids protoc codegen step |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `prost` | bundled with zcash_client_backend | Protobuf decode in Rust | Already a transitive dep; use `CompactBlock::decode()` |
| `serde_json` | `1.x` | Serialize scan results across FFI | For returning structured transaction data to JS |

### What NOT to Add

| Avoid | Why |
|-------|-----|
| `tonic` | Only needed if Rust does gRPC; our architecture does gRPC in JS |
| `tokio` | Only needed for async Rust; scan_block is sync |
| `zcash_client_sqlite` | Full WalletRead/WalletWrite implementation not needed for scan-only |
| `rusqlite` | No SQLite persistence needed for v1 balance scan |

### NPM Installation

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

### Cargo.toml Addition

```toml
[dependencies]
# Add to existing deps — no features needed for scan_block
zcash_client_backend = { version = "0.21" }
serde_json = "1"
```

Note: `zcash_client_backend` transitively brings `prost` — do not add prost directly to avoid version conflicts.

---

## Architecture Patterns

### Recommended Structure

```
zcashskills/
├── skills/
│   └── balance-check/
│       └── index.js          # NEW: lightwalletd + scanBlocks + balance aggregation
├── lib/
│   └── lightwalletd.js       # NEW: gRPC client factory, GetBlockRange streaming
├── proto/
│   ├── service.proto         # Copy from lightwallet-protocol repo (commit to git)
│   └── compact_formats.proto # Copy from lightwallet-protocol repo (commit to git)
└── native/src/lib.rs         # Add scanBlocks Rust function
```

### Pattern 1: JS gRPC Stream → Rust Scan

**What:** Node.js fetches compact blocks as serialized protobuf bytes, Rust decodes and scans them.

**gRPC streaming in JS:**
```javascript
// lib/lightwalletd.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

function createClient(lightwalletdUrl) {
  const packageDef = protoLoader.loadSync(
    path.join(__dirname, '../proto/service.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
      includeDirs: [path.join(__dirname, '../proto')] }
  );
  const { cash: { z: { wallet: { sdk: { rpc } } } } } = grpc.loadPackageDefinition(packageDef);
  return new rpc.CompactTxStreamer(lightwalletdUrl, grpc.credentials.createSsl());
}

async function getLatestBlockHeight(client) {
  return new Promise((resolve, reject) => {
    client.getLatestBlock({}, (err, blockId) => {
      if (err) return reject(err);
      resolve(Number(blockId.height));
    });
  });
}

async function fetchCompactBlocksAsBytes(client, startHeight, endHeight) {
  return new Promise((resolve, reject) => {
    const blocks = [];
    const call = client.getBlockRange({
      start: { height: startHeight },
      end: { height: endHeight }
    });
    call.on('data', (compactBlock) => {
      // @grpc/grpc-js returns deserialized JS objects by default
      // We need the raw bytes — use the proto serialize method
      // OR configure the client to return raw buffers
      blocks.push(compactBlock);
    });
    call.on('end', () => resolve(blocks));
    call.on('error', reject);
  });
}
```

**Important note on protobuf bytes:** `@grpc/grpc-js` with `protoLoader` deserializes CompactBlock into a JS object by default. To pass raw protobuf bytes to Rust, serialize back using `root.lookupType('CompactBlock').encode(block).finish()`. Alternatively, configure proto-loader to not decode: use a custom codec or read the raw binary frame.

**Recommended approach:** Use proto-loader to get the CompactBlock type descriptor, then call `.encode(block).finish()` (returns `Buffer`) for each received block. Pass the array of Buffers to Rust.

**Rust scan function:**
```rust
// native/src/lib.rs — add scanBlocks
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_client_backend::scanning::{ScanningKeys, Nullifiers, scan_block};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{Network, BlockHeight};
use prost::Message;
use zip32::AccountId;

fn scan_blocks(mut cx: FunctionContext) -> JsResult<JsObject> {
    let ufvk_str     = cx.argument::<JsString>(0)?.value(&mut cx);
    let network_str  = cx.argument::<JsString>(1)?.value(&mut cx);
    let blocks_arg   = cx.argument::<JsArray>(2)?;  // Array of Buffers

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network"),
    };

    // Decode UFVK from ZIP-316 string
    let ufvk = match UnifiedFullViewingKey::decode(&consensus_network, &ufvk_str) {
        Ok(k) => k,
        Err(e) => return cx.throw_error(format!("Invalid UFVK: {}", e)),
    };

    // Build ScanningKeys from UFVK
    let scanning_keys = ScanningKeys::from_account_ufvks(
        vec![(AccountId::ZERO, ufvk)]
    );
    let nullifiers = Nullifiers::empty();

    // Process each compact block buffer
    let len = blocks_arg.len(&mut cx);
    let mut total_zatoshis: u64 = 0;
    let mut transactions: Vec<serde_json::Value> = Vec::new();
    let mut prior_metadata = None;

    for i in 0..len {
        let buf: Handle<JsBuffer> = blocks_arg.get(&mut cx, i)?;
        let bytes = buf.as_slice(&cx);

        let compact_block = match CompactBlock::decode(bytes) {
            Ok(b) => b,
            Err(e) => return cx.throw_error(format!("Block decode error: {}", e)),
        };

        let block_height = compact_block.height;

        let scanned = match scan_block(
            &consensus_network,
            compact_block,
            &scanning_keys,
            &nullifiers,
            prior_metadata.as_ref(),
        ) {
            Ok(s) => s,
            Err(e) => return cx.throw_error(format!("Scan error: {:?}", e)),
        };

        // Aggregate note values from received sapling outputs
        for wtx in scanned.transactions() {
            for output in wtx.sapling_outputs() {
                // output.transfer_type() distinguishes Received vs. Sent
                // For incoming notes, sum the zatoshi value
                let value = u64::from(output.note().value());
                total_zatoshis += value;
                transactions.push(serde_json::json!({
                    "txid": hex::encode(wtx.txid().as_ref()),
                    "blockHeight": block_height,
                    "valueZatoshis": value,
                }));
            }
        }

        // Store prior block metadata for continuity checks
        // prior_metadata = Some(scanned.to_block_metadata());
    }

    let result = cx.empty_object();
    let js_balance = cx.string(total_zatoshis.to_string());
    result.set(&mut cx, "confirmedZatoshis", js_balance)?;
    let js_txns = cx.string(serde_json::to_string(&transactions).unwrap_or_default());
    result.set(&mut cx, "transactionsJson", js_txns)?;
    Ok(result)
}
```

**Important API details to verify during implementation:**
- `scanned.transactions()` — exact method name (may be `wallet_txs()` or similar; check current API)
- `output.note().value()` → how to convert to u64 (Zatoshis type)
- `output.transfer_type()` or `output.is_received()` — which outputs are incoming vs. change
- `prior_block_metadata` — whether `BlockMetadata` can be derived from `ScannedBlock`

### Pattern 2: Balance Skill Flow

```javascript
// skills/balance-check/index.js
const native = require('../../lib/native-loader');
const { createClient, getLatestBlockHeight, fetchCompactBlocksBytes } = require('../../lib/lightwalletd');

async function checkBalance({ lightwalletdUrl, walletPath, passphrase, network }) {
  try {
    // Load wallet to get viewing key
    const walletData = JSON.parse(fs.readFileSync(walletPath));
    const ufvk = native.deriveViewingKey(
      passphrase, walletData.encryptedSeed, walletData.salt,
      walletData.nonce, network, 'full'
    );

    const client = createClient(lightwalletdUrl);
    const tipHeight = await getLatestBlockHeight(client);
    const birthdayHeight = walletData.birthdayHeight || tipHeight - 100;

    // Fetch compact blocks as protobuf Buffer array
    const blockBuffers = await fetchCompactBlocksBytes(client, birthdayHeight, tipHeight);

    // Scan in Rust — synchronous, no tokio
    const result = native.scanBlocks(ufvk, network, blockBuffers);
    const confirmedZatoshis = BigInt(result.confirmedZatoshis);

    return {
      success: true,
      confirmedZatoshis: confirmedZatoshis.toString(),
      confirmedZEC: (Number(confirmedZatoshis) / 1e8).toFixed(8),
      spendableZatoshis: confirmedZatoshis.toString(),  // v1: all confirmed = spendable
      spendableZEC: (Number(confirmedZatoshis) / 1e8).toFixed(8),
      blockHeight: tipHeight,
      scannedBlocks: blockBuffers.length,
    };
  } catch (err) {
    return { success: false, error: err.message, code: 'BALANCE_ERROR' };
  }
}
```

### Pattern 3: Protobuf Serialization — JS to Rust

The key challenge is getting raw protobuf bytes from `@grpc/grpc-js` (which deserializes by default) back to bytes for Rust. Two approaches:

**Approach 3a (Recommended): Re-serialize with protobufjs**

```javascript
const protobuf = require('protobufjs');
// Load proto to get type descriptor
const root = await protobuf.load(path.join(__dirname, '../proto/compact_formats.proto'));
const CompactBlock = root.lookupType('cash.z.wallet.sdk.rpc.CompactBlock');

call.on('data', (block) => {
  const encoded = CompactBlock.encode(block).finish();  // returns Buffer
  blockBuffers.push(encoded);
});
```

**Approach 3b: Use raw binary gRPC messages**

Configure `@grpc/grpc-js` with a custom codec to receive raw binary frames. More complex, avoids the double-parse overhead, but less straightforward.

**Recommendation:** Use Approach 3a with `protobufjs` (which is already a dependency of `@grpc/proto-loader`). This is clean and well-tested.

### Anti-Patterns to Avoid

- **Anti-pattern: Running scan_block in JS with Sapling crypto.** Sapling trial decryption requires Jubjub curve operations — not available in pure JS. All note decryption must happen inside Rust.
- **Anti-pattern: Adding tokio to Rust for gRPC.** scan_block is sync; tokio adds 3-5 minutes of compile time and runtime complexity.
- **Anti-pattern: Scanning from genesis.** Always scan from `walletData.birthdayHeight` — scanning from block 0 requires downloading ~2.7M blocks.
- **Anti-pattern: Treating UIVK string as UFVK.** `UnifiedFullViewingKey::decode()` expects UFVK (uview1...) — use keyType='full' from deriveViewingKey.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sapling note trial decryption | Custom Jubjub math in JS | `scan_block` in zcash_client_backend | Sapling encryption uses Jubjub scalar multiplication — no pure JS library implements it correctly; wrong decryption silently fails to detect notes |
| Protobuf definitions for lightwalletd | Write .proto from scratch | Copy from `github.com/zcash/lightwallet-protocol` | Canonical; commit to repo; regenerate only on protocol version bump |
| Nullifier tracking for spend detection | Custom nullifier set | scan_block's `Nullifiers` type | Nullifier derivation requires full viewing key and correct Sapling commitment tree position |
| Balance from multiple notes | Manual note accumulation | Aggregate WalletSaplingOutput.note().value() results | Off-by-one on zatoshi conversion is catastrophic |

**Key insight:** The Sapling trial decryption algorithm is the core complexity. Every Sapling output must be trial-decrypted against the wallet's IVK — this is an elliptic curve operation that MUST happen in Rust via librustzcash. There is no shortcut.

---

## Common Pitfalls

### Pitfall 1: No Shielded Balance RPC Exists

**What goes wrong:** Developer looks for a lightwalletd RPC to get shielded balance directly (like GetTaddressBalance). Does not exist. Builds wrong architecture.

**Why it happens:** The proto file shows GetTaddressBalance, which sounds like it should have a shielded equivalent. It does not. Lightwalletd is intentionally privacy-preserving — the server does not index shielded balances because doing so would require decrypting notes.

**How to avoid:** Confirmed via proto inspection: `GetTaddressBalance` only accepts transparent address lists. Shielded balance requires downloading blocks and decrypting with IVK.

**Warning signs:** Any code that passes a `zs1...` address to `GetTaddressBalance` will get 0 back silently.

**Confidence:** HIGH — verified from lightwallet-protocol/walletrpc/service.proto directly.

---

### Pitfall 2: scan_block's ScannedBlock Method Names May Differ from Expected

**What goes wrong:** Developer assumes `scanned_block.wallet_txs()` or `scanned_block.transactions()` based on the WalletTx type name. The actual method name needs verification.

**Why it happens:** zcash_client_backend API evolves rapidly. The scanning module's ScannedBlock type was substantially restructured in 0.12-0.14. We confirmed `scan_block` is the right function but could not read the exact ScannedBlock method names from GitHub due to symlink issues.

**How to avoid:** During implementation, check the actual zcash_client_backend 0.21 docs.rs page for `ScannedBlock` method names before writing the scan loop. Use `cargo doc --open` locally once the dep is added.

**Confidence:** MEDIUM — scan_block existence HIGH; ScannedBlock exact API MEDIUM.

---

### Pitfall 3: Double-Counting Change Outputs

**What goes wrong:** When a wallet sends a payment, the change output is returned to the wallet. If we count all sapling_outputs naively, we count both the received note AND the change from any send we made. This is only relevant if the wallet has sent payments.

**Why it happens:** scan_block returns all outputs decryptable by the IVK, including change outputs from sends. Without nullifier tracking, we cannot distinguish spent notes from unspent ones.

**How to avoid for v1:** Since Phase 3 wallets are receive-only (Phase 4 adds send), this is safe to defer. Document clearly: v1 balance = all confirmed received notes (change outputs from sends not yet applicable). Add TODO for Phase 4 to implement nullifier tracking.

**Confidence:** HIGH — this is a known property of IVK-based scanning.

---

### Pitfall 4: UFVK vs UIVK for Scanning

**What goes wrong:** `ScanningKeys::from_account_ufvks` requires a `UnifiedFullViewingKey` — not a `UnifiedIncomingViewingKey`. Using the UIVK string (uivk1...) with the UFVK decode function will fail.

**Why it happens:** Both are ZIP-316 bech32m strings, easy to confuse. Our deriveViewingKey function returns either based on keyType parameter.

**How to avoid:** Always call `native.deriveViewingKey(..., 'full')` in the balance-check skill to get the UFVK (uview1...), then pass it to scanBlocks. The UFVK contains the IVK internally — scan_block can extract it.

**Confirmed API:** `UnifiedFullViewingKey::decode(&network, &ufvk_str)` is the correct Rust decode path.

**Confidence:** HIGH — verified from zcash_client_backend source.

---

### Pitfall 5: Large Block Ranges Blocking the JS Event Loop

**What goes wrong:** Fetching 10,000+ blocks synchronously before calling Rust blocks the Node.js event loop during the stream. Then calling synchronous Rust (which scans CPU-intensively) blocks it further.

**Why it happens:** scan_block is synchronous; Neon 0.10 is synchronous; streaming gRPC naturally buffers.

**How to avoid for v1:**
- New wallets have birthday height near tip — typically <100 blocks to scan. v1 performance is acceptable.
- Document: scanning >100,000 blocks will block the event loop for 10-60 seconds. SYNC-04 (incremental sync with height persistence) in v2 resolves this.
- For v1, add a block count limit (e.g., warn if >10,000 blocks, fail if >100,000).

**Confidence:** HIGH — this is a known property of Neon 0.10 synchronous execution.

---

### Pitfall 6: protobuf bytes Serialization Mismatch

**What goes wrong:** @grpc/grpc-js deserializes CompactBlock into a JS object. Re-serializing with protobufjs may produce different byte layouts if field names differ (due to keepCase options). Rust's prost::Message::decode then fails.

**Why it happens:** Proto3 field names have both camelCase (JSON) and snake_case (wire format) variants. The proto-loader `keepCase` option matters.

**How to avoid:** Use `keepCase: false` (default) in proto-loader for consistency. When re-serializing, use the same protobufjs `root` loaded from the same .proto file. Test with a known block height and verify decode succeeds in Rust before scanning logic.

**Confidence:** MEDIUM — this is a known protobuf serialization gotcha.

---

### Pitfall 7: Birthday Height Not Stored in Wallet File

**What goes wrong:** The wallet file from Phase 1/2 stores `birthdayHeight` from a SAPLING_ACTIVATION defaults constant (noted as a 2026 estimate in STATE.md). This will cause incorrect scan ranges.

**Why it happens:** Phase 1-02 notes: "SAPLING_ACTIVATION defaults are conservative 2026 estimates; Phase 3 replaces with live lightwalletd chain-tip." The wallet file format exists but the birthday height value may be a placeholder.

**How to avoid:** In Phase 3, when loading the wallet for balance check, also query lightwalletd's `GetLatestBlock` to get the current tip. If `birthdayHeight` in wallet is 0 or unrealistic, fall back to `tipHeight - 100` for a fresh wallet. Then update the wallet file with the correct birthday from lightwalletd.

**Confidence:** HIGH — flagged explicitly in STATE.md.

---

## Code Examples

### Example 1: Rust scan_block with UFVK (verified API)

```rust
// Source: zcash_client_backend/src/scanning.rs (read directly)
use zcash_client_backend::scanning::{ScanningKeys, Nullifiers, scan_block};
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::Network;
use zip32::AccountId;
use prost::Message;

// Build scanning keys from UFVK
let scanning_keys = ScanningKeys::from_account_ufvks(
    vec![(AccountId::ZERO, ufvk)]
);

// No spent notes to track yet (Phase 3 is receive-only)
let nullifiers = Nullifiers::empty();

// Decode protobuf bytes → CompactBlock
let compact_block = CompactBlock::decode(raw_bytes)?;

// Scan — purely synchronous, no async/tokio
let scanned = scan_block(
    &Network::MainNetwork,
    compact_block,
    &scanning_keys,
    &nullifiers,
    None,  // prior_block_metadata; None is safe for first block
)?;
```

### Example 2: lightwalletd gRPC in Node.js (proto-loader)

```javascript
// lib/lightwalletd.js
// Source: grpc.io/docs/languages/node/basics + lightwallet-protocol/walletrpc/service.proto
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '../proto/service.proto');

function createLightwalletdClient(url) {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(__dirname, '../proto')]
  });
  const proto = grpc.loadPackageDefinition(packageDef);
  const { CompactTxStreamer } = proto.cash.z.wallet.sdk.rpc;
  return new CompactTxStreamer(url, grpc.credentials.createSsl());
}

function getLatestBlock(client) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    client.getLatestBlock({}, { deadline }, (err, result) => {
      if (err) return reject(err);
      resolve(Number(result.height));
    });
  });
}

function fetchBlocksAsProtoBytes(client, startHeight, endHeight) {
  // Returns Promise<Buffer[]> — raw protobuf bytes per block
  return new Promise((resolve, reject) => {
    const buffers = [];
    const deadline = Date.now() + 120_000;  // 2-min timeout
    const call = client.getBlockRange(
      { start: { height: String(startHeight) }, end: { height: String(endHeight) } },
      { deadline }
    );
    call.on('data', (block) => {
      // @grpc/grpc-js gives us a JS object; re-encode to protobuf bytes
      // protobufjs is available (it's a dep of @grpc/proto-loader)
      // OR: configure a custom deserializer to get raw bytes
      // Simple approach: use the _message_bytes if available, else re-encode
      buffers.push(block);  // Collect objects, encode in batch
    });
    call.on('end', () => resolve(buffers));
    call.on('error', reject);
  });
}
```

### Example 3: Proto files to commit

Commit both proto files from the canonical source:
- `https://raw.githubusercontent.com/zcash/lightwallet-protocol/main/walletrpc/service.proto`
- `https://raw.githubusercontent.com/zcash/lightwallet-protocol/main/walletrpc/compact_formats.proto`

Put them in `proto/` at repo root. Reference with `includeDirs` in protoLoader.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ZecWallet gRPC endpoints | Community operators (zec.rocks:443, others) | ~2023 | No single official mainnet endpoint; make URL configurable |
| Scanning all blocks from genesis | Scan from wallet birthday height | Always recommended, but easy to miss | Scanning 2.7M blocks vs. <100 for new wallet |
| zcash_client_sqlite as required storage | scan_block usable standalone (no storage) | zcash_client_backend 0.12+ | Can implement v1 balance without SQLite |
| gRPC in Rust (tonic) | gRPC in JS (@grpc/grpc-js) then pass bytes to Rust | Our v1 decision | Avoids tokio in Rust, simpler Neon integration |

**Current lightwalletd endpoints (MEDIUM confidence — community maintained):**

| Network | Endpoint | Port | TLS |
|---------|----------|------|-----|
| Mainnet | `zec.rocks` | 443 | Yes |
| Testnet | `testnet.lightwalletd.com` | 443 | Yes |
| Local dev | `127.0.0.1` | 9067 | No |

Make configurable via parameter (never hardcode). Document zec.rocks as example only.

---

## Open Questions

1. **Exact ScannedBlock transaction accessor method name**
   - What we know: `scan_block` returns `ScannedBlock<AccountId>`, which contains `WalletTx` items
   - What's unclear: The exact method name — `transactions()`, `wallet_txs()`, or similar. Could not read this from source due to GitHub symlink issues.
   - Recommendation: Run `cargo doc --open` locally after adding zcash_client_backend to Cargo.toml. Check the ScannedBlock struct page. Expect it to be either `transactions()` or `wallet_txs()`.

2. **How to re-encode CompactBlock JS objects to bytes**
   - What we know: @grpc/grpc-js deserializes to JS object; prost::Message can decode bytes in Rust
   - What's unclear: Cleanest way to get raw proto bytes from @grpc/grpc-js without round-tripping through JS object
   - Recommendation: Use `protobufjs` (already a transitive dep of @grpc/proto-loader) to re-encode. Alternatively, investigate `@grpc/grpc-js` raw frame mode. Test with a real block to verify prost decode succeeds in Rust.

3. **Memo decryption (SYNC-03)**
   - What we know: Compact blocks contain only 52 bytes of ciphertext — insufficient for memo (memos can be up to 512 bytes in Sapling)
   - What's unclear: Whether `GetTransaction` RPC provides full transaction including memo ciphertext, and whether zcash_client_backend has a `decrypt_transaction` function that works offline
   - Recommendation: Plan memo retrieval as a separate step: after identifying received transactions via compact block scan, call `GetTransaction(txid)` for each received tx, then decrypt the full note including memo in Rust. Scope as optional in Phase 3 plan; can be a separate task.

4. **Confirmed vs Spendable distinction (SYNC-02)**
   - What we know: Requirements ask for separate confirmed and spendable amounts
   - What's unclear: For a receive-only wallet (no sends), all confirmed notes are spendable. Strict "spendable" requires nullifier-set tracking to exclude spent notes.
   - Recommendation: v1 implementation — `confirmedZatoshis == spendableZatoshis` for Phase 3. Phase 4 (send) will add nullifier tracking. Document explicitly in skill output.

---

## Sources

### Primary (HIGH confidence)
- `github.com/zcash/lightwallet-protocol/walletrpc/service.proto` — All CompactTxStreamer RPCs; confirmed no shielded balance endpoint
- `github.com/zcash/lightwallet-protocol/walletrpc/compact_formats.proto` — CompactBlock, CompactTx, CompactSaplingOutput field definitions
- `github.com/zcash/librustzcash/zcash_client_backend/src/scanning.rs` — scan_block signature, ScanningKeys::from_account_ufvks, synchronous nature confirmed
- `github.com/zcash/librustzcash/zcash_client_backend/Cargo.toml` — Feature flags; scanning module has no feature gate
- `docs.rs/zcash_client_backend/0.14.0/scanning` — scan_block arguments, return type
- `tokio.rs/tokio/topics/bridging` — Runtime::new().block_on() pattern for sync FFI
- `docs.rs/neon/0.10.1/neon/types/struct.JsBuffer.html` — as_slice() for reading bytes in Neon 0.10

### Secondary (MEDIUM confidence)
- `lib.rs/crates/zecscope-scanner` — zecscope-scanner 0.1.0 confirmed version-compatible with our deps (Dec 2025)
- `research.chainsafe.io` — ChainSafe finding: JS gRPC + Rust decryption pattern is validated approach
- `grpc.io/docs/languages/node/basics/` — @grpc/grpc-js server streaming pattern

### Tertiary (LOW confidence)
- Community forum discussions on lightwalletd endpoints (zec.rocks, testnet) — may change; verify before use
- `hhanh00.github.io/zcash-sync` — warp-sync alternative approach; useful background

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — scan_block API verified from source; @grpc/grpc-js documented
- Architecture: HIGH — JS gRPC + sync Rust pattern is sound; confirmed ChainSafe validated it
- Pitfalls: HIGH for structural pitfalls; MEDIUM for ScannedBlock API specifics (exact method names not fully verified)
- zecscope-scanner viability: MEDIUM — version-compatible confirmed; single maintainer, assess during planning

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (zcash_client_backend API evolves; verify ScannedBlock methods before planning)

---

## Implementation Guidance for Planner

### Recommended Phase 3 Plan Structure

**Plan 1: Rust scan_blocks function**
- Add `zcash_client_backend = "0.21"` and `serde_json = "1"` to native/Cargo.toml
- Add `scanBlocks(ufvkStr, networkStr, blockBuffers)` Neon function to lib.rs
- Input: UFVK string + array of JsBuffers (one per compact block, protobuf-encoded)
- Output: `{ confirmedZatoshis: string, transactionsJson: string }`
- Verify cargo build succeeds; check ScannedBlock API via `cargo doc`
- Unit test with a known compact block fixture

**Plan 2: lightwalletd gRPC client + balance-check skill**
- Copy `service.proto` and `compact_formats.proto` to `proto/` directory
- Implement `lib/lightwalletd.js` with createClient, getLatestBlock, fetchBlocksAsProtoBytes
- Install `@grpc/grpc-js` and `@grpc/proto-loader`
- Implement `skills/balance-check/index.js` with the full flow
- Integration test: connect to testnet lightwalletd, scan recent blocks, verify balance response structure

**Plan 3: Transaction history and memo retrieval (if SYNC-03 required in this phase)**
- For each txid found via scan, call GetTransaction RPC
- Implement `decryptTransaction(fullTxBytes, ufvkStr, networkStr)` Rust function
- Extract memo from decrypted note
- Append memo data to transaction history output

### Key Implementation Invariants

- UFVK string (uview1...) used for scanning — NOT UIVK (uivk1...)
- All note decryption happens in Rust (scan_block) — JS never touches cipher operations
- Birthday height read from wallet file; fall back to tip - 100 if missing/invalid
- Block range limited to avoid massive scans: v1 warn at >10,000 blocks
- URL passed as parameter — no hardcoded lightwalletd endpoint
- All zatoshi values as strings in JS (avoid Number precision loss on u64)
