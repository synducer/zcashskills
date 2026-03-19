# Phase 2: Viewing Keys - Research

**Researched:** 2026-03-20
**Domain:** ZCash key derivation — UIVK / UFVK extraction and ZIP-316 bech32m encoding via zcash_keys 0.12 + Neon FFI
**Confidence:** HIGH (API verified from librustzcash source and zcash_protocol docs.rs; test code reviewed)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIEW-01 | User can export Incoming Viewing Key (IVK) — privacy-safe default for auditors | `UnifiedSpendingKey::to_unified_full_viewing_key()` + `ufvk.to_unified_incoming_viewing_key()` + `uivk.encode(&params)` → `uivk1...` string. All from zcash_keys 0.12 already in Cargo.toml. |
| VIEW-02 | User can export Full Viewing Key (FVK) with explicit opt-in (exposes outgoing transaction graph) | `UnifiedSpendingKey::to_unified_full_viewing_key()` + `ufvk.encode(&params)` → `uview1...` string. Same derivation path as UFVK; JS enforces explicit opt-in gate. |
| VIEW-03 | User can export Unified Full Viewing Key (UFVK) encoded per ZIP-316 | Same Rust function as VIEW-02. `UnifiedFullViewingKey::encode(&Network::MainNetwork)` produces ZIP-316 bech32m `uview1...` string. VIEW-02 and VIEW-03 share one Rust call; JS distinguishes by keyType param. |
</phase_requirements>

---

## Summary

Phase 2 derives and exports two distinct key types from the already-persisted encrypted wallet seed: a Unified Incoming Viewing Key (UIVK, for VIEW-01) and a Unified Full Viewing Key (UFVK, for VIEW-02 + VIEW-03). Both types are already fully supported by `zcash_keys 0.12` which is in `native/Cargo.toml` — **no new Cargo dependencies are required** for this phase.

The derivation chain flows directly from Phase 1's existing `loadWallet` pattern: decrypt seed with passphrase → re-derive `UnifiedSpendingKey` → call `to_unified_full_viewing_key()` → branch to either `ufvk.encode(&params)` (FVK/UFVK) or `ufvk.to_unified_incoming_viewing_key()` then `uivk.encode(&params)` (IVK). All of this happens in Rust before any key material crosses the FFI boundary; the exported string is the only thing that reaches JavaScript.

The JS skill (`skills/viewing-keys/index.js`) follows the same pattern as `wallet-persist`: it owns filesystem I/O (reading the wallet JSON), calls the Rust FFI function with the decrypted seed inputs, and returns the encoded viewing key string. The explicit opt-in for FVK (VIEW-02) is a JS-layer gate — the Rust function accepts a `keyType` parameter and returns the corresponding string, but the JS wrapper requires an additional `confirm: true` flag before forwarding an FVK request.

**Primary recommendation:** Add one new Rust FFI function `derive_viewing_key(passphrase, encryptedSeed, salt, nonce, network, keyType)` that handles the full derive-and-encode chain internally. Export via Neon as `native.deriveViewingKey`. Wire into a new `skills/viewing-keys/index.js` skill following the established skill contract pattern.

---

## Standard Stack

### Core (no new dependencies)

| Library | Version | Purpose | Already in Cargo.toml |
|---------|---------|---------|----------------------|
| `zcash_keys` | 0.12.0 | `UnifiedSpendingKey`, `UnifiedFullViewingKey`, `UnifiedIncomingViewingKey` | YES — `features = ["sapling"]` |
| `zcash_protocol` | 0.7 | `Network::MainNetwork` / `Network::TestNetwork` as `Parameters` implementors for `.encode()` | YES |
| `argon2` | 0.5.3 | Re-derive encryption key from passphrase to decrypt seed | YES |
| `chacha20poly1305` | 0.10.1 | Decrypt seed ciphertext | YES |
| `hex` | 0.4 | Decode hex-encoded inputs from JS layer | YES |
| `neon` | 0.10.1 | Rust-to-Node FFI | YES |

### No New Dependencies

This phase requires zero new Cargo crates. All key types and encoding methods are already available in the installed `zcash_keys 0.12` crate.

**Installation:**
```bash
# No changes to Cargo.toml — existing dependencies cover everything
# After adding Rust function: rebuild only
cd native && cargo build --release
```

---

## Architecture Patterns

### Recommended New Files

```
zcashskills/
├── native/src/lib.rs          # MODIFY: add derive_viewing_key() Neon function
├── skills/
│   └── viewing-keys/
│       └── index.js           # CREATE: getIncomingViewingKey + getFullViewingKey skills
└── test/unit/
    └── viewing-keys.test.js   # CREATE: unit tests (jest.mock native-loader)
```

`lib/index.js` and `lib/constants.js` also modified to register the new skill.

### Pattern 1: Derive-and-Encode in a Single Rust FFI Function

**What:** One Rust function `derive_viewing_key` takes all wallet inputs (passphrase + encrypted blob fields + network + keyType) and returns the encoded key string. No intermediate key material is returned.

**When to use:** Any time a viewing key needs to be exported. Consolidating into one function minimizes the attack surface — JS never holds the decrypted seed.

**Rust function signature:**
```rust
// Source: zcash_keys::keys module, zcash_protocol::consensus::Network
fn derive_viewing_key(mut cx: FunctionContext) -> JsResult<JsString> {
    let passphrase: String    = cx.argument::<JsString>(0)?.value(&mut cx);
    let encrypted_seed_hex: String = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex: String      = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex: String     = cx.argument::<JsString>(3)?.value(&mut cx);
    let network_str: String   = cx.argument::<JsString>(4)?.value(&mut cx);
    let key_type: String      = cx.argument::<JsString>(5)?.value(&mut cx);
    // "incoming" -> encode as UIVK (uivk1...)
    // "full"     -> encode as UFVK (uview1...)
    ...
}
```

### Pattern 2: Key Derivation Chain (Verified from librustzcash source)

**Source:** `https://github.com/zcash/librustzcash/blob/main/zcash_keys/src/keys.rs`

```rust
use zcash_keys::keys::{UnifiedSpendingKey, UnifiedFullViewingKey, UnifiedIncomingViewingKey};
use zcash_protocol::consensus::Network;
use zip32::AccountId;

// Step 1: Re-derive USK from decrypted seed (same as loadWallet)
let usk = UnifiedSpendingKey::from_seed(&consensus_network, &seed, AccountId::ZERO)?;

// Step 2: Derive UFVK
let ufvk: UnifiedFullViewingKey = usk.to_unified_full_viewing_key();

// Step 3a: Encode UFVK (VIEW-02 + VIEW-03)
// Returns ZIP-316 bech32m string: "uview1..." (mainnet) or "uviewtest1..." (testnet)
// Source: zcash_keys tests/ufvk_round_trip — calls ufvk.encode(&MAIN_NETWORK)
let ufvk_string: String = ufvk.encode(&consensus_network);
// consensus_network is Network::MainNetwork or Network::TestNetwork
// Network implements Parameters (verified: docs.rs/zcash_protocol/latest/consensus/enum.Network.html)

// Step 3b: Encode UIVK (VIEW-01)
// Returns ZIP-316 bech32m string: "uivk1..." (mainnet) or "uivktest1..." (testnet)
// Source: zcash_keys tests/uivk_round_trip
let uivk: UnifiedIncomingViewingKey = ufvk.to_unified_incoming_viewing_key();
let uivk_string: String = uivk.encode(&consensus_network);
```

### Pattern 3: Neon Return Type — JsString Not JsObject

**What:** Unlike other functions that return rich objects, `derive_viewing_key` returns a single string (the encoded key). Use `JsString` directly.

**When to use:** When the Rust function's only output is a single string value. Simplifies the FFI surface.

```rust
// Return the encoded viewing key string directly
Ok(cx.string(&viewing_key_string))
```

The JS skill wraps this in the standard `{ success, viewingKey, keyType, network }` object.

### Pattern 4: JS Skill — Explicit Opt-In Gate for FVK

**What:** The JS skill `getFullViewingKey` requires an explicit confirmation parameter before calling the Rust FFI for FVK. This enforces the VIEW-02 "explicit opt-in" requirement at the API boundary.

```javascript
// skills/viewing-keys/index.js
async function getFullViewingKey({ passphrase, walletPath, confirm } = {}) {
    if (!confirm) {
        return {
            success: false,
            error: 'Full viewing key export requires explicit opt-in. Pass { confirm: true } to proceed.',
            code: 'FVK_CONFIRMATION_REQUIRED'
        };
    }
    // ... proceed to call native.deriveViewingKey(..., 'full')
}
```

### Pattern 5: Wallet File Loading (Reuse from wallet-persist)

The viewing-keys skill loads the wallet JSON the same way `loadWallet` does — read file, parse JSON, extract `{ encryptedSeed, salt, nonce, network }` fields, then pass to Rust. No new file format changes.

```javascript
const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const rustResult = native.deriveViewingKey(
    passphrase,
    walletJson.encryptedSeed,
    walletJson.salt,
    walletJson.nonce,
    walletJson.network,
    keyType  // 'incoming' or 'full'
);
```

### Anti-Patterns to Avoid

- **Returning the UFVK from Rust and encoding in JS:** UFVK bytes in JS represent sensitive key material. Encode to string inside Rust, return only the string.
- **Implementing two separate Rust functions for IVK vs FVK:** Both derive through the same UFVK intermediate. One function with a `keyType` branch is cleaner and reduces code duplication.
- **Calling `usk.sapling().to_full_viewing_key()` directly:** The recommended path is `usk.to_unified_full_viewing_key()` — this is the unified-aware path. The low-level sapling-only path bypasses the unified key infrastructure.
- **Using `encode_extended_full_viewing_key` from `zcash_keys::encoding`:** This encodes the old-style Sapling `ExtendedFullViewingKey` (not unified). For VIEW-03 (ZIP-316 UFVK), use `UnifiedFullViewingKey::encode(&params)` instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UFVK bech32m encoding | Custom bech32m encoder + F4Jumble | `UnifiedFullViewingKey::encode(&params)` | ZIP-316 requires F4Jumble obfuscation on top of bech32m; `zcash_keys` implements this correctly |
| UIVK bech32m encoding | Custom bech32m encoder | `UnifiedIncomingViewingKey::encode(&params)` | Same F4Jumble + bech32m requirement; getting this wrong produces invalid keys |
| IVK from sapling component | Manually extract `sapling::zip32::IncomingViewingKey` and encode | Use UIVK path: `ufvk.to_unified_incoming_viewing_key().encode()` | The UIVK is the modern unified representation; raw Sapling IVK encoding is the legacy path |
| Key type validation | Parse and validate bech32m output | Trust `zcash_keys` encode output — it's always valid if derivation succeeded | The encode method cannot produce invalid output given a valid UFVK |

**Key insight:** ZIP-316 bech32m encoding includes a mandatory F4Jumble step that most bech32 libraries don't implement. Any custom encoding will produce keys that fail to decode in standard wallets. Do not attempt this manually.

---

## Common Pitfalls

### Pitfall 1: Using Old-Style FVK Encoding Instead of UFVK

**What goes wrong:** `encode_extended_full_viewing_key(hrp, &extfvk)` from `zcash_keys::encoding` produces a `zxviews1...` (mainnet) Sapling-only legacy key — this is NOT a ZIP-316 UFVK and won't satisfy VIEW-03.

**Why it happens:** The `zcash_keys::encoding` module exists for backward compatibility. It looks like the right encoding function, but it produces the pre-unified format.

**How to avoid:** Always use `UnifiedFullViewingKey::encode(&params)` for ZIP-316 output. The method is on the `UnifiedFullViewingKey` struct itself, not in the `encoding` module.

**Warning signs:** Output starts with `zxviews1` (mainnet) or `zxviewtestsapling1` (testnet) — these are legacy Sapling FVK encodings, not UFVKs.

### Pitfall 2: Wrong Parameters Type for encode()

**What goes wrong:** Passing `NetworkType::Main` to `UnifiedFullViewingKey::encode()` — `NetworkType` does NOT implement `Parameters`. It's a different type.

**Why it happens:** `NetworkType` and `Network` are both in `zcash_protocol::consensus` and look similar. The test code for UIVK uses `NetworkType::Main` with the internal `render().encode()` path, not the public `encode()` method.

**How to avoid:** Use `Network::MainNetwork` or `Network::TestNetwork` (which implement `Parameters`) when calling `ufvk.encode(&params)` or `uivk.encode(&params)`. These are the same types already used in `load_wallet`'s network matching.

**Warning signs:** Compile error: "the trait `Parameters` is not implemented for `NetworkType`"

### Pitfall 3: Neon Error Handling — match + cx.throw_error (Not map_err + ?)

**What goes wrong:** Using `map_err(|e| cx.throw_error(...))?` causes a compile error in Neon 0.10.x.

**Why it happens:** `cx.throw_error` returns `JsResult<T>` (i.e., `Result<T, Throw>`), not `Throw` directly. The `?` operator cannot convert `Result<_, JsResult<_>>` to the expected type.

**How to avoid:** Use the established project pattern: `match expr { Ok(v) => v, Err(e) => return cx.throw_error(msg) }`. This is documented in 01-01-SUMMARY.md as a key decision.

**Warning signs:** Multiple compile errors about "From" trait not implemented for Throw or JsResult.

### Pitfall 4: Zeroing Key Material — entropy Vec<u8> vs Fixed Arrays

**What goes wrong:** `entropy.fill(0)` works on fixed arrays `[u8; 32]` but `Vec<u8>` (returned by `cipher.decrypt()`) doesn't have `.fill()` directly — must use `entropy.iter_mut().for_each(|b| *b = 0)` or convert.

**Why it happens:** `chacha20poly1305` decrypt returns `Vec<u8>`, not a fixed array. The zeroize pattern differs.

**How to avoid:** Assign decrypt result to `let mut entropy = cipher.decrypt(...)?;` then zero with `entropy.iter_mut().for_each(|b| *b = 0);` before any return path. This is the same pattern used in `load_wallet` (the `entropy` Vec is let go out of scope via standard drop — acceptable but explicit zeroing is better).

### Pitfall 5: UIVK sapling() Field Type

**What goes wrong:** Assuming `UnifiedIncomingViewingKey::sapling()` returns `Option<DiversifiableFullViewingKey>` (like `UnifiedFullViewingKey::sapling()` does). It does NOT.

**Why it happens:** The field types differ between UFVK and UIVK structs.

**How to avoid:** `UnifiedIncomingViewingKey::sapling()` returns `&Option<sapling::zip32::IncomingViewingKey>` — a different type. But for this phase we don't need to access the sapling component directly; we just call `uivk.encode(&params)` on the whole UIVK.

**Warning signs:** Type mismatch error when calling methods available on `DiversifiableFullViewingKey` on the sapling field of `UnifiedIncomingViewingKey`.

---

## Code Examples

Verified patterns from librustzcash source (https://github.com/zcash/librustzcash/blob/main/zcash_keys/src/keys.rs):

### Complete Rust FFI Function (derive_viewing_key)

```rust
use zcash_keys::keys::{UnifiedSpendingKey, UnifiedFullViewingKey};
use zcash_protocol::consensus::Network;
use zip32::AccountId;
use argon2::Argon2;
use chacha20poly1305::{XChaCha20Poly1305, XNonce, aead::{Aead, KeyInit}};

fn derive_viewing_key(mut cx: FunctionContext) -> JsResult<JsString> {
    let passphrase       = cx.argument::<JsString>(0)?.value(&mut cx);
    let enc_seed_hex     = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex         = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex        = cx.argument::<JsString>(3)?.value(&mut cx);
    let network_str      = cx.argument::<JsString>(4)?.value(&mut cx);
    let key_type         = cx.argument::<JsString>(5)?.value(&mut cx);

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Decode hex inputs (same as load_wallet)
    let ciphertext = match hex::decode(&enc_seed_hex) {
        Ok(v) => v,
        Err(e) => return cx.throw_error(format!("Invalid encryptedSeed hex: {}", e)),
    };
    let salt = match hex::decode(&salt_hex) {
        Ok(v) => v,
        Err(e) => return cx.throw_error(format!("Invalid salt hex: {}", e)),
    };
    let nonce_bytes = match hex::decode(&nonce_hex) {
        Ok(v) => v,
        Err(e) => return cx.throw_error(format!("Invalid nonce hex: {}", e)),
    };

    // Re-derive decryption key from passphrase
    let mut key = [0u8; 32];
    if let Err(e) = Argon2::default().hash_password_into(passphrase.as_bytes(), &salt, &mut key) {
        return cx.throw_error(format!("KDF error: {}", e));
    }

    // Decrypt seed
    let cipher = match XChaCha20Poly1305::new_from_slice(&key) {
        Ok(c) => c,
        Err(_) => { key.fill(0); return cx.throw_error("Invalid key length"); }
    };
    let nonce = XNonce::from_slice(&nonce_bytes);
    let entropy = match cipher.decrypt(nonce, ciphertext.as_ref()) {
        Ok(p) => p,
        Err(_) => { key.fill(0); return cx.throw_error("Decryption failed — wrong passphrase"); }
    };
    key.fill(0);

    // Derive USK from entropy
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(k) => k,
        Err(e) => return cx.throw_error(format!("Key derivation failed: {:?}", e)),
    };

    // Derive UFVK
    // Source: UnifiedSpendingKey::to_unified_full_viewing_key() — verified in zcash_keys/src/keys.rs
    let ufvk: UnifiedFullViewingKey = usk.to_unified_full_viewing_key();

    // Encode to ZIP-316 bech32m string based on key type
    // Source: zcash_keys test ufvk_round_trip — ufvk.encode(&MAIN_NETWORK)
    //         zcash_keys test uivk_round_trip — uivk.encode(&NetworkType::Main) via render()
    let encoded = match key_type.as_str() {
        "full" => ufvk.encode(&consensus_network),          // "uview1..." (mainnet)
        "incoming" => ufvk.to_unified_incoming_viewing_key().encode(&consensus_network), // "uivk1..."
        _ => return cx.throw_error("Invalid keyType: use 'incoming' or 'full'"),
    };

    Ok(cx.string(&encoded))
}
```

### Neon Export Registration (in main fn)

```rust
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("generateShieldedAddress", generate_shielded_address)?;
    cx.export_function("validateAddress", validate_address)?;
    cx.export_function("createWallet", create_wallet)?;
    cx.export_function("loadWallet", load_wallet)?;
    cx.export_function("deriveViewingKey", derive_viewing_key)?;  // NEW
    Ok(())
}
```

### JS Skill Structure (skills/viewing-keys/index.js)

```javascript
// Skills follow the established contract: async fn returning { success, ...data }
async function getIncomingViewingKey({ passphrase, walletPath = DEFAULT_WALLET_PATH } = {}) {
    try {
        const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        // Validate required fields before calling Rust
        const viewingKey = native.deriveViewingKey(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            'incoming'
        );
        return { success: true, viewingKey, keyType: 'incoming', network: walletJson.network };
    } catch (err) {
        return { success: false, error: err.message, code: 'IVK_ERROR' };
    }
}

async function getFullViewingKey({ passphrase, walletPath = DEFAULT_WALLET_PATH, confirm } = {}) {
    if (!confirm) {
        return {
            success: false,
            error: 'Full viewing key export exposes outgoing transaction graph. Pass { confirm: true } to proceed.',
            code: 'FVK_CONFIRMATION_REQUIRED'
        };
    }
    try {
        const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        const viewingKey = native.deriveViewingKey(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            'full'
        );
        return { success: true, viewingKey, keyType: 'full', network: walletJson.network };
    } catch (err) {
        return { success: false, error: err.message, code: 'FVK_ERROR' };
    }
}
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Sapling `ExtendedFullViewingKey` encoded as `zxviews1...` | `UnifiedFullViewingKey` encoded as `uview1...` per ZIP-316 | ZIP-316 unified keys are the current standard; legacy format still technically works but non-unified |
| Separate sapling IVK encoded as bech32 Sapling key | `UnifiedIncomingViewingKey` encoded as `uivk1...` | Unified format supports multiple pools; use even for Sapling-only wallets |
| `sapling.DiversifiableFullViewingKey` direct access | `usk.to_unified_full_viewing_key()` path | Unified path is pool-agnostic; works for future Orchard addition |

**Still valid (not deprecated):**
- `zcash_keys::encoding::encode_extended_full_viewing_key` — exists but produces legacy non-unified Sapling FVK; do not use for ZIP-316 requirement.

---

## Open Questions

1. **UIVK encode() vs render().encode() discrepancy**
   - What we know: `UnifiedFullViewingKey::encode(&params)` takes `&P: Parameters`. The internal UIVK round-trip test uses `uivk.render().encode(&NetworkType::Main)` where `render()` is private. The public API `UnifiedIncomingViewingKey::encode(&params)` (taking `Parameters`) is the correct public method.
   - What's unclear: Whether `uivk.encode(&Network::MainNetwork)` compiles cleanly or if there's a subtlety with the public API vs the internal render path.
   - Recommendation: Write a minimal test `cargo test` case to confirm `uivk.encode(&Network::MainNetwork)` compiles. If it fails, fall back to `uivk.encode(&params.network_type())` pattern after checking trait bounds.

2. **Prebuilt binary update after adding deriveViewingKey**
   - What we know: From 01-02-SUMMARY.md, the stale prebuilt at `prebuilds/darwin-arm64/zcash-native.node` must be manually updated when new functions are added.
   - What's unclear: The CI/release process for updating prebuilts is not yet established.
   - Recommendation: Plan task explicitly states to copy `native/index.node` to `prebuilds/darwin-arm64/zcash-native.node` after `cargo build --release`.

3. **VIEW-02 vs VIEW-03 interpretation**
   - What we know: Both VIEW-02 (FVK) and VIEW-03 (UFVK per ZIP-316) map to `UnifiedFullViewingKey::encode()` producing `uview1...`. They differ by user intent, not by key type.
   - What's unclear: Whether the requirements intend these to be the same exported key or different encodings.
   - Recommendation: Implement as one Rust call with `keyType='full'`. The JS skill `getFullViewingKey` satisfies both VIEW-02 (via the `confirm: true` gate) and VIEW-03 (via ZIP-316 bech32m output). Document in skill metadata that both requirements are met by this single function.

---

## Sources

### Primary (HIGH confidence)

- `https://github.com/zcash/librustzcash/blob/main/zcash_keys/src/keys.rs` — `UnifiedSpendingKey::to_unified_full_viewing_key()`, `UnifiedFullViewingKey::encode(&params)` signatures; UFVK round-trip test showing `ufvk.encode(&MAIN_NETWORK)`; UIVK round-trip test; `UnifiedIncomingViewingKey::sapling()` returns `&Option<sapling::zip32::IncomingViewingKey>`
- `https://docs.rs/zcash_protocol/latest/zcash_protocol/consensus/enum.Network.html` — Network enum implements Parameters trait; MAIN_NETWORK constant exists
- `https://github.com/zcash/librustzcash/blob/main/zcash_keys/src/encoding.rs` — `encode_extended_full_viewing_key` exists (legacy path); UFVK uses `UnifiedFullViewingKey::encode()` not this module
- `https://docs.rs/zcash_keys/0.11.0/zcash_keys/keys/struct.UnifiedFullViewingKey.html` — `encode<P: Parameters>(&self, params: &P) -> String`; `sapling() -> Option<&DiversifiableFullViewingKey>`; `decode<P: Parameters>(params: &P, encoding: &str) -> Result<Self, String>`
- `https://zips.z.cash/zip-0316` — ZIP-316 UFVK encoding prefix `uview1` (mainnet), `uivk1` (mainnet); F4Jumble obfuscation requirement

### Secondary (MEDIUM confidence)

- `https://zips.z.cash/zip-0310` — IVK security properties: exposes incoming only; FVK exposes outgoing transaction graph via OVK
- `https://docs.rs/zcash_keys/0.11.0/zcash_keys/encoding/index.html` — Encoding module functions confirmed for legacy path; no UFVK encoding in this module

### Tertiary (LOW confidence)

- WebFetch summaries of raw GitHub source — method existence confirmed but exact line numbers not verified independently

---

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps): HIGH — all required types are in `zcash_keys 0.12` which is already in Cargo.toml
- Key derivation chain: HIGH — `to_unified_full_viewing_key()`, `to_unified_incoming_viewing_key()`, `.encode(&params)` all verified from source
- Encode signatures and network types: HIGH — verified Network implements Parameters; encode takes `&P: Parameters` returning String
- ZIP-316 output prefixes (`uview1`, `uivk1`): HIGH — confirmed from ZIP-316 spec and zcash_keys test vectors
- Neon patterns: HIGH — established and verified in Phase 1
- UIVK public encode() vs internal render() path: MEDIUM — public API exists but not tested in project yet; flag as Open Question 1

**Research date:** 2026-03-20
**Valid until:** 2026-06-20 (zcash_keys ecosystem moves slowly; STACK.md already noted 0.12 is a maintenance release)
