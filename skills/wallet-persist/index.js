/**
 * Wallet Persist Skill
 *
 * Creates and loads encrypted ZCash wallets. All cryptographic operations
 * (key derivation, encryption, decryption) happen inside Rust via the
 * native module. This skill owns filesystem I/O only.
 *
 * Security invariant: The raw seed never crosses the FFI boundary as plaintext.
 * JS receives only: encryptedSeed, salt, nonce, address, mnemonic (one-time).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');
const { SAPLING_ACTIVATION } = require('../../lib/constants');

const DEFAULT_WALLET_DIR = path.join(os.homedir(), '.zcashskills');
const DEFAULT_WALLET_PATH = path.join(DEFAULT_WALLET_DIR, 'wallet.json');

/**
 * Create a new encrypted ZCash wallet and write it to disk.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Passphrase for seed encryption (min 8 chars)
 * @param {string} [params.network='mainnet'] - 'mainnet' or 'testnet'
 * @param {string} [params.walletPath] - Path to write wallet JSON (default: ~/.zcashskills/wallet.json)
 * @param {number} [params.birthdayHeight] - Block height at wallet creation (default: conservative hardcoded value)
 * @returns {Promise<Object>} { success, address, mnemonic, walletPath, network, birthdayHeight, message }
 */
async function createWallet({ passphrase, network = 'mainnet', walletPath = DEFAULT_WALLET_PATH, birthdayHeight } = {}) {
    try {
        // Input validation — surface errors early before calling Rust
        if (!passphrase || passphrase.length < 8) {
            throw new Error('Passphrase must be at least 8 characters');
        }
        const validNetworks = ['mainnet', 'testnet'];
        if (!validNetworks.includes(network)) {
            throw new Error(`Invalid network: ${network}. Must be one of: ${validNetworks.join(', ')}`);
        }

        // Guard: validate native has createWallet — don't crash if binary is from prior build
        if (typeof native.createWallet !== 'function') {
            throw new Error('native.createWallet not found — rebuild the native module with: npm run build');
        }

        // All crypto happens in Rust — passphrase and network are the only inputs
        const rustResult = native.createWallet(passphrase, network);

        // Determine birthday height (WALL-03)
        // Use provided value, fall back to hardcoded safe conservative default.
        // Phase 3 will query the live chain tip via lightwalletd.
        const resolvedBirthdayHeight = birthdayHeight || SAPLING_ACTIVATION[network] || SAPLING_ACTIVATION.mainnet;

        // Build wallet JSON — JS owns file format, Rust owns encrypted blobs
        const walletJson = {
            version: 1,
            network,
            address: rustResult.address,
            encryptedSeed: rustResult.encryptedSeed,
            salt: rustResult.salt,
            nonce: rustResult.nonce,
            kdf: {
                algorithm: 'argon2id',
                version: 19,
                m_cost: 19456,
                t_cost: 2,
                p_cost: 1
            },
            cipher: 'xchacha20poly1305',
            birthdayHeight: resolvedBirthdayHeight,
            createdAt: new Date().toISOString()
        };

        // Write wallet to disk — create parent directory if needed
        const walletDir = path.dirname(walletPath);
        fs.mkdirSync(walletDir, { recursive: true });
        fs.writeFileSync(walletPath, JSON.stringify(walletJson, null, 2), { encoding: 'utf8' });

        // Set restrictive permissions immediately after write (security requirement)
        fs.chmodSync(walletPath, 0o600);

        return {
            success: true,
            address: rustResult.address,
            mnemonic: rustResult.mnemonic,  // Returned ONCE — user must write this down
            walletPath,
            network,
            birthdayHeight: resolvedBirthdayHeight,
            message: 'Wallet created successfully. Write down your mnemonic phrase — it will not be shown again.'
        };

    } catch (err) {
        return {
            success: false,
            error: err.message,
            code: 'CREATE_WALLET_ERROR'
        };
    }
}

/**
 * Load and unlock an existing encrypted ZCash wallet.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Passphrase to decrypt the wallet
 * @param {string} [params.walletPath] - Path to wallet JSON (default: ~/.zcashskills/wallet.json)
 * @returns {Promise<Object>} { success, address, network, birthdayHeight, createdAt }
 */
async function loadWallet({ passphrase, walletPath = DEFAULT_WALLET_PATH } = {}) {
    try {
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }

        if (typeof native.loadWallet !== 'function') {
            throw new Error('native.loadWallet not found — rebuild the native module with: npm run build');
        }

        // Read wallet JSON from disk — JS owns filesystem I/O
        let walletJson;
        try {
            walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        } catch (fsErr) {
            throw new Error(`Cannot read wallet file at ${walletPath}: ${fsErr.message}`);
        }

        // Validate wallet file has required fields before calling Rust
        const requiredFields = ['encryptedSeed', 'salt', 'nonce', 'network'];
        for (const field of requiredFields) {
            if (!walletJson[field]) {
                throw new Error(`Wallet file missing required field: ${field}`);
            }
        }

        // Decrypt and re-derive address — all crypto in Rust
        // Wrong passphrase causes Rust to throw "Decryption failed" JS error (caught below)
        const rustResult = native.loadWallet(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network
        );

        return {
            success: true,
            address: rustResult.address,
            network: walletJson.network,
            birthdayHeight: walletJson.birthdayHeight,
            createdAt: walletJson.createdAt
        };

    } catch (err) {
        return {
            success: false,
            error: err.message,
            code: 'LOAD_WALLET_ERROR'
        };
    }
}

// Skill metadata for discovery (matches pattern in skills/generate-address/index.js)
createWallet.meta = {
    name: 'wallet-persist-create',
    description: 'Create a new ZCash wallet with encrypted seed persistence (Argon2id + XChaCha20-Poly1305)',
    version: '1.0.0',
    execution: 'local',
    privacy: 'shielded-only'
};

loadWallet.meta = {
    name: 'wallet-persist-load',
    description: 'Load and unlock an existing encrypted ZCash wallet',
    version: '1.0.0',
    execution: 'local',
    privacy: 'shielded-only'
};

module.exports = { createWallet, loadWallet };
module.exports.createWallet = createWallet;
module.exports.loadWallet = loadWallet;
