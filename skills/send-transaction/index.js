/**
 * Send Transaction Skill
 *
 * Sends shielded ZCash from the local wallet to a destination Sapling address.
 * Handles the full pipeline:
 *   1. Load and decrypt the wallet
 *   2. Ensure Sapling proving parameters are cached
 *   3. Connect to lightwalletd and scan for spendable notes
 *   4. Build, sign, and broadcast the transaction via Rust native module
 *
 * Architecture: crypto in Rust (native module), I/O in JS (gRPC + filesystem).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');
const LightwalletClient = require('../../lib/grpc-client');
const { ensureParams } = require('../../lib/params-loader');
const { TRANSACTION, LIGHTWALLETD_SERVERS } = require('../../lib/constants');

const DEFAULT_WALLET_PATH = path.join(os.homedir(), '.zcashskills', 'wallet.json');

/**
 * Send shielded ZCash to a destination address.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Wallet passphrase
 * @param {string} params.toAddress - Destination Sapling address (zs1...)
 * @param {number} params.amount - Amount in ZEC (e.g. 0.5)
 * @param {string} [params.memo=''] - Optional memo text (max 511 bytes)
 * @param {string} [params.network='mainnet'] - 'mainnet' or 'testnet'
 * @param {string} [params.walletPath] - Path to wallet JSON
 * @param {string} [params.serverUrl] - Override lightwalletd server URL
 * @returns {Promise<Object>} { success, txId, amount, toAddress, fee, network, message }
 */
async function sendTransaction({
    passphrase,
    toAddress,
    amount,
    memo = '',
    network = 'mainnet',
    walletPath = DEFAULT_WALLET_PATH,
    serverUrl
} = {}) {
    let grpcClient = null;

    try {
        // ─── Input validation ───────────────────────────────────
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }
        if (!toAddress) {
            throw new Error('Destination address is required');
        }
        if (!amount || amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }

        const validNetworks = ['mainnet', 'testnet'];
        if (!validNetworks.includes(network)) {
            throw new Error(`Invalid network: ${network}. Must be one of: ${validNetworks.join(', ')}`);
        }

        // Guard: validate native has required functions
        if (typeof native.scanNotes !== 'function') {
            throw new Error('native.scanNotes not found — rebuild the native module with: npm run build');
        }
        if (typeof native.createTransaction !== 'function') {
            throw new Error('native.createTransaction not found — rebuild the native module with: npm run build');
        }

        // Validate destination address
        const addrResult = native.validateAddress(toAddress);
        if (!addrResult.valid) {
            throw new Error(`Invalid destination address: ${toAddress}`);
        }

        // Convert amount to zatoshis
        const amountZatoshis = Math.round(amount * TRANSACTION.ZATOSHIS_PER_ZEC);
        const feeZatoshis = TRANSACTION.DEFAULT_FEE_ZATOSHIS;

        if (amountZatoshis < 1) {
            throw new Error('Amount is too small (minimum 1 zatoshi)');
        }

        // ─── Load wallet ────────────────────────────────────────
        console.log('🔓 Loading wallet...');
        let walletJson;
        try {
            walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        } catch (fsErr) {
            throw new Error(`Cannot read wallet file at ${walletPath}: ${fsErr.message}`);
        }

        const requiredFields = ['encryptedSeed', 'salt', 'nonce', 'network', 'birthdayHeight'];
        for (const field of requiredFields) {
            if (!walletJson[field]) {
                throw new Error(`Wallet file missing required field: ${field}`);
            }
        }

        // Verify passphrase by loading wallet
        const loadResult = native.loadWallet(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network
        );
        console.log(`✅ Wallet loaded: ${loadResult.address.substring(0, 20)}...`);

        // ─── Ensure proving parameters ──────────────────────────
        console.log('📥 Checking Sapling proving parameters...');
        const params = await ensureParams();

        // ─── Connect to lightwalletd ────────────────────────────
        console.log(`🔗 Connecting to lightwalletd (${network})...`);
        grpcClient = new LightwalletClient(network, serverUrl);

        const latestBlock = await grpcClient.getLatestBlock();
        console.log(`📊 Chain height: ${latestBlock.height}`);

        // ─── Scan for spendable notes ───────────────────────────
        console.log('🔍 Scanning for spendable notes...');
        const startHeight = walletJson.birthdayHeight;
        const endHeight = latestBlock.height;
        const batchSize = TRANSACTION.BLOCK_SCAN_BATCH_SIZE;

        let allNotes = [];
        let allSpentNullifiers = [];

        for (let h = startHeight; h <= endHeight; h += batchSize) {
            const batchEnd = Math.min(h + batchSize - 1, endHeight);
            const progress = Math.round(((h - startHeight) / (endHeight - startHeight)) * 100);
            console.log(`  📦 Scanning blocks ${h}-${batchEnd} (${progress}%)...`);

            const blocks = await grpcClient.getCompactBlocks(h, batchEnd);

            // Convert gRPC blocks to the JSON format expected by Rust
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

            // Call Rust for trial decryption
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
            }
            if (scanResult.spentNullifiers && scanResult.spentNullifiers.length > 0) {
                allSpentNullifiers.push(...scanResult.spentNullifiers);
            }
        }

        // Filter out spent notes
        const spentSet = new Set(allSpentNullifiers);
        const spendableNotes = allNotes.filter(n => !spentSet.has(n.nullifier_hex));

        const totalBalance = spendableNotes.reduce((sum, n) => sum + n.value, 0);
        console.log(`💰 Found ${spendableNotes.length} spendable notes, total: ${totalBalance / TRANSACTION.ZATOSHIS_PER_ZEC} ZEC`);

        if (totalBalance < amountZatoshis + feeZatoshis) {
            throw new Error(
                `Insufficient funds: have ${totalBalance / TRANSACTION.ZATOSHIS_PER_ZEC} ZEC, ` +
                `need ${(amountZatoshis + feeZatoshis) / TRANSACTION.ZATOSHIS_PER_ZEC} ZEC ` +
                `(${amount} ZEC + ${feeZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC} ZEC fee)`
            );
        }

        // Select notes to spend (greedy: use notes until we have enough)
        let selectedValue = 0;
        const selectedNotes = [];
        for (const note of spendableNotes) {
            selectedNotes.push(note);
            selectedValue += note.value;
            if (selectedValue >= amountZatoshis + feeZatoshis) break;
        }

        // ─── Get tree state for witness computation ─────────────
        // For the merkle paths, we need the commitment tree state
        // This is a simplified approach — full implementation needs incremental witnesses
        console.log('🌳 Getting commitment tree state...');
        const treeState = await grpcClient.getTreeState(latestBlock.height);

        // ─── Build and sign transaction ─────────────────────────
        console.log('🔨 Building transaction...');
        console.log(`  To: ${toAddress.substring(0, 20)}...`);
        console.log(`  Amount: ${amount} ZEC (${amountZatoshis} zatoshis)`);
        console.log(`  Fee: ${feeZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC} ZEC`);

        const txResult = native.createTransaction(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network,
            toAddress,
            amountZatoshis,
            memo,
            latestBlock.height,
            params.spendPath,
            params.outputPath,
            JSON.stringify(selectedNotes)
        );

        // ─── Broadcast transaction ──────────────────────────────
        console.log('📡 Broadcasting transaction...');
        const rawTxBytes = Buffer.from(txResult.rawTx, 'hex');
        const sendResult = await grpcClient.sendTransaction(rawTxBytes);

        if (sendResult.errorCode && sendResult.errorCode !== 0) {
            throw new Error(`Broadcast failed: ${sendResult.errorMessage} (code: ${sendResult.errorCode})`);
        }

        console.log(`✅ Transaction sent! TxID: ${txResult.txId}`);

        return {
            success: true,
            txId: txResult.txId,
            rawTx: txResult.rawTx,
            amount,
            amountZatoshis,
            toAddress,
            fee: feeZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC,
            feeZatoshis,
            network,
            memo: memo || null,
            message: `Successfully sent ${amount} ZEC to ${toAddress.substring(0, 20)}...`,
            timestamp: new Date().toISOString()
        };

    } catch (err) {
        console.error(`❌ Send failed: ${err.message}`);
        return {
            success: false,
            error: err.message,
            code: 'SEND_TRANSACTION_ERROR',
            suggestions: [
                'Check that your passphrase is correct',
                'Verify the destination address is valid',
                'Ensure you have sufficient balance',
                'Check your network connection for lightwalletd',
                'Try rebuilding native modules: npm run build'
            ]
        };
    } finally {
        if (grpcClient) {
            grpcClient.close();
        }
    }
}

sendTransaction.meta = {
    name: 'send-transaction',
    description: 'Send shielded ZCash transaction via Sapling with Groth16 proving',
    version: '1.0.0',
    execution: 'network',
    privacy: 'shielded-only'
};

module.exports = sendTransaction;
module.exports.sendTransaction = sendTransaction;
