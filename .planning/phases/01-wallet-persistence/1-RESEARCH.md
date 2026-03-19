# Phase 1: Wallet Persistence - Research

**Researched:** 2026-03-20
**Domain:** Rust seed encryption (Argon2id + XChaCha20-Poly1305), BIP-39 mnemonic generation, wallet file persistence, Neon 0.10 FFI boundary design
**Confidence:** HIGH (encryption APIs verified via official docs); MEDIUM (BIP-39 / zcash_keys seed size interaction — official source read but cross-linking inferred)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WALL-01 | User can create a new wallet with encrypted seed persistence (Argon2id KDF + XChaCha20-Poly1305 AEAD, seed encrypted inside Rust before crossing FFI boundary) | Argon2id `hash_password_into` API + XChaCha20Poly1305 encrypt/decrypt verified at docs.rs; FFI boundary design documented in Architecture Patterns |
| WALL-02 | User can load/unlock an existing wallet file with passphrase decryption | Same encryption stack as WALL-01 (symmetric encrypt/decrypt); wallet file format with all needed fields documented |
| WALL-03 | Wallet stores birthday block height at creation time for efficient chain scanning | Birthday height stored in wallet JSON alongside encrypted seed; no lightwalletd query needed for Phase 1 (use a hardcoded safe default or skip — see Open Questions) |
| WALL-04 | User can generate BIP-39 24-word mnemonic backup phrase for seed recovery | bip39 crate `Mnemonic::from_entropy()` with 32 bytes = 24 words; `to_seed("")` produces 64-byte seed passed to `UnifiedSpendingKey::from_seed` |
</phase_requirements>

---

## Summary

Phase 1 implements the cryptographic foundation that all subsequent phases depend on. The core problem is: generate a BIP-39 mnemonic, derive a ZCash wallet from it, encrypt the raw entropy with Argon2id + XChaCha20-Poly1305, persist to disk, and later decrypt and re-derive on unlock. Critically, the raw seed must never cross the FFI boundary as plaintext — all encryption happens inside Rust before any data is returned to JavaScript.

The existing `native/src/lib.rs` already demonstrates the correct derivation path (`OsRng` → 32-byte seed → `UnifiedSpendingKey::from_seed` → Sapling address) but discards the seed. Phase 1 extends this with: (1) BIP-39 mnemonic wrapping of the entropy, (2) Argon2id key derivation from a user passphrase, (3) XChaCha20-Poly1305 authenticated encryption of the entropy, (4) JSON wallet file write/read, and (5) a new `createWallet` / `loadWallet` export on the Neon module. The `wallet-persist` skill is a thin JS wrapper that calls these Rust functions and handles filesystem I/O.

The two critical invariants this phase must enforce: (a) `UnifiedSpendingKey` is never serialized — only the 32-byte entropy is persisted, and USK is re-derived at runtime on every unlock; (b) the JS layer never holds the raw entropy — it receives only the encrypted blob, the derived address, and the mnemonic string, and the mnemonic string itself is only returned once at creation time.

**Primary recommendation:** Add `bip39`, `argon2`, and `chacha20poly1305` crates to `native/Cargo.toml`; implement `create_wallet` and `load_wallet` as Neon functions in `lib.rs` that handle all crypto internally; wrap in `skills/wallet-persist/index.js`; write wallet JSON via Node.js `fs` (not from Rust) after receiving the encrypted blob.

---

## Standard Stack

### Core Rust Crates (add to `native/Cargo.toml`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bip39` | `2.0.0` | Generate 24-word mnemonic from 32-byte entropy; convert mnemonic back to seed | Official Rust BIP-39 crate; `from_entropy(32 bytes)` = 24 words; `to_seed("")` = 64-byte BIP-39 seed; supports `zeroize` feature for secure memory clearing |
| `argon2` | `0.5.3` | Derive 32-byte encryption key from user passphrase | OWASP-recommended memory-hard KDF; `Argon2::default()` uses Argon2id v19 with m=19456 KiB, t=2, p=1 — matches OWASP minimum; `hash_password_into(password, salt, &mut [u8; 32])` gives raw key bytes |
| `chacha20poly1305` | `0.10.1` | Encrypt the 32-byte entropy with authenticated encryption | XChaCha20Poly1305 variant uses 24-byte nonce (eliminates nonce reuse risk); 256-bit key; authenticated (integrity protected); pure Rust, no C deps; already in Cargo.lock transitively |

**These three crates are already in the Cargo dependency tree or planned in STACK.md. No new Cargo.toml additions beyond what STACK.md documents for this phase.**

### Existing Crates (already present, already used)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `zcash_keys` | `0.12.0` | `UnifiedSpendingKey::from_seed` for address derivation | Already in `Cargo.toml`; `from_seed(&[u8])` accepts minimum 32 bytes — the 32-byte raw entropy works directly |
| `rand` | `0.8` | `OsRng` for cryptographically random salt and nonce generation | Already in `Cargo.toml` |
| `neon` | `0.10.1` | FFI bridge between Rust and Node.js | Already in `Cargo.toml`; stay on 0.10.x for this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bip39` 2.x `from_entropy` | Custom entropy-to-mnemonic implementation | Never hand-roll BIP-39; checksum bits are subtle; use the crate |
| `argon2` `hash_password_into` | Node.js `crypto.scryptSync` in JS layer | Rejected: seed must be encrypted INSIDE Rust before returning to JS — using Node.js crypto means the unencrypted entropy must cross FFI first, violating the security invariant |
| `XChaCha20Poly1305` | `AES-256-GCM` | XChaCha20 chosen because it is safe in pure software on all platforms (including ARM Macs without hardware AES); 24-byte nonce removes nonce-reuse risk; AES-GCM requires hardware for constant-time safety |
| Passing 64-byte BIP-39 seed to `from_seed` | Passing 32-byte entropy to `from_seed` | Either works (`from_seed` accepts `&[u8]` with minimum 32 bytes). **Recommended: store 32-byte entropy, pass it directly to `from_seed`.** This avoids re-running BIP-39 PBKDF2 on every unlock (the 64-byte BIP-39 seed is the result of PBKDF2; re-deriving it each time is extra work). |

**Installation (update `native/Cargo.toml`):**
```toml
bip39 = { version = "2.0.0", features = ["zeroize"] }
argon2 = "0.5.3"
chacha20poly1305 = "0.10.1"
```

Then rebuild:
```bash
cd native && cargo build --release
```

---

## Architecture Patterns

### Recommended File Structure for Phase 1

```
zcashskills/
├── native/
│   ├── src/
│   │   └── lib.rs               # Add create_wallet + load_wallet Neon functions
│   └── Cargo.toml               # Add bip39, argon2, chacha20poly1305
├── skills/
│   └── wallet-persist/          # NEW
│       └── index.js             # JS skill: calls Rust, writes/reads wallet JSON
├── lib/
│   └── index.js                 # Add walletPersist to skill registry
└── test/
    └── unit/
        └── wallet-persist.test.js  # Unit tests for the skill
```

### Pattern 1: All Crypto Inside Rust — JS Only Does File I/O

**What:** The Neon function `create_wallet` takes `(passphrase: string, network: string)` and returns `{ encryptedSeed: string (hex), salt: string (hex), nonce: string (hex), address: string, mnemonic: string }`. The JS skill receives this object and writes the wallet JSON to disk. The Rust function does: random entropy → mnemonic → encrypt entropy → derive address. It does NOT write to disk.

**When to use:** Any operation involving seed material. Never put crypto in JS.

**Why the split:** Rust handles crypto secrets (which it can zero after use), Node.js handles filesystem paths (which are user-configurable and outside Rust's concern).

**Rust function signature:**
```rust
// native/src/lib.rs
fn create_wallet(mut cx: FunctionContext) -> JsResult<JsObject> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(1)?.value(&mut cx);
    // ... all crypto happens here, returns encrypted blob + address + mnemonic
}

fn load_wallet(mut cx: FunctionContext) -> JsResult<JsObject> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let encrypted_seed_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex = cx.argument::<JsString(3)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(4)?.value(&mut cx);
    // ... decrypt entropy, derive address, return { address, network }
    // seed bytes are zeroed before the function returns
}
```

### Pattern 2: Crypto Implementation Flow (Inside Rust `create_wallet`)

```
Step 1: Generate 32 bytes random entropy
  let mut entropy = [0u8; 32];
  OsRng.fill_bytes(&mut entropy);

Step 2: Generate BIP-39 mnemonic (24 words)
  use bip39::Mnemonic;
  let mnemonic = Mnemonic::from_entropy(&entropy)  // 32 bytes → 24 words
    .map_err(|e| cx.throw_error(format!("BIP39 error: {}", e)))?;
  let mnemonic_phrase = mnemonic.to_string();

Step 3: Derive ZCash address (from entropy directly — NOT from 64-byte BIP-39 seed)
  let consensus_network = ...;
  let usk = UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO)
    .map_err(|e| cx.throw_error(format!("Key derivation failed: {:?}", e)))?;
  let sapling_esk = usk.sapling();
  let (_, payment_address) = sapling_esk.default_address();
  let address_string = ZcashAddress::from_sapling(addr_network, payment_address.to_bytes()).encode();

Step 4: Generate random salt (32 bytes) for Argon2id KDF
  let mut salt = [0u8; 32];
  OsRng.fill_bytes(&mut salt);

Step 5: Derive 32-byte encryption key from passphrase via Argon2id
  use argon2::Argon2;
  let mut key = [0u8; 32];
  Argon2::default().hash_password_into(passphrase.as_bytes(), &salt, &mut key)
    .map_err(|e| cx.throw_error(format!("KDF failed: {}", e)))?;

Step 6: Encrypt entropy with XChaCha20-Poly1305
  use chacha20poly1305::{XChaCha20Poly1305, XNonce, KeyInit, aead::Aead};
  let cipher = XChaCha20Poly1305::new_from_slice(&key)
    .map_err(|_| cx.throw_error("Invalid key length"))?;
  let mut nonce_bytes = [0u8; 24];
  OsRng.fill_bytes(&mut nonce_bytes);
  let nonce = XNonce::from_slice(&nonce_bytes);
  let ciphertext = cipher.encrypt(nonce, entropy.as_ref())
    .map_err(|_| cx.throw_error("Encryption failed"))?;

Step 7: Zero sensitive bytes before returning
  key.fill(0);
  entropy.fill(0);

Step 8: Return hex-encoded blob to JS
  { encryptedSeed: hex(ciphertext), salt: hex(salt), nonce: hex(nonce_bytes),
    address: address_string, mnemonic: mnemonic_phrase }
```

### Pattern 3: Wallet JSON File Format

The JS skill writes this file. The format stores everything needed for re-derivation:

```json
{
  "version": 1,
  "network": "mainnet",
  "encryptedSeed": "<hex of ciphertext including 16-byte auth tag>",
  "salt": "<hex of 32-byte Argon2id salt>",
  "nonce": "<hex of 24-byte XChaCha20 nonce>",
  "kdf": {
    "algorithm": "argon2id",
    "version": 19,
    "m_cost": 19456,
    "t_cost": 2,
    "p_cost": 1
  },
  "cipher": "xchacha20poly1305",
  "address": "zs1...",
  "birthdayHeight": 2750000,
  "createdAt": "2026-03-20T00:00:00.000Z"
}
```

**File location:** `~/.zcashskills/wallet.json` (default); overridable via `walletPath` parameter.
**File permissions:** `0o600` — set via `fs.chmodSync(path, 0o600)` immediately after write.
**Birthday height:** Use a hardcoded safe default for Phase 1 (the Sapling activation height on mainnet is 419200; use a recent conservative value). Full lightwalletd query for live birthday height is out of scope for Phase 1 (no lightwalletd dependency yet).

### Pattern 4: JS Skill Contract (wallet-persist/index.js)

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');

const DEFAULT_WALLET_PATH = path.join(os.homedir(), '.zcashskills', 'wallet.json');

// WALL-03: hardcoded safe birthday heights (before any wallet this tool would create)
const SAPLING_ACTIVATION = { mainnet: 419200, testnet: 280000 };

async function createWallet({ passphrase, network = 'mainnet', walletPath = DEFAULT_WALLET_PATH } = {}) {
    try {
        // Input validation
        if (!passphrase || passphrase.length < 8) {
            throw new Error('Passphrase must be at least 8 characters');
        }
        // Call Rust — all crypto happens here
        const result = native.createWallet(passphrase, network);
        // Write wallet JSON to disk
        const walletDir = path.dirname(walletPath);
        fs.mkdirSync(walletDir, { recursive: true });
        const walletJson = {
            version: 1, network, address: result.address,
            encryptedSeed: result.encryptedSeed, salt: result.salt, nonce: result.nonce,
            kdf: { algorithm: 'argon2id', version: 19, m_cost: 19456, t_cost: 2, p_cost: 1 },
            cipher: 'xchacha20poly1305',
            birthdayHeight: SAPLING_ACTIVATION[network] || SAPLING_ACTIVATION.mainnet,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(walletPath, JSON.stringify(walletJson, null, 2));
        fs.chmodSync(walletPath, 0o600);
        return {
            success: true, address: result.address,
            mnemonic: result.mnemonic,   // ONLY returned here — never again
            walletPath, network,
            birthdayHeight: walletJson.birthdayHeight,
            message: 'Wallet created. Write down your mnemonic — it will not be shown again.'
        };
    } catch (err) {
        return { success: false, error: err.message, code: 'CREATE_WALLET_ERROR' };
    }
}

async function loadWallet({ passphrase, walletPath = DEFAULT_WALLET_PATH } = {}) {
    try {
        const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        // Call Rust — decrypts entropy, re-derives address
        const result = native.loadWallet(
            passphrase, walletJson.encryptedSeed,
            walletJson.salt, walletJson.nonce, walletJson.network
        );
        return {
            success: true, address: result.address,
            network: walletJson.network,
            birthdayHeight: walletJson.birthdayHeight,
            createdAt: walletJson.createdAt
        };
    } catch (err) {
        return { success: false, error: err.message, code: 'LOAD_WALLET_ERROR' };
    }
}
```

### Anti-Patterns to Avoid

- **Returning entropy to JS:** The `create_wallet` Neon function must NOT return entropy or the raw 32-byte seed. Return only: `encryptedSeed`, `salt`, `nonce`, `address`, `mnemonic`. The mnemonic is technically recoverable to entropy (via `Mnemonic::from_phrase` + zeroize), but returning it is acceptable because the user must write it down — treat it as one-time output.
- **Writing wallet JSON from Rust:** Rust should not do filesystem I/O in this Neon function. Keep Rust responsible for crypto; JS responsible for file paths and OS-level directory creation.
- **Hardcoding KDF params in the wallet JSON reader:** Always read KDF params from the wallet file itself (stored in `kdf` field) so future param upgrades don't break existing wallets.
- **Forgetting `fs.chmodSync`:** The wallet JSON file must be `0o600` immediately after creation. Without this, any process running as the same user can read the encrypted seed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mnemonic word list + checksum | Custom BIP-39 implementation | `bip39` crate `Mnemonic::from_entropy` | BIP-39 has subtle checksum bits; word list must be exactly right; mnemonic-to-seed PBKDF2 is complex — the crate handles it all |
| Password-based key derivation | `crypto.scryptSync` in JS | `argon2` crate `hash_password_into` in Rust | Entropy must be encrypted INSIDE Rust; using JS crypto requires passing raw entropy across FFI boundary first — violates the core security invariant |
| Authenticated encryption | `crypto.createCipheriv('aes-256-gcm')` in JS | `chacha20poly1305` crate in Rust | Same reason: crypto must happen in Rust |
| Entropy generation | `Math.random()`, `Buffer.alloc` with custom seed | `OsRng` already in Neon function | `OsRng` maps to OS-level CSPRNG; `Math.random()` is not cryptographic |

**Key insight:** The security invariant "seed never crosses FFI boundary as plaintext" forces all crypto into Rust. This is not optional — it defines which layer owns each operation.

---

## Common Pitfalls

### Pitfall 1: Seed Crosses FFI Boundary as Plaintext

**What goes wrong:** Developer returns raw entropy or the `seed_hex` from Rust so JS can "own" it temporarily. The seed appears in JS heap, may be logged, may appear in stack traces, and is garbage collected non-deterministically.

**Why it happens:** It seems easier to split crypto (in Rust) from persistence (in JS), with entropy passed between them. The split is fine — but the boundary must be the encrypted blob, not the raw seed.

**How to avoid:** The Neon function receives passphrase, runs all crypto, and returns only: `{ encryptedSeed, salt, nonce, address, mnemonic }`. The mnemonic is derived from entropy but is a human-readable string — acceptable as a one-time return since the user must see it.

**Warning signs:** Any Rust code that returns a hex or byte array labeled "seed", "entropy", or "key" to the Neon JS result object.

### Pitfall 2: Using `Argon2::default()` Salt as a String (SaltString vs &[u8])

**What goes wrong:** Developer copies the `hash_password()` example which uses `SaltString` (a base64 string). The `hash_password_into` API takes `&[u8]` directly. Mixing the two leads to compile errors or using a string literal as salt (non-random, constant across wallets).

**Why it happens:** The argon2 crate has two APIs: `hash_password()` for PHC password storage, and `hash_password_into()` for raw key derivation. The docs and examples mostly show the former.

**How to avoid:** Use `hash_password_into(passphrase.as_bytes(), &salt_bytes, &mut output_key)` where `salt_bytes` is a `[u8; 32]` filled by `OsRng`. Do not use `SaltString` for this use case.

**Warning signs:** `SaltString::generate()` appearing in key derivation code.

### Pitfall 3: Wrong Nonce Size for XChaCha20 vs ChaCha20

**What goes wrong:** Developer uses `ChaCha20Poly1305` (12-byte nonce) but generates a 24-byte nonce, or vice versa. The `XNonce` type is 24 bytes; the standard `Nonce` type is 12 bytes. Mixing them causes a type error or runtime panic.

**Why it happens:** The crate exports both `ChaCha20Poly1305` (standard, 12-byte nonce) and `XChaCha20Poly1305` (extended, 24-byte nonce). The names are similar.

**How to avoid:** Import `XChaCha20Poly1305` and `XNonce` specifically. The extended variant is what STACK.md specifies (24-byte nonce eliminates nonce-reuse risk for a single wallet file).

**Warning signs:** Import of `ChaCha20Poly1305` (without the `X` prefix) in wallet encryption code.

### Pitfall 4: Neon `unwrap()` / `panic!` Crashes the Node.js Process

**What goes wrong:** A `unwrap()` on an `Option::None` (e.g., trying to parse a hex string from the wallet file that has been corrupted) panics inside the Neon function and aborts the entire Node.js process — not a thrown JS error.

**Why it happens:** Rust `panic!` inside Neon 0.10 is not caught by the JS runtime. The process aborts.

**How to avoid:** Convert all errors to `cx.throw_error(...)`. Use pattern: `Err(e) => return cx.throw_error(format!("...: {}", e))`. Use `hex::decode(s).map_err(|e| cx.throw_error(...))?` not `.unwrap()`.

**Warning signs:** Any `.unwrap()` or `.expect()` in lib.rs functions that take JS arguments.

### Pitfall 5: Not Zeroing Key Material Before Returning

**What goes wrong:** The 32-byte derived key and the 32-byte entropy remain on the Rust stack (and possibly heap) after the Neon function returns. They may be visible in memory dumps.

**Why it happens:** Rust does not zero memory by default on drop (no security-aware Drop impl on plain arrays).

**How to avoid:** Call `key.fill(0)` and `entropy.fill(0)` before the function returns — including all error paths. For production-grade zeroing, consider the `zeroize` crate (the `bip39` crate already depends on it via `bip39 = { version = "2.0.0", features = ["zeroize"] }`).

**Warning signs:** No explicit memory zeroing before function return in the encryption path.

### Pitfall 6: Birthday Height as 0 or Unset

**What goes wrong:** Wallet JSON is persisted without a `birthdayHeight` field, or with `birthdayHeight: 0`. When Phase 3 (balance scan) tries to sync, it scans from block 0 (chain genesis), which requires downloading and processing ~2.7 million Zcash blocks.

**Why it happens:** Phase 1 has no lightwalletd dependency, so it feels awkward to store a network-specific block height. Developer skips it as "a Phase 3 concern."

**How to avoid:** Use hardcoded safe birthday heights in the JS skill: mainnet Sapling activation is block 419200; use a recent conservative height (e.g., `2750000` for 2026) as the default. This costs nothing in Phase 1 and prevents a catastrophic UX failure in Phase 3.

**Warning signs:** Wallet JSON files in tests that don't assert `birthdayHeight` is present and non-zero.

---

## Code Examples

### Argon2id Key Derivation from Passphrase (Rust)

```rust
// Source: https://docs.rs/argon2/0.5.3/argon2/ + https://users.rust-lang.org/t/example-on-how-to-derive-key-with-argon2-crate/87601
use argon2::Argon2;
use rand::RngCore;
use rand::rngs::OsRng;

// Generate random 32-byte salt (must be stored alongside ciphertext)
let mut salt = [0u8; 32];
OsRng.fill_bytes(&mut salt);

// Derive 32-byte key from passphrase
// Argon2::default() = Argon2id v19, m=19456 KiB, t=2, p=1 (OWASP minimum)
let mut key = [0u8; 32];
Argon2::default()
    .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
    .map_err(|e| cx.throw_error(format!("KDF error: {}", e)))?;
```

### XChaCha20-Poly1305 Encrypt (Rust)

```rust
// Source: https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use rand::rngs::OsRng;

// key is [u8; 32] from Argon2id step above
let cipher = XChaCha20Poly1305::new_from_slice(&key)
    .map_err(|_| cx.throw_error("Invalid key length"))?;

// 24-byte nonce — XChaCha20 specific (NOT 12-byte ChaCha20 nonce)
let mut nonce_bytes = [0u8; 24];
OsRng.fill_bytes(&mut nonce_bytes);
let nonce = XNonce::from_slice(&nonce_bytes);

// plaintext is the 32-byte entropy
// ciphertext = 32 bytes ciphertext + 16 bytes auth tag = 48 bytes total
let ciphertext = cipher
    .encrypt(nonce, entropy.as_ref())
    .map_err(|_| cx.throw_error("Encryption failed"))?;
```

### XChaCha20-Poly1305 Decrypt (Rust)

```rust
// Source: https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/
let cipher = XChaCha20Poly1305::new_from_slice(&key)
    .map_err(|_| cx.throw_error("Invalid key length"))?;
let nonce = XNonce::from_slice(&nonce_bytes); // 24 bytes from wallet JSON

// decrypt returns Err if passphrase wrong (auth tag verification fails)
let entropy = cipher
    .decrypt(nonce, ciphertext.as_ref())
    .map_err(|_| cx.throw_error("Decryption failed — wrong passphrase?"))?;
// entropy is now Vec<u8> with the original 32-byte seed
```

### BIP-39 Mnemonic Generation (Rust)

```rust
// Source: https://docs.rs/bip39/2.0.0/bip39/struct.Mnemonic.html
use bip39::Mnemonic;

// 32 bytes entropy → 24-word mnemonic (256-bit entropy, per BIP-39 spec)
let mnemonic = Mnemonic::from_entropy(&entropy)
    .map_err(|e| cx.throw_error(format!("BIP-39 error: {}", e)))?;

let phrase = mnemonic.to_string(); // "word1 word2 ... word24"
```

### Neon Export Registration

```rust
// native/src/lib.rs — extend the existing #[neon::main]
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("generateShieldedAddress", generate_shielded_address)?;
    cx.export_function("validateAddress", validate_address)?;
    cx.export_function("createWallet", create_wallet)?;   // NEW
    cx.export_function("loadWallet", load_wallet)?;       // NEW
    Ok(())
}
```

### Wallet Persistence Skill Structure (JS)

```javascript
// skills/wallet-persist/index.js — follows existing skill pattern
async function createWallet(params) { ... }
async function loadWallet(params) { ... }

createWallet.meta = {
    name: 'wallet-persist-create',
    description: 'Create a new ZCash wallet with encrypted seed persistence',
    version: '1.0.0',
    execution: 'local',
    privacy: 'shielded-only'
};
loadWallet.meta = { ... };

module.exports = { createWallet, loadWallet };
module.exports.createWallet = createWallet;
module.exports.loadWallet = loadWallet;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AES-256-GCM with 12-byte nonce for seed files | XChaCha20-Poly1305 with 24-byte nonce | ~2021 (XChaCha20 crate matured) | 24-byte nonce eliminates nonce collision risk for single-file sealed secrets |
| PBKDF2 for passphrase-to-key | Argon2id (OWASP recommendation since 2023) | OWASP 2023 update | Argon2id is GPU/ASIC resistant; PBKDF2 is not |
| Storing derived keys (ESK, USK) on disk | Store only raw entropy; derive USK at runtime | librustzcash design decision | USK has no stable serialization; re-derivation is fast (<1ms) |
| JS-side crypto (via `@noble/chacha`, etc.) | All crypto in Rust Neon function | Project design decision | Secrets never leave Rust heap; no JS GC exposure |

**Deprecated/outdated:**
- `scrypt` in JS via `crypto.scryptSync`: valid algorithm but wrong layer for this project — crypto must be in Rust
- Storing `UnifiedSpendingKey` bytes: explicitly documented as unsupported in librustzcash; the struct has no serialization derive

---

## Open Questions

1. **Birthday height: hardcoded vs. live lightwalletd query**
   - What we know: Phase 1 has no lightwalletd dependency; using a hardcoded conservative block height is safe for new wallets
   - What's unclear: Should Phase 1 accept an optional `birthdayHeight` parameter so CLI/agent users can set it precisely? Or should it always use a hardcoded "recent mainnet height"?
   - Recommendation: Accept an optional `birthdayHeight` parameter in `createWallet`. If not provided, default to a hardcoded constant (e.g., `2750000` for mainnet) stored in `lib/constants.js`. Document clearly that this is a conservative default. Phase 3 will query the real chain tip when a lightwalletd URL is available.

2. **Mnemonic re-import: should `loadWallet` support mnemonic phrases as input?**
   - What we know: WALL-02 specifies loading from an encrypted wallet file with passphrase; WALL-04 specifies mnemonic generation. WALL-06 (mnemonic import) is explicitly v2 deferred.
   - What's unclear: Should Phase 1 include any mnemonic-restore path, or strictly only passphrase + encrypted file?
   - Recommendation: Strictly passphrase + encrypted file for Phase 1. Do not implement mnemonic restore (that is WALL-06, v2). Document that the mnemonic is for backup/recovery by humans, not for programmatic re-import in v1.

3. **Hex encoding: which crate handles `hex::encode/decode` in Rust?**
   - What we know: `hex` crate is not currently in `native/Cargo.toml`
   - What's unclear: Should we use the `hex` crate, or encode manually with `format!("{:02x}", byte)` iteration?
   - Recommendation: Add `hex = "0.4"` to `Cargo.toml`. It is a tiny, well-maintained crate. Avoids error-prone manual encoding.

4. **Where should `native-loader.js` validate the new exports?**
   - What we know: Current `native-loader.js` validates `generateShieldedAddress` and `validateAddress` are present after loading
   - What's unclear: Should validation be extended for `createWallet` and `loadWallet`, or will that break existing deployments without the updated binary?
   - Recommendation: Do not add validation in `native-loader.js` for the new functions. Instead, validate inside each skill at call time (`if (!native.createWallet) throw new Error(...)`). This preserves backward compatibility for consumers who only use the existing skills.

---

## Sources

### Primary (HIGH confidence)
- [chacha20poly1305 docs.rs v0.10.1](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/) — XNonce type (24 bytes), encrypt/decrypt API, KeyInit trait verified directly
- [argon2 docs.rs v0.5.3](https://docs.rs/argon2/0.5.3/argon2/) — `hash_password_into` signature, `Argon2::default()` params (m=19456, t=2, p=1) verified directly
- [argon2 Params struct docs.rs](https://docs.rs/argon2/0.5.3/argon2/struct.Params.html) — `DEFAULT_M_COST`, `DEFAULT_T_COST`, `DEFAULT_P_COST` constants confirmed
- [librustzcash zcash_keys keys.rs](https://github.com/zcash/librustzcash/blob/main/zcash_keys/src/keys.rs) — `UnifiedSpendingKey::from_seed` accepts `&[u8]` minimum 32 bytes; no upper bound; 32-byte entropy works directly
- [bip39 docs.rs v2.0.0](https://docs.rs/bip39/2.0.0/bip39/struct.Mnemonic.html) — `from_entropy(&[u8; 32])` → 24 words; `to_seed(passphrase)` → `[u8; 64]`; `to_string()` → space-separated phrase
- [.planning/research/STACK.md](../../../research/STACK.md) — Crate version selections, XChaCha20 over AES-GCM rationale, Argon2id over PBKDF2 rationale
- [.planning/research/ARCHITECTURE.md](../../../research/ARCHITECTURE.md) — Component boundaries, skill pattern, FFI design
- [.planning/research/PITFALLS.md](../../../research/PITFALLS.md) — All pitfalls cross-referenced; Pitfalls 1, 2, 3, 4, 6 directly apply to this phase

### Secondary (MEDIUM confidence)
- [Rust Forum: argon2 key derivation example](https://users.rust-lang.org/t/example-on-how-to-derive-key-with-argon2-crate/87601) — Verified `hash_password_into` usage pattern (confirmed against docs.rs API)
- [OWASP Password Storage Cheat Sheet](https://owasp.deteact.com/cheat/cheatsheets/Password_Storage_Cheat_Sheet.html) — Argon2id m=19 MiB, t=2, p=1 minimum confirmed as matching `Argon2::default()` params
- [BIP-39 spec (bitcoin/bips)](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) — 256 bits entropy = 24-word mnemonic; `to_seed()` produces 64-byte output via PBKDF2-SHA512

### Tertiary (LOW confidence)
- [Rust WebSearch: argon2 raw key derivation patterns] — Supplementary; cross-verified with docs.rs

---

## Metadata

**Confidence breakdown:**
- Standard stack (crate versions, APIs): HIGH — verified against official docs.rs for each crate
- Architecture (FFI boundary, skill pattern): HIGH — consistent with existing codebase and ARCHITECTURE.md
- Seed size (32-byte entropy vs 64-byte BIP-39 seed): MEDIUM — `from_seed` accepts both; recommendation to use 32-byte entropy is based on reading the source; should be validated with a test
- Birthday height values: MEDIUM — Sapling activation height 419200 is a well-known ZCash constant; the hardcoded `2750000` estimate for 2026 should be verified against actual chain state before shipping

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (30 days — Rust crate ecosystem is stable; argon2/chacha20poly1305 are mature RustCrypto crates with no pending breaking changes)
