/**
 * Check Balance Skill (unified)
 *
 * Scans the blockchain via lightwalletd to find all shielded notes
 * belonging to the wallet and returns the spendable balance plus
 * transaction history.
 *
 * Uses two scanning backends:
 *   - native.scanBlocks (zcash_client_backend::scan_block) for accurate scanning
 *   - native.scanNotes (custom trial decryption) as fallback
 *
 * Architecture: crypto (trial decryption) in Rust, I/O (gRPC) in JS.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');
const LightwalletClient = require('../../lib/grpc-client');
const { TRANSACTION } = require('../../lib/constants');

const DEFAULT_WALLET_PATH = path.join(os.homedir(), '.zcashskills', 'wallet.json');
const DEFAULT_SERVER = 'zec.rocks:443';
const BATCH_SIZE = 10000;

/**
 * Load and validate wallet file from disk.
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

/**
 * Scan blocks using scanNotes (custom trial decryption with nullifier tracking).
 * Handles full chain scan with batching — no block count limit.
 * @private
 */
async function _scanWithNotes(grpcClient, walletJson, passphrase, startHeight, endHeight) {
    let allNotes = [];
    let allSpentNullifiers = [];

    for (let h = startHeight; h <= endHeight; h += BATCH_SIZE) {
        const batchEnd = Math.min(h + BATCH_SIZE - 1, endHeight);
        const pct = Math.round(((h - startHeight) / (endHeight - startHeight)) * 100);
        process.stdout.write(`  Scanning ${h}-${batchEnd} (${pct}%)...\r`);

        let blocks;
        try {
            blocks = await grpcClient.getCompactBlocks(h, batchEnd);
        } catch (e) {
            console.log(`\n  gRPC error at ${h}: ${e.message.substring(0, 80)}`);
            continue;
        }

        const blockDataArray = blocks.map(block => ({
            height: parseInt(block.height, 10),
            txs: (block.vtx || []).map(tx => ({
                outputs: (tx.outputs || []).map(out => ({
                    cmu: Buffer.from(out.cmu).toString('hex'),
                    ephemeral_key: Buffer.from(out.ephemeralKey || out.ephemeral_key || '').toString('hex'),
                    ciphertext: Buffer.from(out.ciphertext).toString('hex'),
                })),
                spends: (tx.spends || []).map(sp =>
                    Buffer.from(sp.nf).toString('hex')
                ),
            })),
        }));

        if (blockDataArray.length === 0) continue;

        const scanResultJson = native.scanNotes(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            JSON.stringify(blockDataArray),
            JSON.stringify(allSpentNullifiers)
        );

        const scanResult = JSON.parse(scanResultJson);
        if (scanResult.notes && scanResult.notes.length > 0) {
            allNotes.push(...scanResult.notes);
            console.log(`\n  Found ${scanResult.notes.length} note(s) in blocks ${h}-${batchEnd}`);
        }
        if (scanResult.spentNullifiers) {
            allSpentNullifiers.push(...scanResult.spentNullifiers);
        }
    }

    // Filter out spent notes
    const spentSet = new Set(allSpentNullifiers);
    const unspentNotes = allNotes.filter(n => !spentSet.has(n.nullifier_hex));

    return { allNotes, unspentNotes, spentNullifiers: allSpentNullifiers };
}

/**
 * Scan blocks using scanBlocks (zcash_client_backend::scan_block).
 * Requires lib/lightwalletd.js and passes raw protobuf bytes to Rust.
 * Limited to 10k blocks per call but more accurate.
 * @private
 */
async function _scanWithBlocks(walletJson, passphrase, lightwalletdUrl, startHeight, endHeight, insecure) {
    const { createClient, getLatestBlock, fetchBlocksAsProtoBytes } = require('../../lib/lightwalletd');
    const resolvedNetwork = walletJson.network;

    // Derive UFVK for scan_block (requires full viewing key)
    const ufvk = native.deriveViewingKey(
        passphrase,
        walletJson.encryptedSeed,
        walletJson.salt,
        walletJson.nonce,
        resolvedNetwork,
        'full'
    );

    const client = createClient(lightwalletdUrl, { insecure });
    let totalZatoshis = 0;
    const transactions = [];

    // Batch in 10k block chunks
    for (let h = startHeight; h <= endHeight; h += BATCH_SIZE) {
        const batchEnd = Math.min(h + BATCH_SIZE - 1, endHeight);
        const pct = Math.round(((h - startHeight) / (endHeight - startHeight)) * 100);
        process.stdout.write(`  Scanning ${h}-${batchEnd} (${pct}%)...\r`);

        const blockBuffers = await fetchBlocksAsProtoBytes(client, h, batchEnd);
        const scanResult = native.scanBlocks(ufvk, resolvedNetwork, blockBuffers);

        const batchZat = BigInt(scanResult.confirmedZatoshis);
        totalZatoshis += Number(batchZat);

        const batchTxns = JSON.parse(scanResult.transactionsJson || '[]');
        if (batchTxns.length > 0) {
            transactions.push(...batchTxns);
            console.log(`\n  Found ${batchTxns.length} transaction(s) in blocks ${h}-${batchEnd}`);
        }
    }

    return { totalZatoshis, transactions };
}

/**
 * Check the shielded balance of the local wallet.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Wallet passphrase
 * @param {string} [params.network='mainnet'] - 'mainnet' or 'testnet'
 * @param {string} [params.walletPath] - Path to wallet JSON
 * @param {string} [params.serverUrl] - Override lightwalletd server URL
 * @param {boolean} [params.insecure=false] - Use insecure gRPC (local dev only)
 * @returns {Promise<Object>} { success, balance, balanceZatoshis, address, notes, transactions, network }
 */
async function checkBalance({
    passphrase,
    network = 'mainnet',
    walletPath = DEFAULT_WALLET_PATH,
    serverUrl,
    insecure = false
} = {}) {
    let grpcClient = null;

    try {
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }

        // Load wallet
        console.log('Loading wallet...');
        const walletJson = _loadWalletFile(walletPath);

        // Verify passphrase
        const loadResult = native.loadWallet(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network
        );
        console.log(`Wallet loaded: ${loadResult.address.substring(0, 20)}...`);

        // Determine scan range
        let birthdayHeight = walletJson.birthdayHeight;
        if (!birthdayHeight || birthdayHeight <= 0) {
            birthdayHeight = 2750000; // conservative mainnet default
        }

        // Connect to lightwalletd
        const server = serverUrl || DEFAULT_SERVER;
        console.log(`Connecting to lightwalletd (${server})...`);
        grpcClient = new LightwalletClient(network, server);

        const latest = await grpcClient.getLatestBlock();
        const endHeight = latest.height;
        console.log(`Chain tip: ${endHeight}`);
        console.log(`Scanning ${endHeight - birthdayHeight} blocks...`);

        // Choose scanning backend
        const hasScanNotes = typeof native.scanNotes === 'function';
        const hasScanBlocks = typeof native.scanBlocks === 'function';

        let balance, balanceZatoshis, noteDetails, transactions;

        if (hasScanNotes) {
            // Preferred: scanNotes with full nullifier tracking
            const { unspentNotes } = await _scanWithNotes(
                grpcClient, walletJson, passphrase, birthdayHeight, endHeight
            );

            balanceZatoshis = unspentNotes.reduce((sum, n) => sum + n.value, 0);
            balance = balanceZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC;

            noteDetails = unspentNotes.map(n => ({
                value: n.value / TRANSACTION.ZATOSHIS_PER_ZEC,
                valueZatoshis: n.value,
                height: n.height,
            }));

            transactions = unspentNotes.map(n => ({
                blockHeight: n.height,
                valueZatoshis: String(n.value),
                valueZEC: (n.value / TRANSACTION.ZATOSHIS_PER_ZEC).toFixed(8),
            }));
        } else if (hasScanBlocks) {
            // Fallback: scanBlocks via zcash_client_backend
            const scanResult = await _scanWithBlocks(
                walletJson, passphrase, server, birthdayHeight, endHeight, insecure
            );

            balanceZatoshis = scanResult.totalZatoshis;
            balance = balanceZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC;
            noteDetails = [];
            transactions = scanResult.transactions;
        } else {
            throw new Error('No scanning function available — rebuild the native module with: npm run build');
        }

        console.log('');
        console.log(`Balance: ${balance} ZEC (${balanceZatoshis} zatoshis)`);

        return {
            success: true,
            balance,
            balanceZEC: balance.toFixed(8),
            balanceZatoshis,
            confirmedZatoshis: String(balanceZatoshis),
            spendableZatoshis: String(balanceZatoshis),
            address: loadResult.address,
            network: walletJson.network,
            notes: noteDetails,
            transactions,
            blockHeight: endHeight,
            scannedFrom: birthdayHeight,
            scannedBlocks: endHeight - birthdayHeight,
            timestamp: new Date().toISOString()
        };

    } catch (err) {
        console.error(`Balance check failed: ${err.message}`);
        return {
            success: false,
            error: err.message,
            code: 'BALANCE_ERROR'
        };
    } finally {
        if (grpcClient) {
            grpcClient.close();
        }
    }
}

checkBalance.meta = {
    name: 'check-balance',
    description: 'Check shielded ZCash wallet balance by scanning the blockchain via lightwalletd',
    version: '2.0.0',
    execution: 'network',
    privacy: 'shielded-only'
};

module.exports = checkBalance;
module.exports.checkBalance = checkBalance;
