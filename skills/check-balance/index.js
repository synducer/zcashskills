/**
 * Check Balance Skill
 *
 * Scans the blockchain via lightwalletd to find all notes belonging to
 * the wallet, then returns the spendable balance.
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

/**
 * Check the shielded balance of the local wallet.
 *
 * @param {Object} params
 * @param {string} params.passphrase - Wallet passphrase
 * @param {string} [params.network='mainnet'] - 'mainnet' or 'testnet'
 * @param {string} [params.walletPath] - Path to wallet JSON
 * @param {string} [params.serverUrl] - Override lightwalletd server URL
 * @returns {Promise<Object>} { success, balance, balanceZatoshis, address, notes, network }
 */
async function checkBalance({
    passphrase,
    network = 'mainnet',
    walletPath = DEFAULT_WALLET_PATH,
    serverUrl
} = {}) {
    let grpcClient = null;

    try {
        if (!passphrase) {
            throw new Error('Passphrase is required');
        }

        if (typeof native.scanNotes !== 'function') {
            throw new Error('native.scanNotes not found — rebuild the native module with: npm run build');
        }

        // Load wallet
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

        // Verify passphrase
        const loadResult = native.loadWallet(
            passphrase,
            walletJson.encryptedSeed,
            walletJson.salt,
            walletJson.nonce,
            walletJson.network
        );
        console.log(`✅ Wallet loaded: ${loadResult.address.substring(0, 20)}...`);

        // Connect to lightwalletd
        const server = serverUrl || DEFAULT_SERVER;
        console.log(`🔗 Connecting to lightwalletd (${server})...`);
        grpcClient = new LightwalletClient(network, server);

        const latest = await grpcClient.getLatestBlock();
        console.log(`📊 Chain tip: ${latest.height}`);

        // Scan blocks
        const startHeight = walletJson.birthdayHeight;
        const endHeight = latest.height;
        const batchSize = 10000;

        let allNotes = [];
        let allSpentNullifiers = [];

        console.log(`🔍 Scanning ${endHeight - startHeight} blocks for transactions...`);

        for (let h = startHeight; h <= endHeight; h += batchSize) {
            const batchEnd = Math.min(h + batchSize - 1, endHeight);
            const pct = Math.round(((h - startHeight) / (endHeight - startHeight)) * 100);
            process.stdout.write(`  📦 Scanning ${h}-${batchEnd} (${pct}%)...\r`);

            let blocks;
            try {
                blocks = await grpcClient.getCompactBlocks(h, batchEnd);
            } catch (e) {
                console.log(`\n⚠️  gRPC error at ${h}: ${e.message.substring(0, 80)}`);
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
                console.log(`\n  💰 Found ${scanResult.notes.length} note(s) in blocks ${h}-${batchEnd}`);
            }
            if (scanResult.spentNullifiers) {
                allSpentNullifiers.push(...scanResult.spentNullifiers);
            }
        }

        console.log('');

        // Filter spent notes
        const spentSet = new Set(allSpentNullifiers);
        const unspentNotes = allNotes.filter(n => !spentSet.has(n.nullifier_hex));

        const totalZatoshis = unspentNotes.reduce((sum, n) => sum + n.value, 0);
        const totalZec = totalZatoshis / TRANSACTION.ZATOSHIS_PER_ZEC;

        // Build note details for the result
        const noteDetails = unspentNotes.map(n => ({
            value: n.value / TRANSACTION.ZATOSHIS_PER_ZEC,
            valueZatoshis: n.value,
            height: n.height,
        }));

        console.log(`✅ Balance: ${totalZec} ZEC (${unspentNotes.length} unspent note(s))`);

        return {
            success: true,
            balance: totalZec,
            balanceZatoshis: totalZatoshis,
            address: loadResult.address,
            network: walletJson.network,
            notes: noteDetails,
            notesTotal: allNotes.length,
            notesUnspent: unspentNotes.length,
            chainHeight: endHeight,
            scannedFrom: startHeight,
            timestamp: new Date().toISOString()
        };

    } catch (err) {
        console.error(`❌ Balance check failed: ${err.message}`);
        return {
            success: false,
            error: err.message,
            code: 'CHECK_BALANCE_ERROR'
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
    version: '1.0.0',
    execution: 'network',
    privacy: 'shielded-only'
};

module.exports = checkBalance;
module.exports.checkBalance = checkBalance;
