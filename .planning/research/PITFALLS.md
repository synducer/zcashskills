# Pitfalls Research

**Domain:** ZCash SDK — wallet persistence, lightwalletd integration, shielded send, viewing keys, Neon/Rust-Node FFI
**Researched:** 2026-03-20
**Confidence:** MEDIUM (ZCash-specific pitfalls: MEDIUM from official docs + community; FFI pitfalls: MEDIUM from Neon docs)

---

## Critical Pitfalls

### Pitfall 1: Storing the Seed Unencrypted — Even Briefly

**What goes wrong:**
The seed (or any derived spending key) is written to disk, a temp file, a log, or an error message before encryption is applied. Keys appear only transiently, but crash-recovery, log rotation, or OS swap files capture them permanently.

**Why it happens:**
Developers serialize the seed to verify it round-trips correctly, add debug logging during development, or defer encryption to "after I've confirmed it works." The seed buffer lingers as a JS string in heap memory and may appear in stack traces or memory dumps.

**How to avoid:**
- Derive the seed in Rust (inside the Neon function) and immediately encrypt it before returning any bytes to JS.
- Never log seed bytes or hex-encoded keys at any level. Use `--release` in all CI builds so debug assertions don't log sensitive material.
- Use Node.js `Buffer.alloc` (zero-initialized) and wipe with `buf.fill(0)` as soon as the encrypted blob is produced.
- Return only the encrypted blob + salt + nonce from the Rust function. Never return the raw seed to JS.

**Warning signs:**
- Any test that prints the raw seed or address derivation path to stdout.
- `console.log` statements near key generation code that include hex strings.
- Symmetric test round-trip that stores seed in a file for comparison.

**Phase to address:**
Wallet persistence phase (first active milestone). Encryption must be the first thing built, not retrofitted.

---

### Pitfall 2: Weak Passphrase-to-Key Derivation

**What goes wrong:**
The passphrase is used directly as an AES key, or PBKDF2 is called with too few iterations (e.g., 1,000 or 10,000), or a predictable salt is used (e.g., a static constant or the wallet address). A brute-force attack recovers the seed from the encrypted blob.

**Why it happens:**
Developers copy a quick example from the Node.js crypto docs that uses defaults appropriate for interactive logins (fast), not for key wrapping (must be slow). OWASP's current recommendation is 600,000 iterations for PBKDF2-SHA256; the Node.js docs examples show far fewer.

**How to avoid:**
- Use `crypto.pbkdf2` with SHA-256, a minimum of 600,000 iterations (OWASP 2023 recommendation), and a 32-byte cryptographically random salt generated with `crypto.randomBytes(32)`.
- Prefer `scrypt` over PBKDF2 if Node.js version allows — it is memory-hard and more resistant to GPU attacks (`N=2^17, r=8, p=1` per OWASP).
- Store: `{ algorithm: "scrypt", salt: <hex>, N, r, p, ciphertext: <hex>, nonce: <hex>, tag: <hex> }` — include algorithm params so future upgrades can re-encrypt without breaking old wallets.
- Use AES-256-GCM (authenticated encryption) — never AES-CBC without an HMAC.

**Warning signs:**
- Any hardcoded salt or IV constant in encryption code.
- PBKDF2 iteration count below 200,000.
- Using `crypto.createCipheriv('aes-256-cbc', ...)` without an HMAC.
- No `authTag` verification on decrypt path.

**Phase to address:**
Wallet persistence phase. Define the encrypted wallet format spec before writing a single line of crypto code.

---

### Pitfall 3: No Wallet Birthday Height — Full Chain Rescan Required

**What goes wrong:**
The wallet doesn't record the block height at which it was created. On first use or after recovery, the light client must scan the entire chain from genesis (currently ~2.7 million blocks for mainnet), which takes hours to days. Users think the wallet is broken.

**Why it happens:**
Developers test with freshly-created wallets that have no history, so scanning finishes quickly. Production wallets with real funds require scanning from the beginning unless a birthday height is stored.

**How to avoid:**
- When generating a new wallet, query lightwalletd for the current chain tip height and store it as `birthday_height` alongside the encrypted seed.
- Format: `{ birthday_height: 2750000, birthday_sapling_tree_hash: "<hex>", created_at: "<ISO8601>" }`.
- On recovery from seed phrase, prompt the user for an approximate birthday date; convert to block height with a conservative buffer of -100 blocks.
- Never start scanning from block 0 unless the user explicitly requests a full rescan.

**Warning signs:**
- Wallet persistence code that writes only the encrypted seed bytes and nothing else.
- Integration tests that don't assert `birthday_height` is present in the persisted file.
- Balance check that takes more than 30 seconds on a testnet wallet created yesterday.

**Phase to address:**
Wallet persistence phase AND balance checking phase. Birthday height must be stored when the wallet is created; it must be read back when connecting to lightwalletd.

---

### Pitfall 4: Unified Spending Key Has No Stable Serialization Format

**What goes wrong:**
Code tries to serialize a `UnifiedSpendingKey` to disk (to cache the derived key) using a custom format or `z_exportkey` output. On deserialization or library upgrade, the format is incompatible and the key cannot be restored.

**Why it happens:**
The `UnifiedSpendingKey` struct in librustzcash intentionally has no stable serialized form — the library maintainers explicitly state this. Developers assume they can round-trip it like any Rust struct.

**How to avoid:**
- Never serialize `UnifiedSpendingKey` to disk. It is a runtime-only type.
- The only thing that should be persisted is the original 32-byte (or 64-byte BIP-39) seed — encrypted. Derive the USK from the seed at runtime on every load.
- Derive `UnifiedFullViewingKey` (UFVK) and `IncomingViewingKey` from the USK in memory only; serialize UFVKs using the Bech32m encoding defined in ZIP-316 if you need to persist viewing keys.

**Warning signs:**
- Any code that calls `.serialize()`, `bincode::serialize()`, or `serde_json::to_string()` on a `UnifiedSpendingKey`.
- Wallet files larger than the seed + nonce + tag bytes (suggesting derived key material is being cached).

**Phase to address:**
Wallet persistence phase. Document this constraint in the skill's API before writing the persistence layer.

---

### Pitfall 5: Full Viewing Key Exposes Outgoing Transaction Graph

**What goes wrong:**
The FVK (full viewing key) is shared for "read-only" access, but the recipient of the FVK can see all outgoing transactions — including the amounts sent and the recipient addresses. This is a significant privacy leak. The developer or agent owner intended to give an auditor "incoming only" view and accidentally gave them full transaction history.

**Why it happens:**
Documentation for FVKs emphasizes what they don't do (spend funds) rather than what they do expose. Developers assume "viewing key = read what was received." ZIP-310 documents the outgoing component (OVK) but this is underemphasized in tutorials.

**How to avoid:**
- Expose `IncomingViewingKey` (IVK) as the default for external auditor/agent use cases. IVK reveals only incoming transactions.
- Expose `FullViewingKey` only when outgoing visibility is explicitly required (e.g., internal compliance audit by the wallet owner).
- Document the distinction in the skill's `.meta` export and API docs.
- Never auto-generate or share FVKs in a default flow — require the user to explicitly opt into outgoing visibility.

**Warning signs:**
- API that returns `fvk` without a clear label distinguishing it from `ivk`.
- Test that uses FVK when IVK would suffice.

**Phase to address:**
Viewing key phase. API design must be explicit about which key type is returned.

---

### Pitfall 6: Neon Panic Crashes the Entire Node Process

**What goes wrong:**
A Rust panic inside a Neon-exported function (e.g., from an unwrap on a None, an out-of-bounds index, or a too-long string passed to `JsString::new()`) kills the Node.js process entirely rather than throwing a JS exception.

**Why it happens:**
Rust panics in Neon 0.10 are not caught by the JS runtime. The process aborts. This is especially dangerous in a long-running agent that holds wallet state in memory.

**How to avoid:**
- Use `cx.throw_error(...)` for all error conditions rather than `unwrap()`, `expect()`, or `panic!()`.
- Use `JsString::try_new()` instead of `JsString::new()` for any string derived from external input.
- Wrap the top-level body of each Neon function in a `std::panic::catch_unwind` and convert panics to `cx.throw_error(...)`.
- Test with inputs at boundary conditions: empty strings, null bytes, very long strings, invalid UTF-8.

**Warning signs:**
- `unwrap()` or `expect()` calls in `lib.rs` on anything that isn't a compile-time constant.
- Neon functions that take a `JsString` argument without length validation before passing to crypto functions.
- Tests that only exercise the happy path.

**Phase to address:**
All Rust implementation phases. Add a `catch_unwind` wrapper when adding new Neon functions for spend/sign/decrypt.

---

### Pitfall 7: lightwalletd gRPC Streaming Without Backpressure or Timeout

**What goes wrong:**
The compact block streaming call from lightwalletd (`GetBlockRange`) runs without a deadline. On a slow or unreliable connection, the stream hangs indefinitely, blocking the agent's event loop. On reconnect, the wallet rescans blocks it has already processed, causing duplicate detected-transaction events or incorrect balance display.

**Why it happens:**
gRPC streaming APIs don't enforce timeouts by default. The Node.js gRPC client (`@grpc/grpc-js`) requires explicit deadline configuration. Wallet state (last scanned height) is not saved atomically with block processing.

**How to avoid:**
- Set a deadline on every lightwalletd call: `deadline: Date.now() + 30_000` for unary calls; use per-stream keepalive with `keepaliveTimeMs` and `keepaliveTimeoutMs` in channel options.
- Save `last_scanned_height` atomically (write-then-rename) after successfully processing each batch of blocks.
- Implement exponential backoff (start 1s, max 60s) for reconnects.
- Use `@grpc/grpc-js` channel option `maxReceiveMessageLength` to prevent memory exhaustion from malformed blocks.

**Warning signs:**
- lightwalletd call with no `deadline` property.
- Balance check that re-queries from `birthday_height` on every agent invocation instead of from `last_scanned_height`.
- No retry logic around the initial `GetLightdInfo` handshake.

**Phase to address:**
Balance checking / lightwalletd integration phase.

---

### Pitfall 8: ZIP-317 Fee Calculation — Wrong Logical Action Count for Sapling

**What goes wrong:**
The transaction fee is calculated as a fixed 1,000 zatoshis (the old ZIP-313 standard) or a flat 10,000 zatoshis, instead of the ZIP-317 proportional formula. Transactions are rejected by modern miners as below-minimum fee. Alternatively, the fee is over-counted by adding spends + outputs rather than `max(spends, outputs)` for Sapling.

**Why it happens:**
ZIP-317 replaced ZIP-313 in April 2023 but is not the default in all SDKs. Old tutorials and examples use the 1,000 or 10,000 zatoshi constant. The Sapling fee formula is `5,000 × max(nSpends, nOutputs)` — not additive — which is counterintuitive.

**How to avoid:**
- Use `zcash_primitives::transaction::fees::zip317::FeeRule` from librustzcash, which implements ZIP-317 correctly.
- Minimum for a simple z-to-z (1 spend, 2 outputs including change): `5,000 × max(2, 1, 2) = 10,000 zatoshis` — do not hardcode, use the crate's `fee_for_proposal` API.
- Test fee calculation with a transaction builder that has the ECC's test fixtures.

**Warning signs:**
- Any hardcoded fee constant other than using the fee rule API.
- Transaction rejected by lightwalletd with "insufficient fee" error.
- Fee calculated as `nSpends + nOutputs` rather than `max(nSpends, nOutputs)`.

**Phase to address:**
Shielded send phase. Implement fee calculation before transaction construction.

---

### Pitfall 9: Note Witness Stale After Reorg — Spending Invalid Note

**What goes wrong:**
A note commitment witness (the Merkle path proving the note exists in the commitment tree) is cached at a specific block height. After a chain reorg, the witness is invalid but the wallet doesn't know. The next spend attempt produces a transaction with an invalid anchor, which is rejected by the network. The wallet shows funds as available but can't send.

**Why it happens:**
Light clients cache witnesses to avoid re-downloading the entire commitment tree. When a reorg occurs (especially common on testnet), the cached witnesses must be invalidated and rebuilt from the reorganized chain tip. This is a known hard problem in the zcash_client_sqlite codebase.

**How to avoid:**
- Use `zcash_client_backend`'s `data_api::chain::handle_chain_error` to handle `ChainError::Continuity` reorg detection.
- Never use a cached witness without first verifying `last_scanned_height` matches the current chain tip minus a safety buffer (at minimum 1 confirmation, recommend 10).
- For v1 of this SDK, require at least 1 confirmation before marking notes as spendable. Document this constraint clearly.
- If building the transaction in Rust via librustzcash's builder, use the `get_anchor_at` call with the current chain tip from lightwalletd.

**Warning signs:**
- Spend attempt that fails with "invalid anchor" from lightwalletd.
- Wallet that reports confirmed balance but all send attempts fail.
- Integration test environment that doesn't test reorg scenarios.

**Phase to address:**
Shielded send phase. Require confirmed notes only; document the confirmation threshold.

---

### Pitfall 10: Neon Module Loaded at Require-Time — Load Failure Kills All Skills

**What goes wrong:**
`lib/native-loader.js` loads the native module synchronously at require-time. If the `.node` binary is missing, the wrong platform binary is loaded, or the Rust ABI doesn't match the Node.js version, the require throws and the entire `zcashskills` package is unloadable. All skills — including ones that don't use the native module — fail.

**Why it happens:**
The current `native-loader.js` follows a "load everything upfront" pattern. This is simpler to write but creates a hard dependency for all skill imports.

**How to avoid:**
- Lazy-load the native module: export a `getNative()` function that loads on first call, not at module load time.
- Skills that don't require native crypto (e.g., `parse-payment-uri`) should not import from `native-loader.js` at all.
- Catch native module load errors and return a clear error from `getNative()` rather than throwing at package boundary.
- The `buildFromSource()` fallback triggers `npm install` in production — this is unsafe. Disable it for production builds; make it dev-only with an environment check.

**Warning signs:**
- `import { parsePaymentUri } from 'zcashskills'` fails because the native module binary is missing.
- CI pipeline that runs on a platform not in `prebuilds/` breaks all tests.
- `buildFromSource()` running in a production container that has no Rust toolchain.

**Phase to address:**
All phases — this is a structural issue with the existing loader that should be fixed before adding new native functions.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode a fixed fee of 10,000 zatoshis | Simpler first implementation | Transaction rejection when input/output counts vary; incorrect fee for complex txs | Never — use ZIP-317 fee rule API from the start |
| Store seed in plaintext during development | Faster iteration, easier debugging | Seeds leak into git history, logs, crash reports; impossible to audit | Never — use a dummy throwaway seed for dev |
| Skip wallet birthday height | Simpler persistence format | Full rescan required on recovery; hours/days of sync time; bad UX | Never — birthday height costs one lightwalletd RPC call |
| Use FVK everywhere instead of IVK | One key type to document | Privacy leak: exposes outgoing graph to anyone holding the key | Only when the holder is the wallet owner doing self-audit |
| Lazy error handling (`unwrap()`) in Neon | Faster Rust development | Process crash on any unexpected input from JS layer | Never in production code paths |
| Skip confirmation count before spend | Instant "available balance" | Reorg causes invalid witness, spend fails after user commits to payment | Never — require at least 1 confirmation |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| lightwalletd gRPC | Connect to `zec.rocks:443` directly from Node.js `@grpc/grpc-js` without TLS cert verification | Use official CA-signed TLS; verify server cert; use `grpc.credentials.createSsl()` with system root CA |
| lightwalletd gRPC | Use raw gRPC from a browser/web context without a gRPC-web proxy | Only relevant for Node.js in this project — `@grpc/grpc-js` speaks native gRPC (not gRPC-web), no proxy needed |
| lightwalletd `GetBlockRange` | Stream all blocks to JS, decrypt in JS | Decrypt in Rust (inside the Neon function) where crypto primitives live; stream compact blocks through Rust scanner |
| lightwalletd `SendTransaction` | Broadcast raw transaction without checking `GetLightdInfo` protocol version | Call `GetLightdInfo` first; verify `saplingActivationHeight` matches expected network; check `blockHeight` is current |
| lightwalletd on testnet | Use mainnet lightwalletd URL in testnet wallet or vice versa | Store network in wallet metadata; assert network match on every connect |
| Neon + async Node.js | Call a blocking Rust function from the main thread during scanning | Use Neon's `Channel` / `JsPromise` + Tokio for I/O-bound operations; never block the JS event loop |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Scanning from birthday_height every agent invocation | Each balance check takes 30+ seconds | Persist `last_scanned_height`; only fetch new blocks since last scan | Immediately on second invocation |
| Fetching individual blocks instead of `GetBlockRange` | 100x more lightwalletd round trips; linear slowdown | Always use streaming `GetBlockRange` for batch downloads | After ~100 blocks |
| Decrypting all compact outputs in JS | Scalar multiplication in JS is ~1000x slower than Rust | Pass viewing key to Rust and decrypt inside the Neon function | After ~1,000 outputs |
| Loading entire wallet DB into memory | OOM on wallets with thousands of notes | Stream notes from SQLite with pagination; don't load all UTXO set | After ~10,000 notes |
| No connection pooling to lightwalletd | New TLS handshake per skill invocation; 300ms+ latency | Reuse a persistent gRPC channel across invocations within a process | Noticeable from the first invocation in high-frequency agent use |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging passphrase or derived key material | Key recovery by anyone with log access | Sanitize all log output; never pass passphrase through `console.log` or error messages |
| Weak PBKDF2 iteration count (<200,000) | Offline brute-force of encrypted wallet file | Use scrypt (`N=2^17, r=8, p=1`) or PBKDF2 with 600,000 iterations minimum |
| Reusing AES-GCM nonce | Catastrophic: reveals keystream, decrypts ciphertext | Generate a fresh `crypto.randomBytes(12)` nonce on every encrypt; never increment a counter |
| Transmitting IVK or FVK over HTTP | Key interception — full transaction history exposed | HTTPS only; never log or include viewing keys in agent task descriptions |
| Sharing FVK when IVK is sufficient | Exposes outgoing transaction graph to auditor | Default to IVK; require explicit opt-in for FVK exposure |
| Building and broadcasting a transaction without balance check | Insufficient funds error after Groth16 proof generation (expensive) | Check spendable balance before starting transaction builder; validate change output covers fee |
| Storing wallet file in the agent's working directory without restrictive permissions | Other processes or users on the system read the encrypted wallet | Set file permissions to `0600` on wallet creation (`fs.chmodSync(path, 0o600)`) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Wallet persistence:** Verify the encrypted blob decrypts correctly before returning success — a wrong passphrase on first read is better than silent data corruption.
- [ ] **Birthday height:** Confirm `birthday_height` is stored and read back on every lightwalletd connect — not just on initial creation.
- [ ] **Viewing key type:** Confirm `getViewingKey` skill returns IVK by default and clearly labels FVK when returned — not just "viewingKey".
- [ ] **Fee calculation:** Confirm fee uses ZIP-317 formula, not a hardcoded constant — send a transaction with 3 outputs to verify.
- [ ] **Confirmation count:** Confirm balance reports "confirmed" vs "pending" separately — do not show pending notes as spendable.
- [ ] **Neon error handling:** Confirm every Rust function returns a proper JS error (not a process crash) when given invalid inputs — test with empty string, 1MB string, null byte in network param.
- [ ] **Native loader:** Confirm importing a non-native skill (e.g., `parse-payment-uri`) does not throw if the `.node` binary is absent.
- [ ] **Network assertion:** Confirm lightwalletd connect validates that the server network matches the wallet's stored network — prevent mainnet key against testnet server.
- [ ] **Nonce uniqueness:** Confirm encrypted wallet file format stores a unique nonce per encryption event — re-encrypting with a new passphrase must generate a fresh nonce.
- [ ] **Witness staleness:** Confirm spend path fetches a fresh anchor from lightwalletd rather than using a cached block height from disk.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Seed stored unencrypted, now in git history | HIGH | Rotate wallet immediately (generate new seed, send all funds to new address); purge git history with `git filter-repo`; treat old address as compromised |
| Weak KDF, wallet file exposed | HIGH | If passphrase is strong (>20 chars random), may be acceptable; otherwise rotate wallet immediately |
| Missing birthday height, rescan required | MEDIUM | Set birthday to `max(sapling_activation_height, earliest_known_transaction_height - 100)`; re-run full scan once |
| Stale witness on spend | LOW | Resync from `last_confirmed_height - 100`; re-fetch witnesses; retry send |
| Wrong fee, transaction rejected | LOW | Increase fee to ZIP-317 minimum; rebroadcast; original transaction is never confirmed if below minimum |
| Neon process crash in production | MEDIUM | Agent process restarts; wallet state on disk is intact if written before crash; re-initialize on restart |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Seed stored unencrypted | Wallet persistence | No plaintext seed in any file, log, or test output after phase complete |
| Weak KDF | Wallet persistence | KDF params (N, iterations, salt length) in code review checklist |
| No wallet birthday height | Wallet persistence | Integration test: create wallet, read back birthday_height, assert present |
| USK serialization | Wallet persistence | No `serialize(UnifiedSpendingKey)` call anywhere in codebase |
| FVK vs IVK confusion | Viewing keys | API review: default path returns IVK; FVK requires explicit argument |
| Neon panic crashes process | All Rust phases | Fuzz test: pass 50 invalid inputs to each Neon function; process must not crash |
| lightwalletd no timeout | Balance checking | Integration test: connect to unreachable host; verify error returned within 10s |
| ZIP-317 wrong fee | Shielded send | Fee unit test with 1-spend-2-output transaction: assert fee == 10,000 zatoshis |
| Stale witness on spend | Shielded send | Testnet reorg simulation: resync, retry send, assert success |
| Native loader at require-time | All phases | Test: `require('zcashskills/skills/parse-payment-uri')` with no `.node` binary present — must not throw |

---

## Sources

- [ZIP-317: Proportional Transfer Fee Mechanism](https://zips.z.cash/zip-0317) — fee formula, logical action counts (MEDIUM confidence, official spec)
- [ZIP-310: Security Properties of Sapling Viewing Keys](https://zips.z.cash/zip-0310) — FVK vs IVK disclosure properties (MEDIUM confidence, official spec)
- [Zcash Security Warnings](https://zcash.readthedocs.io/en/latest/rtd_pages/security_warnings.html) — wallet encryption disabled, side-channel attacks (HIGH confidence, official docs)
- [zcash_client_backend docs](https://docs.rs/zcash_client_backend) — scanning API, semver caveat, feature flags (MEDIUM confidence, official crate docs)
- [zcash_client_sqlite docs](https://docs.rs/zcash_client_sqlite) — SQLite wallet database architecture, two-database design (MEDIUM confidence, official crate docs)
- [Neon bindings — thread safety](https://docs.neon-bindings.com/neon/thread/) — LocalKey, thread-local storage, panic behavior (MEDIUM confidence, official docs)
- [WebZjs README](https://github.com/ChainSafe/WebZjs) — gRPC-web proxy requirement, maturity caveats (LOW confidence, single source)
- [zcash/zcash Issue #3607: HD seed cannot be added to encrypted wallets](https://github.com/zcash/zcash/issues/3607) — historical USK/seed persistence issues (LOW confidence, historical issue)
- [OWASP Password Storage Cheat Sheet 2025](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — PBKDF2/scrypt iteration recommendations (MEDIUM confidence)
- [gRPC Retry documentation](https://grpc.io/docs/guides/retry/) — retry policy parameters (HIGH confidence, official gRPC docs)
- Community forum: [Zcashd and lightwalletd](https://forum.zcashcommunity.com/t/zcashd-and-lightwalletd/52995) — network/restart requirements (LOW confidence, community)
- [DAGSync: Graph-aware Zcash wallets](https://hackmd.io/@str4d/dagsync-graph-aware-zcash-wallets) — witness cache and scanning architecture (LOW confidence, technical design doc)

---
*Pitfalls research for: ZCash SDK — wallet persistence, lightwalletd, shielded send, viewing keys*
*Researched: 2026-03-20*
