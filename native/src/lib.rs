use neon::prelude::*;
use rand::RngCore;
use rand::rngs::OsRng;
use zcash_address::{ToAddress, ZcashAddress};
use zcash_keys::keys::{UnifiedSpendingKey, UnifiedFullViewingKey};
use zcash_protocol::consensus::{Network, NetworkType, BlockHeight};
use zcash_protocol::memo::MemoBytes;
use zcash_protocol::value::Zatoshis;
use zip32::AccountId;
use argon2::Argon2;
use bip39::Mnemonic;
use chacha20poly1305::{XChaCha20Poly1305, XNonce, aead::{Aead, KeyInit}};

// Transaction building imports
use zcash_primitives::transaction::builder::{Builder, BuildConfig};
use zcash_primitives::transaction::fees::fixed::FeeRule as FixedFeeRule;
use zcash_primitives::transaction::components::transparent::builder::TransparentSigningSet;
use zcash_proofs::prover::LocalTxProver;
use sapling_crypto::note_encryption::{
    try_sapling_compact_note_decryption, CompactOutputDescription, Zip212Enforcement,
    PreparedIncomingViewingKey,
};
use sapling_crypto::{PaymentAddress as SaplingPaymentAddress, Rseed};
use sapling_crypto::note::ExtractedNoteCommitment;
use sapling_crypto::value::NoteValue;
use zcash_note_encryption::EphemeralKeyBytes;
use zcash_address::TryFromAddress;

// Serialization
use serde::{Deserialize, Serialize};

/// Helper: decrypt wallet seed from encrypted params.
/// Reusable across all functions that need the raw entropy.
fn decrypt_seed(
    passphrase: &str,
    enc_seed_hex: &str,
    salt_hex: &str,
    nonce_hex: &str,
) -> Result<Vec<u8>, String> {
    let ciphertext = hex::decode(enc_seed_hex)
        .map_err(|e| format!("Invalid encryptedSeed hex: {}", e))?;
    let salt = hex::decode(salt_hex)
        .map_err(|e| format!("Invalid salt hex: {}", e))?;
    let nonce_bytes = hex::decode(nonce_hex)
        .map_err(|e| format!("Invalid nonce hex: {}", e))?;

    if salt.len() != 32 {
        return Err(format!("Salt must be 32 bytes, got {}", salt.len()));
    }
    if nonce_bytes.len() != 24 {
        return Err(format!("Nonce must be 24 bytes, got {}", nonce_bytes.len()));
    }

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
        .map_err(|e| format!("KDF error: {}", e))?;

    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|_| { key.fill(0); "Invalid key length".to_string() })?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    let entropy = cipher.decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| { key.fill(0); "Decryption failed — wrong passphrase or corrupted wallet file".to_string() })?;
    key.fill(0);
    Ok(entropy)
}

/// Serde struct for a scanned note passed between JS and Rust.
#[derive(Serialize, Deserialize, Debug, Clone)]
struct ScannedNote {
    /// Note value in zatoshis
    value: u64,
    /// Recipient payment address bytes (43 bytes, hex-encoded)
    recipient_hex: String,
    /// Rseed bytes (32 bytes, hex-encoded)
    rseed_hex: String,
    /// Note commitment tree position (u64)
    position: u64,
    /// Block height where note was found
    height: u64,
    /// Nullifier (32 bytes, hex-encoded) — for spent detection
    nullifier_hex: String,
    /// Merkle authentication path (array of 32-byte hashes, hex-encoded)
    /// Empty if witness not yet computed
    merkle_path_hex: Vec<String>,
}

/// Serde struct for a compact output from JS (parsed from gRPC CompactBlock).
#[derive(Deserialize, Debug)]
struct CompactOutput {
    /// cmu (32 bytes, hex)
    cmu: String,
    /// ephemeral_key (32 bytes, hex)
    ephemeral_key: String,
    /// ciphertext (52 bytes, hex)
    ciphertext: String,
}

/// Serde struct for a compact transaction from JS.
#[derive(Deserialize, Debug)]
struct CompactTxData {
    outputs: Vec<CompactOutput>,
    /// Sapling spends — nullifiers to detect spent notes
    spends: Vec<String>,  // hex-encoded nullifier bytes
}

/// Serde struct for a compact block from JS.
#[derive(Deserialize, Debug)]
struct CompactBlockData {
    height: u64,
    txs: Vec<CompactTxData>,
}

/// Generate a new ZCash Sapling shielded address.
fn generate_shielded_address(mut cx: FunctionContext) -> JsResult<JsObject> {
    let network_str = cx.argument::<JsString>(0)?.value(&mut cx);

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Generate a cryptographically random 32-byte seed
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);

    // Derive the unified spending key from the seed
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &seed, AccountId::ZERO) {
        Ok(key) => key,
        Err(e) => return cx.throw_error(format!("Key derivation failed: {:?}", e)),
    };

    // Get the Sapling extended spending key and derive default payment address
    let sapling_esk = usk.sapling();
    let (_diversifier_index, payment_address) = sapling_esk.default_address();

    // Encode as a bech32 ZCash address string
    let addr_network = match network_str.as_str() {
        "mainnet" => NetworkType::Main,
        _ => NetworkType::Test,
    };
    let zcash_addr = ZcashAddress::from_sapling(addr_network, payment_address.to_bytes());
    let address_string = zcash_addr.encode();

    // Build the JS result object
    let result = cx.empty_object();

    let js_address = cx.string(&address_string);
    result.set(&mut cx, "address", js_address)?;

    let js_network = cx.string(&network_str);
    result.set(&mut cx, "network", js_network)?;

    let js_type = cx.string("shielded");
    result.set(&mut cx, "type", js_type)?;

    let js_path = cx.string("m/32'/133'/0'");
    result.set(&mut cx, "derivation_path", js_path)?;

    Ok(result)
}

/// Validate a ZCash address string.
fn validate_address(mut cx: FunctionContext) -> JsResult<JsObject> {
    let address_str = cx.argument::<JsString>(0)?.value(&mut cx);
    let result = cx.empty_object();

    match ZcashAddress::try_from_encoded(&address_str) {
        Ok(_addr) => {
            let val = cx.boolean(true);
            result.set(&mut cx, "valid", val)?;

            let network = if address_str.starts_with("zs1") || address_str.starts_with("u1") {
                "mainnet"
            } else if address_str.starts_with("ztestsapling") || address_str.starts_with("utest") {
                "testnet"
            } else {
                "unknown"
            };
            let js_network = cx.string(network);
            result.set(&mut cx, "network", js_network)?;

            let addr_type = if address_str.starts_with("zs1") || address_str.starts_with("ztestsapling") {
                "shielded"
            } else if address_str.starts_with("u1") || address_str.starts_with("utest") {
                "unified"
            } else {
                "transparent"
            };
            let js_type = cx.string(addr_type);
            result.set(&mut cx, "type", js_type)?;
        }
        Err(_) => {
            let val = cx.boolean(false);
            result.set(&mut cx, "valid", val)?;
        }
    }

    Ok(result)
}

/// Create a new encrypted ZCash wallet from a passphrase and network.
/// Returns { encryptedSeed, salt, nonce, address, mnemonic } — raw entropy never returned.
fn create_wallet(mut cx: FunctionContext) -> JsResult<JsObject> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(1)?.value(&mut cx);

    // Validate inputs — no unwrap(), convert all errors to cx.throw_error
    if passphrase.len() < 8 {
        return cx.throw_error("Passphrase must be at least 8 characters");
    }

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Step 1: Generate 32-byte random entropy
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy);

    // Step 2: Generate BIP-39 mnemonic (24 words from 256-bit entropy)
    let mnemonic = match Mnemonic::from_entropy(&entropy) {
        Ok(m) => m,
        Err(e) => {
            entropy.fill(0);
            return cx.throw_error(format!("BIP-39 error: {}", e));
        }
    };
    let mnemonic_phrase = mnemonic.to_string();

    // Step 3: Derive ZCash address from 32-byte entropy directly
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(key) => key,
        Err(e) => {
            entropy.fill(0);
            return cx.throw_error(format!("Key derivation failed: {:?}", e));
        }
    };
    let sapling_esk = usk.sapling();
    let (_diversifier_index, payment_address) = sapling_esk.default_address();
    let addr_network = match network_str.as_str() {
        "mainnet" => NetworkType::Main,
        _ => NetworkType::Test,
    };
    let zcash_addr = ZcashAddress::from_sapling(addr_network, payment_address.to_bytes());
    let address_string = zcash_addr.encode();

    // Step 4: Generate random 32-byte salt for Argon2id
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);

    // Step 5: Derive 32-byte encryption key from passphrase via Argon2id
    // Argon2::default() = Argon2id v19, m=19456 KiB, t=2, p=1 (OWASP minimum)
    let mut key = [0u8; 32];
    if let Err(e) = Argon2::default().hash_password_into(passphrase.as_bytes(), &salt, &mut key) {
        entropy.fill(0);
        return cx.throw_error(format!("KDF error: {}", e));
    }

    // Step 6: Encrypt entropy with XChaCha20-Poly1305 (24-byte nonce)
    // XChaCha20Poly1305 (NOT ChaCha20Poly1305) — uses XNonce (24 bytes), NOT Nonce (12 bytes)
    let cipher = match XChaCha20Poly1305::new_from_slice(&key) {
        Ok(c) => c,
        Err(_) => {
            key.fill(0);
            entropy.fill(0);
            return cx.throw_error("Invalid key length");
        }
    };
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = match cipher.encrypt(nonce, entropy.as_ref()) {
        Ok(ct) => ct,
        Err(_) => {
            key.fill(0);
            entropy.fill(0);
            return cx.throw_error("Encryption failed");
        }
    };

    // Step 7: Zero sensitive key material before returning
    key.fill(0);
    entropy.fill(0);

    // Step 8: Return hex-encoded blobs to JS — raw entropy NEVER returned
    // ciphertext is 32 bytes data + 16 bytes auth tag = 48 bytes total
    let result = cx.empty_object();
    let js_encrypted_seed = cx.string(hex::encode(&ciphertext));
    result.set(&mut cx, "encryptedSeed", js_encrypted_seed)?;
    let js_salt = cx.string(hex::encode(&salt));
    result.set(&mut cx, "salt", js_salt)?;
    let js_nonce = cx.string(hex::encode(&nonce_bytes));
    result.set(&mut cx, "nonce", js_nonce)?;
    let js_address = cx.string(&address_string);
    result.set(&mut cx, "address", js_address)?;
    let js_mnemonic = cx.string(&mnemonic_phrase);
    result.set(&mut cx, "mnemonic", js_mnemonic)?;

    Ok(result)
}

/// Load a wallet by decrypting an encrypted seed with the given passphrase.
/// Returns { address, network } if successful, throws JS error on wrong passphrase.
fn load_wallet(mut cx: FunctionContext) -> JsResult<JsObject> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let encrypted_seed_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex = cx.argument::<JsString>(3)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(4)?.value(&mut cx);

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Decode hex inputs — use match to throw_error, never unwrap
    let ciphertext = match hex::decode(&encrypted_seed_hex) {
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

    if salt.len() != 32 {
        return cx.throw_error(format!("Salt must be 32 bytes, got {}", salt.len()));
    }
    if nonce_bytes.len() != 24 {
        return cx.throw_error(format!("Nonce must be 24 bytes, got {}", nonce_bytes.len()));
    }

    // Re-derive encryption key from passphrase + salt
    let mut key = [0u8; 32];
    if let Err(e) = Argon2::default().hash_password_into(passphrase.as_bytes(), &salt, &mut key) {
        return cx.throw_error(format!("KDF error: {}", e));
    }

    // Decrypt the entropy
    let cipher = match XChaCha20Poly1305::new_from_slice(&key) {
        Ok(c) => c,
        Err(_) => {
            key.fill(0);
            return cx.throw_error("Invalid key length");
        }
    };
    let nonce = XNonce::from_slice(&nonce_bytes);
    let entropy = match cipher.decrypt(nonce, ciphertext.as_ref()) {
        Ok(plaintext) => plaintext,
        Err(_) => {
            key.fill(0);
            return cx.throw_error("Decryption failed — wrong passphrase or corrupted wallet file");
        }
    };
    // entropy is Vec<u8> containing the original 32-byte seed

    // Zero the derived key immediately after decrypt
    key.fill(0);

    // Re-derive ZCash address from decrypted entropy
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(key) => key,
        Err(e) => return cx.throw_error(format!("Key derivation failed: {:?}", e)),
    };
    let sapling_esk = usk.sapling();
    let (_diversifier_index, payment_address) = sapling_esk.default_address();
    let addr_network = match network_str.as_str() {
        "mainnet" => NetworkType::Main,
        _ => NetworkType::Test,
    };
    let zcash_addr = ZcashAddress::from_sapling(addr_network, payment_address.to_bytes());
    let address_string = zcash_addr.encode();

    // entropy Vec<u8> goes out of scope here — standard Rust drop
    // key was already zeroed above

    let result = cx.empty_object();
    let js_address = cx.string(&address_string);
    result.set(&mut cx, "address", js_address)?;
    let js_network = cx.string(&network_str);
    result.set(&mut cx, "network", js_network)?;

    Ok(result)
}

/// Derive a viewing key from an encrypted wallet seed.
/// keyType: "incoming" -> UIVK (uivk1...), "full" -> UFVK (uview1...)
/// Returns ZIP-316 bech32m encoded key string. Raw key material never returned.
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

    // Decode hex inputs — match + cx.throw_error pattern (NOT map_err + ?)
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

    // Re-derive decryption key from passphrase (same Argon2id params as create_wallet)
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
    let mut entropy = match cipher.decrypt(nonce, ciphertext.as_ref()) {
        Ok(p) => p,
        Err(_) => { key.fill(0); return cx.throw_error("Decryption failed — wrong passphrase"); }
    };
    key.fill(0);

    // Derive USK from decrypted entropy (AccountId::ZERO — same as create_wallet/load_wallet)
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(k) => k,
        Err(e) => {
            entropy.iter_mut().for_each(|b| *b = 0);
            return cx.throw_error(format!("Key derivation failed: {:?}", e));
        }
    };
    entropy.iter_mut().for_each(|b| *b = 0);

    // Derive UFVK — unified path (NOT usk.sapling().to_full_viewing_key() — that's legacy)
    let ufvk: UnifiedFullViewingKey = usk.to_unified_full_viewing_key();

    // Encode to ZIP-316 bech32m string based on keyType
    // "full"     -> uview1... (mainnet) — satisfies VIEW-02 + VIEW-03
    // "incoming" -> uivk1...  (mainnet) — satisfies VIEW-01
    // Uses Network::MainNetwork/TestNetwork which implement Parameters (NOT NetworkType)
    let encoded = match key_type.as_str() {
        "full"     => ufvk.encode(&consensus_network),
        "incoming" => ufvk.to_unified_incoming_viewing_key().encode(&consensus_network),
        _ => return cx.throw_error("Invalid keyType: use 'incoming' or 'full'"),
    };

    Ok(cx.string(&encoded))
}

/// Scan compact blocks for notes belonging to this wallet.
///
/// Args:
///   0: passphrase (JsString)
///   1: encryptedSeed hex (JsString)
///   2: salt hex (JsString)
///   3: nonce hex (JsString)
///   4: network (JsString) - "mainnet" or "testnet"
///   5: compactBlocksJson (JsString) - JSON array of CompactBlockData
///   6: knownNullifiersJson (JsString) - JSON array of hex nullifiers (already spent)
///
/// Returns: JSON string with { notes: ScannedNote[], spentNullifiers: string[] }
fn scan_notes(mut cx: FunctionContext) -> JsResult<JsString> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let enc_seed_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex = cx.argument::<JsString>(3)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(4)?.value(&mut cx);
    let blocks_json = cx.argument::<JsString>(5)?.value(&mut cx);
    let known_nullifiers_json = cx.argument::<JsString>(6)?.value(&mut cx);

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Decrypt seed
    let mut entropy = match decrypt_seed(&passphrase, &enc_seed_hex, &salt_hex, &nonce_hex) {
        Ok(e) => e,
        Err(msg) => return cx.throw_error(msg),
    };

    // Derive keys
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(k) => k,
        Err(e) => {
            entropy.iter_mut().for_each(|b| *b = 0);
            return cx.throw_error(format!("Key derivation failed: {:?}", e));
        }
    };
    entropy.iter_mut().for_each(|b| *b = 0);

    let sapling_esk = usk.sapling();
    let sapling_fvk = sapling_esk.to_diversifiable_full_viewing_key().fvk().clone();
    let sapling_ivk = sapling_fvk.vk.ivk();
    let prepared_ivk = PreparedIncomingViewingKey::new(&sapling_ivk);
    let sapling_nk = sapling_fvk.vk.nk;

    // Determine ZIP-212 enforcement based on network height
    // Post-Canopy (height > 1046400 mainnet, > 903800 testnet) = On
    let zip212 = Zip212Enforcement::On;

    // Parse compact blocks from JS
    let blocks: Vec<CompactBlockData> = match serde_json::from_str(&blocks_json) {
        Ok(b) => b,
        Err(e) => return cx.throw_error(format!("Invalid blocks JSON: {}", e)),
    };

    // Parse known nullifiers (already spent notes)
    let known_nullifiers: Vec<String> = match serde_json::from_str(&known_nullifiers_json) {
        Ok(n) => n,
        Err(e) => return cx.throw_error(format!("Invalid nullifiers JSON: {}", e)),
    };

    let mut found_notes: Vec<ScannedNote> = Vec::new();
    let mut spent_nullifiers: Vec<String> = Vec::new();
    let mut note_position: u64 = 0;

    for block in &blocks {
        // Collect all spend nullifiers in this block
        for tx in &block.txs {
            for nf_hex in &tx.spends {
                spent_nullifiers.push(nf_hex.clone());
            }
        }

        // Scan outputs for notes addressed to us
        for tx in &block.txs {
            for output in &tx.outputs {
                // Parse compact output fields
                let cmu_bytes = match hex::decode(&output.cmu) {
                    Ok(b) if b.len() == 32 => {
                        let mut arr = [0u8; 32];
                        arr.copy_from_slice(&b);
                        arr
                    }
                    _ => { note_position += 1; continue; }
                };
                let epk_bytes = match hex::decode(&output.ephemeral_key) {
                    Ok(b) if b.len() == 32 => {
                        let mut arr = [0u8; 32];
                        arr.copy_from_slice(&b);
                        arr
                    }
                    _ => { note_position += 1; continue; }
                };
                let enc_ct = match hex::decode(&output.ciphertext) {
                    Ok(b) if b.len() == 52 => {
                        let mut arr = [0u8; 52];
                        arr.copy_from_slice(&b);
                        arr
                    }
                    _ => { note_position += 1; continue; }
                };

                // Build CompactOutputDescription for trial decryption
                let cmu = match ExtractedNoteCommitment::from_bytes(&cmu_bytes).into() {
                    Some(c) => c,
                    None => { note_position += 1; continue; }
                };

                let compact_output = CompactOutputDescription {
                    ephemeral_key: EphemeralKeyBytes(epk_bytes),
                    cmu,
                    enc_ciphertext: enc_ct,
                };

                // Trial decrypt
                if let Some((note, _addr)) = try_sapling_compact_note_decryption(
                    &prepared_ivk,
                    &compact_output,
                    zip212,
                ) {
                    // Compute nullifier for this note
                    let nf = note.nf(&sapling_nk, note_position);

                    // Get rseed bytes
                    let rseed_bytes = match note.rseed() {
                        Rseed::AfterZip212(bytes) => bytes.to_vec(),
                        Rseed::BeforeZip212(scalar) => {
                            // Convert jubjub scalar to bytes
                            let bytes: [u8; 32] = scalar.to_bytes();
                            bytes.to_vec()
                        }
                    };

                    found_notes.push(ScannedNote {
                        value: note.value().inner(),
                        recipient_hex: hex::encode(note.recipient().to_bytes()),
                        rseed_hex: hex::encode(&rseed_bytes),
                        position: note_position,
                        height: block.height,
                        nullifier_hex: hex::encode(nf.0),
                        merkle_path_hex: vec![], // Simplified — see note below
                    });
                }

                note_position += 1;
            }
        }
    }

    // Filter out spent notes
    let spent_set: std::collections::HashSet<&str> = spent_nullifiers.iter()
        .chain(known_nullifiers.iter())
        .map(|s| s.as_str())
        .collect();

    let unspent_notes: Vec<&ScannedNote> = found_notes.iter()
        .filter(|n| !spent_set.contains(n.nullifier_hex.as_str()))
        .collect();

    // Build result JSON
    let result = serde_json::json!({
        "notes": unspent_notes,
        "spentNullifiers": spent_nullifiers,
        "totalFound": found_notes.len(),
        "totalUnspent": unspent_notes.len(),
    });

    let result_str = match serde_json::to_string(&result) {
        Ok(s) => s,
        Err(e) => return cx.throw_error(format!("JSON serialization failed: {}", e)),
    };

    Ok(cx.string(&result_str))
}

/// Build and sign a shielded Sapling transaction.
///
/// Args:
///   0: passphrase (JsString)
///   1: encryptedSeed hex (JsString)
///   2: salt hex (JsString)
///   3: nonce hex (JsString)
///   4: network (JsString) - "mainnet" or "testnet"
///   5: toAddress (JsString) - destination Sapling address (zs1... or ztestsapling1...)
///   6: amountZatoshis (JsNumber) - amount to send in zatoshis
///   7: memo (JsString) - optional memo text (empty string = no memo)
///   8: targetHeight (JsNumber) - current chain height for tx expiry
///   9: spendParamsPath (JsString) - path to sapling-spend.params
///  10: outputParamsPath (JsString) - path to sapling-output.params
///  11: notesJson (JsString) - JSON array of ScannedNote with merkle_path_hex populated
///
/// Returns: { rawTx: hex, txId: hex }
fn create_transaction(mut cx: FunctionContext) -> JsResult<JsObject> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let enc_seed_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let salt_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    let nonce_hex = cx.argument::<JsString>(3)?.value(&mut cx);
    let network_str = cx.argument::<JsString>(4)?.value(&mut cx);
    let to_address_str = cx.argument::<JsString>(5)?.value(&mut cx);
    let amount_zat = cx.argument::<JsNumber>(6)?.value(&mut cx) as u64;
    let memo_str = cx.argument::<JsString>(7)?.value(&mut cx);
    let target_height = cx.argument::<JsNumber>(8)?.value(&mut cx) as u32;
    let spend_params_path = cx.argument::<JsString>(9)?.value(&mut cx);
    let output_params_path = cx.argument::<JsString>(10)?.value(&mut cx);
    let notes_json = cx.argument::<JsString>(11)?.value(&mut cx);

    let consensus_network = match network_str.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return cx.throw_error("Invalid network: use 'mainnet' or 'testnet'"),
    };

    // Decrypt seed
    let mut entropy = match decrypt_seed(&passphrase, &enc_seed_hex, &salt_hex, &nonce_hex) {
        Ok(e) => e,
        Err(msg) => return cx.throw_error(msg),
    };

    // Derive spending key
    let usk = match UnifiedSpendingKey::from_seed(&consensus_network, &entropy, AccountId::ZERO) {
        Ok(k) => k,
        Err(e) => {
            entropy.iter_mut().for_each(|b| *b = 0);
            return cx.throw_error(format!("Key derivation failed: {:?}", e));
        }
    };
    entropy.iter_mut().for_each(|b| *b = 0);

    let sapling_esk = usk.sapling();
    let sapling_dfvk = sapling_esk.to_diversifiable_full_viewing_key();
    let sapling_fvk = sapling_dfvk.fvk().clone();
    let sapling_ovk = sapling_fvk.ovk;

    // Parse destination Sapling payment address using TryFromAddress
    struct SaplingAddrExtractor(SaplingPaymentAddress);
    impl TryFromAddress for SaplingAddrExtractor {
        type Error = String;
        fn try_from_sapling(
            _net: NetworkType,
            data: [u8; 43],
        ) -> Result<Self, zcash_address::ConversionError<Self::Error>> {
            match SaplingPaymentAddress::from_bytes(&data) {
                Some(pa) => Ok(SaplingAddrExtractor(pa)),
                None => Err(zcash_address::ConversionError::User("Invalid Sapling address bytes".to_string())),
            }
        }
    }

    let dest_payment_address = match ZcashAddress::try_from_encoded(&to_address_str) {
        Ok(addr) => match addr.convert::<SaplingAddrExtractor>() {
            Ok(ext) => ext.0,
            Err(_) => return cx.throw_error("Destination must be a Sapling shielded address (zs1...)"),
        },
        Err(e) => return cx.throw_error(format!("Invalid destination address: {}", e)),
    };

    // Parse amount
    let amount = match Zatoshis::from_u64(amount_zat) {
        Ok(a) => a,
        Err(_) => return cx.throw_error("Invalid amount"),
    };

    // Parse memo
    let memo = if memo_str.is_empty() {
        MemoBytes::empty()
    } else {
        let mut memo_bytes = [0u8; 512];
        let text_bytes = memo_str.as_bytes();
        if text_bytes.len() > 511 {
            return cx.throw_error("Memo too long (max 511 bytes)");
        }
        // UTF-8 text memo: first byte 0xF6 indicates text, rest is the text
        memo_bytes[0] = 0xF6;
        memo_bytes[1..1 + text_bytes.len()].copy_from_slice(text_bytes);
        match MemoBytes::from_bytes(&memo_bytes) {
            Ok(m) => m,
            Err(e) => return cx.throw_error(format!("Invalid memo: {:?}", e)),
        }
    };

    // Load proving parameters
    let prover = LocalTxProver::new(
        std::path::Path::new(&spend_params_path),
        std::path::Path::new(&output_params_path),
    );

    // Parse input notes
    let input_notes: Vec<ScannedNote> = match serde_json::from_str(&notes_json) {
        Ok(n) => n,
        Err(e) => return cx.throw_error(format!("Invalid notes JSON: {}", e)),
    };

    if input_notes.is_empty() {
        return cx.throw_error("No spendable notes provided");
    }

    // Calculate total input value
    let total_input: u64 = input_notes.iter().map(|n| n.value).sum();
    let fee: u64 = 10000; // 0.0001 ZEC standard fee

    if total_input < amount_zat + fee {
        return cx.throw_error(format!(
            "Insufficient funds: have {} zatoshis, need {} (amount) + {} (fee) = {}",
            total_input, amount_zat, fee, amount_zat + fee
        ));
    }

    let change_amount = total_input - amount_zat - fee;

    // Build transaction
    let height = BlockHeight::from_u32(target_height);

    // Use empty tree anchor for now — simplified approach
    // A full implementation would use the actual Sapling anchor from GetTreeState
    // Use empty tree anchor — real implementation needs anchor from GetTreeState
    let sapling_anchor = sapling_crypto::Anchor::empty_tree();

    let build_config = BuildConfig::Standard {
        sapling_anchor: Some(sapling_anchor),
        orchard_anchor: None,
    };

    let mut builder = Builder::new(consensus_network, height, build_config);

    // Add Sapling spends (input notes)
    for note_data in &input_notes {
        let recipient_bytes = match hex::decode(&note_data.recipient_hex) {
            Ok(b) if b.len() == 43 => {
                let mut arr = [0u8; 43];
                arr.copy_from_slice(&b);
                arr
            }
            _ => return cx.throw_error("Invalid note recipient bytes"),
        };
        let recipient = match SaplingPaymentAddress::from_bytes(&recipient_bytes) {
            Some(pa) => pa,
            None => return cx.throw_error("Invalid note payment address"),
        };

        let rseed_bytes = match hex::decode(&note_data.rseed_hex) {
            Ok(b) if b.len() == 32 => {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&b);
                arr
            }
            _ => return cx.throw_error("Invalid note rseed bytes"),
        };
        let rseed = Rseed::AfterZip212(rseed_bytes);

        let note_value = NoteValue::from_raw(note_data.value);
        let note = recipient.create_note(note_value, rseed);

        // Parse merkle path from the note data
        // For production use, these come from the commitment tree witness
        let merkle_path_nodes: Vec<sapling_crypto::Node> = note_data.merkle_path_hex.iter()
            .filter_map(|h| {
                let bytes = hex::decode(h).ok()?;
                if bytes.len() != 32 { return None; }
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                sapling_crypto::Node::from_bytes(arr).into()
            })
            .collect();

        let merkle_path = match sapling_crypto::MerklePath::from_parts(
            merkle_path_nodes,
            note_data.position.into(),
        ) {
            Ok(mp) => mp,
            Err(_) => return cx.throw_error(format!(
                "Invalid merkle path for note at position {}. Ensure block scanning included witness data.",
                note_data.position
            )),
        };

        if let Err(e) = builder.add_sapling_spend::<std::convert::Infallible>(
            sapling_fvk.clone(),
            note,
            merkle_path,
        ) {
            return cx.throw_error(format!("Failed to add Sapling spend: {}", e));
        }
    }

    // Add destination output
    if let Err(e) = builder.add_sapling_output::<std::convert::Infallible>(
        Some(sapling_ovk.clone()),
        dest_payment_address,
        amount,
        memo,
    ) {
        return cx.throw_error(format!("Failed to add Sapling output: {}", e));
    }

    // Add change output if needed
    if change_amount > 0 {
        let (_div_idx, change_address) = sapling_esk.default_address();
        let change_zat = match Zatoshis::from_u64(change_amount) {
            Ok(z) => z,
            Err(_) => return cx.throw_error("Invalid change amount"),
        };
        if let Err(e) = builder.add_sapling_output::<std::convert::Infallible>(
            Some(sapling_ovk.clone()),
            change_address,
            change_zat,
            MemoBytes::empty(),
        ) {
            return cx.throw_error(format!("Failed to add change output: {}", e));
        }
    }

    // Build and sign the transaction
    let fee_zat = match Zatoshis::from_u64(fee) {
        Ok(z) => z,
        Err(_) => return cx.throw_error("Invalid fee amount"),
    };
    let fee_rule = FixedFeeRule::non_standard(fee_zat);
    let transparent_signing_set = TransparentSigningSet::new();

    let build_result = match builder.build(
        &transparent_signing_set,
        &[sapling_esk.clone()],
        &[],
        &mut OsRng,
        &prover,
        &prover,
        &fee_rule,
    ) {
        Ok(r) => r,
        Err(e) => return cx.throw_error(format!("Transaction build failed: {}", e)),
    };

    // Serialize the transaction
    let tx = build_result.transaction();
    let mut raw_tx = Vec::new();
    if let Err(e) = tx.write(&mut raw_tx) {
        return cx.throw_error(format!("Transaction serialization failed: {}", e));
    }

    let txid = tx.txid();

    // Build result object
    let result = cx.empty_object();
    let js_raw_tx = cx.string(hex::encode(&raw_tx));
    result.set(&mut cx, "rawTx", js_raw_tx)?;
    let js_txid = cx.string(format!("{}", txid));
    result.set(&mut cx, "txId", js_txid)?;
    let js_fee = cx.number(fee as f64);
    result.set(&mut cx, "fee", js_fee)?;

    Ok(result)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("generateShieldedAddress", generate_shielded_address)?;
    cx.export_function("validateAddress", validate_address)?;
    cx.export_function("createWallet", create_wallet)?;
    cx.export_function("loadWallet", load_wallet)?;
    cx.export_function("deriveViewingKey", derive_viewing_key)?;
    cx.export_function("scanNotes", scan_notes)?;
    cx.export_function("createTransaction", create_transaction)?;
    Ok(())
}
