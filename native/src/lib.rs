use neon::prelude::*;
use rand::RngCore;
use rand::rngs::OsRng;
use zcash_address::{ToAddress, ZcashAddress};
use zcash_keys::keys::{UnifiedSpendingKey, UnifiedFullViewingKey};
use zcash_protocol::consensus::{Network, NetworkType};
use zip32::AccountId;
use argon2::Argon2;
use bip39::Mnemonic;
use chacha20poly1305::{XChaCha20Poly1305, XNonce, aead::{Aead, KeyInit}};

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

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("generateShieldedAddress", generate_shielded_address)?;
    cx.export_function("validateAddress", validate_address)?;
    cx.export_function("createWallet", create_wallet)?;
    cx.export_function("loadWallet", load_wallet)?;
    cx.export_function("deriveViewingKey", derive_viewing_key)?;
    Ok(())
}
