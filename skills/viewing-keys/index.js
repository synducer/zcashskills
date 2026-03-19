/**
 * Viewing Keys Skill
 *
 * Derives and exports ZIP-316 bech32m viewing keys from an encrypted wallet.
 * All cryptographic operations (seed decryption, key derivation, encoding)
 * happen inside Rust via the native module. This skill owns filesystem I/O only.
 *
 * VIEW-01: getIncomingViewingKey — privacy-safe default (reveals only inbound txs)
 * VIEW-02: getFullViewingKey with confirm: true — exposes outgoing transaction graph
 * VIEW-03: getFullViewingKey returns ZIP-316 UFVK encoded as uview1... per ZIP-316
 *
 * Security invariant: The raw seed never crosses the FFI boundary as plaintext.
 * The encoded viewing key string is the only key material returned to JS.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');

const DEFAULT_WALLET_PATH = path.join(os.homedir(), '.zcashskills', 'wallet.json');

/**
 * Export the Incoming Viewing Key (UIVK) for selective disclosure.
 * Safe default — exposes only inbound transaction history.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Passphrase to decrypt the wallet
 * @param {string} [params.walletPath] - Path to wallet JSON (default: ~/.zcashskills/wallet.json)
 * @returns {Promise<Object>} { success, viewingKey, keyType, network } or { success: false, error, code }
 */
async function getIncomingViewingKey({ passphrase, walletPath = DEFAULT_WALLET_PATH } = {}) {
    try {
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }

        if (typeof native.deriveViewingKey !== 'function') {
            throw new Error('native.deriveViewingKey not found — rebuild the native module with: npm run build');
        }

        const walletJson = _loadWalletFile(walletPath);

        const viewingKey = native.deriveViewingKey(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            'incoming'
        );

        return {
            success: true,
            viewingKey,
            keyType: 'incoming',
            network: walletJson.network
        };
    } catch (err) {
        return {
            success: false,
            error: err.message,
            code: 'IVK_ERROR'
        };
    }
}

/**
 * Export the Full Viewing Key / Unified Full Viewing Key (UFVK) per ZIP-316.
 * Requires explicit opt-in: pass { confirm: true } to proceed.
 *
 * WARNING: The FVK exposes your outgoing transaction graph (who you paid and when).
 * Only share with trusted auditors.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Passphrase to decrypt the wallet
 * @param {string} [params.walletPath] - Path to wallet JSON (default: ~/.zcashskills/wallet.json)
 * @param {boolean} [params.confirm] - Must be true to proceed (VIEW-02 explicit opt-in)
 * @returns {Promise<Object>} { success, viewingKey, keyType, network } or { success: false, error, code }
 */
async function getFullViewingKey({ passphrase, walletPath = DEFAULT_WALLET_PATH, confirm } = {}) {
    // VIEW-02: Explicit opt-in gate — FVK exposes outgoing transaction graph
    if (!confirm) {
        return {
            success: false,
            error: 'Full viewing key export exposes your outgoing transaction graph. Pass { confirm: true } to proceed.',
            code: 'FVK_CONFIRMATION_REQUIRED'
        };
    }

    try {
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }

        if (typeof native.deriveViewingKey !== 'function') {
            throw new Error('native.deriveViewingKey not found — rebuild the native module with: npm run build');
        }

        const walletJson = _loadWalletFile(walletPath);

        // keyType 'full' -> UFVK encoded as uview1... (satisfies VIEW-02 + VIEW-03)
        const viewingKey = native.deriveViewingKey(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            'full'
        );

        return {
            success: true,
            viewingKey,
            keyType: 'full',
            network: walletJson.network
        };
    } catch (err) {
        return {
            success: false,
            error: err.message,
            code: 'FVK_ERROR'
        };
    }
}

/**
 * Read and validate wallet JSON from disk.
 * Throws on missing file or missing required fields.
 * @private
 */
function _loadWalletFile(walletPath) {
    let walletJson;
    try {
        walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    } catch (fsErr) {
        throw new Error(`Cannot read wallet file at ${walletPath}: ${fsErr.message}`);
    }
    const requiredFields = ['encryptedSeed', 'salt', 'nonce', 'network'];
    for (const field of requiredFields) {
        if (!walletJson[field]) {
            throw new Error(`Wallet file missing required field: ${field}`);
        }
    }
    return walletJson;
}

getIncomingViewingKey.meta = {
    name: 'viewing-keys-incoming',
    description: 'Export Incoming Viewing Key (UIVK) for selective disclosure — reveals only inbound transactions',
    version: '1.0.0',
    execution: 'local',
    privacy: 'shielded-only'
};

getFullViewingKey.meta = {
    name: 'viewing-keys-full',
    description: 'Export Full Viewing Key / UFVK per ZIP-316 — requires explicit opt-in, exposes outgoing transaction graph',
    version: '1.0.0',
    execution: 'local',
    privacy: 'shielded-only'
};

module.exports = { getIncomingViewingKey, getFullViewingKey };
module.exports.getIncomingViewingKey = getIncomingViewingKey;
module.exports.getFullViewingKey = getFullViewingKey;
