'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const native = require('../../lib/native-loader');
const { createClient, getLatestBlock, fetchBlocksAsProtoBytes } = require('../../lib/lightwalletd');

const DEFAULT_WALLET_PATH = path.join(os.homedir(), '.zcashskills', 'wallet.json');

/**
 * Check the shielded balance of a ZCash wallet by scanning compact blocks via lightwalletd.
 *
 * All Sapling note decryption happens inside Rust (scan_block via UFVK). JavaScript
 * handles only async gRPC streaming and result formatting.
 *
 * SYNC-01: Balance query runs compact block scanning in Rust using wallet IVK (embedded in UFVK)
 * SYNC-02: Returns separate confirmedZatoshis and spendableZatoshis
 *          v1 invariant: confirmedZatoshis === spendableZatoshis (no sends yet; no nullifier tracking)
 *
 * @param {Object} params
 * @param {string} params.lightwalletdUrl - lightwalletd endpoint, e.g. "zec.rocks:443"
 * @param {string} params.passphrase - Wallet passphrase for UFVK derivation
 * @param {string} [params.walletPath] - Path to wallet JSON (default: ~/.zcashskills/wallet.json)
 * @param {string} [params.network='mainnet'] - 'mainnet' or 'testnet'
 * @param {boolean} [params.insecure=false] - Use insecure gRPC credentials (local dev only)
 * @returns {Promise<Object>} Balance result object (see done criteria for shape)
 */
async function checkBalance({
  lightwalletdUrl,
  passphrase,
  walletPath = DEFAULT_WALLET_PATH,
  network = 'mainnet',
  insecure = false
} = {}) {
  try {
    // Input validation
    if (!lightwalletdUrl) {
      throw new Error('lightwalletdUrl is required (e.g. "zec.rocks:443")');
    }
    if (!passphrase) {
      throw new Error('Passphrase is required');
    }

    // Guard: required native functions must exist
    if (typeof native.deriveViewingKey !== 'function') {
      throw new Error('native.deriveViewingKey not found — rebuild the native module with: npm run build');
    }
    if (typeof native.scanBlocks !== 'function') {
      throw new Error('native.scanBlocks not found — rebuild the native module with: npm run build');
    }

    // Step 1: Read wallet file from disk
    let walletJson;
    try {
      walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    } catch (fsErr) {
      throw new Error(`Cannot read wallet file at ${walletPath}: ${fsErr.message}`);
    }

    // Validate required wallet fields
    const requiredFields = ['encryptedSeed', 'salt', 'nonce', 'network'];
    for (const field of requiredFields) {
      if (!walletJson[field]) {
        throw new Error(`Wallet file missing required field: ${field}`);
      }
    }

    // Use wallet's network if not overridden by caller
    const resolvedNetwork = walletJson.network || network;

    // Step 2: Derive UFVK from wallet (all crypto in Rust)
    // Must use keyType='full' — ScanningKeys::from_account_ufvks requires UFVK, not UIVK
    // UFVK (uview1...) contains the IVK internally — scan_block extracts it
    const ufvk = native.deriveViewingKey(
      passphrase,
      walletJson.encryptedSeed,
      walletJson.salt,
      walletJson.nonce,
      resolvedNetwork,
      'full'  // NOT 'incoming' — scanBlocks requires UFVK, not UIVK
    );

    // Step 3: Connect to lightwalletd and get current chain tip
    const client = createClient(lightwalletdUrl, { insecure });
    const tipHeight = await getLatestBlock(client);

    // Step 4: Determine scan range from wallet birthday height
    // RESEARCH.md Pitfall 7: birthdayHeight may be a placeholder from Phase 1.
    // If missing or 0, fall back to tip - 100 (safe for new wallets).
    let birthdayHeight = walletJson.birthdayHeight;
    if (!birthdayHeight || birthdayHeight <= 0) {
      birthdayHeight = Math.max(0, tipHeight - 100);
    }

    // Step 5: Fetch compact blocks as raw protobuf bytes
    // fetchBlocksAsProtoBytes handles the 10,000-block limit guard internally
    const blockBuffers = await fetchBlocksAsProtoBytes(client, birthdayHeight, tipHeight);

    // Step 6: Scan blocks in Rust — synchronous, no tokio
    // Returns { confirmedZatoshis: string, transactionsJson: string }
    const scanResult = native.scanBlocks(ufvk, resolvedNetwork, blockBuffers);

    const confirmedZatoshis = scanResult.confirmedZatoshis; // string (u64)
    const confirmedZatoshisBigInt = BigInt(confirmedZatoshis);

    // v1: spendable === confirmed (no nullifier tracking; Phase 3 is receive-only)
    // Phase 4 will add nullifier tracking to exclude spent notes
    const spendableZatoshis = confirmedZatoshis;

    const ZEC_PER_ZATOSHI = 100_000_000;
    const confirmedZEC = (Number(confirmedZatoshisBigInt) / ZEC_PER_ZATOSHI).toFixed(8);

    return {
      success: true,
      confirmedZatoshis,             // string — raw zatoshi amount (SYNC-02)
      confirmedZEC,                  // string — human-readable ZEC amount (e.g. "0.00123456")
      spendableZatoshis,             // string — v1: same as confirmedZatoshis (SYNC-02)
      spendableZEC: confirmedZEC,    // string — v1: same as confirmedZEC
      blockHeight: tipHeight,        // number — chain tip at time of scan
      scannedBlocks: blockBuffers.length,  // number — how many blocks were scanned
      birthdayHeight,                // number — scan start height used
      network: resolvedNetwork,
      // NOTE: transactionsJson available in scanResult but not exposed in v1 balance response
      // Phase 3 Plan 04 (memo retrieval) will use it for SYNC-03
    };

  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'BALANCE_ERROR'
    };
  }
}

checkBalance.meta = {
  name: 'balance-check',
  description: 'Query shielded ZCash balance via lightwalletd compact block scanning (note decryption in Rust)',
  version: '1.0.0',
  execution: 'local+network',
  privacy: 'shielded-only',
  requirements: ['SYNC-01', 'SYNC-02']
};

/**
 * Get transaction history with memo fields for a ZCash wallet.
 * Runs compact block scanning to find received transactions, then
 * fetches full transaction bytes and decrypts memos for each one.
 *
 * SYNC-03: Returns transaction history with memo field contents
 *
 * @param {Object} params - Same as checkBalance params
 * @returns {Promise<Object>} { success, transactions: [{ txid, blockHeight, valueZatoshis, valueZEC, memo }], blockHeight }
 */
async function getTransactionHistory({
  lightwalletdUrl,
  passphrase,
  walletPath = DEFAULT_WALLET_PATH,
  network = 'mainnet',
  insecure = false
} = {}) {
  try {
    if (!lightwalletdUrl) throw new Error('lightwalletdUrl is required');
    if (!passphrase) throw new Error('Passphrase is required');

    if (typeof native.deriveViewingKey !== 'function') {
      throw new Error('native.deriveViewingKey not found — rebuild native module');
    }
    if (typeof native.scanBlocks !== 'function') {
      throw new Error('native.scanBlocks not found — rebuild native module');
    }
    if (typeof native.decryptMemo !== 'function') {
      throw new Error('native.decryptMemo not found — rebuild native module');
    }

    // Read wallet file
    let walletJson;
    try {
      walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    } catch (fsErr) {
      throw new Error(`Cannot read wallet file at ${walletPath}: ${fsErr.message}`);
    }
    const requiredFields = ['encryptedSeed', 'salt', 'nonce', 'network'];
    for (const field of requiredFields) {
      if (!walletJson[field]) throw new Error(`Wallet file missing required field: ${field}`);
    }

    const resolvedNetwork = walletJson.network || network;

    // Derive UFVK (required for both scanning and memo decryption)
    const ufvk = native.deriveViewingKey(
      passphrase,
      walletJson.encryptedSeed,
      walletJson.salt,
      walletJson.nonce,
      resolvedNetwork,
      'full'
    );

    // Connect and get tip height
    const { createClient: _createClient, getLatestBlock: _getLatestBlock,
            fetchBlocksAsProtoBytes: _fetchBlocksAsProtoBytes,
            getTransaction: _getTransaction } = require('../../lib/lightwalletd');

    const client = _createClient(lightwalletdUrl, { insecure });
    const tipHeight = await _getLatestBlock(client);

    let birthdayHeight = walletJson.birthdayHeight;
    if (!birthdayHeight || birthdayHeight <= 0) {
      birthdayHeight = Math.max(0, tipHeight - 100);
    }

    // Scan compact blocks — get txids and values
    const blockBuffers = await _fetchBlocksAsProtoBytes(client, birthdayHeight, tipHeight);
    const scanResult = native.scanBlocks(ufvk, resolvedNetwork, blockBuffers);
    const rawTransactions = JSON.parse(scanResult.transactionsJson || '[]');

    // For each found transaction, fetch full tx bytes and decrypt memo
    const ZEC_PER_ZATOSHI = 100_000_000;
    const transactions = [];

    for (const rawTx of rawTransactions) {
      let memo = null;
      try {
        const rawTxBytes = await _getTransaction(client, rawTx.txid);
        const rawTxHex = rawTxBytes.toString('hex');
        const decryptedMemo = native.decryptMemo(rawTxHex, ufvk, resolvedNetwork);
        // Empty string from Rust means no memo or failed decryption — return null
        memo = decryptedMemo && decryptedMemo.trim().length > 0 ? decryptedMemo.trim() : null;
      } catch (_memoErr) {
        // Memo decryption failure is non-fatal — transaction is still included
        memo = null;
      }

      transactions.push({
        txid: rawTx.txid,
        blockHeight: rawTx.blockHeight,
        valueZatoshis: String(rawTx.valueZatoshis),
        valueZEC: (rawTx.valueZatoshis / ZEC_PER_ZATOSHI).toFixed(8),
        memo,
      });
    }

    return {
      success: true,
      transactions,
      blockHeight: tipHeight,
      scannedBlocks: blockBuffers.length,
      network: resolvedNetwork,
    };

  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'HISTORY_ERROR'
    };
  }
}

getTransactionHistory.meta = {
  name: 'balance-check-history',
  description: 'Get ZCash transaction history with memo fields via lightwalletd compact block scanning',
  version: '1.0.0',
  execution: 'local+network',
  privacy: 'shielded-only',
  requirements: ['SYNC-03']
};

module.exports = checkBalance;
module.exports.checkBalance = checkBalance;
module.exports.getTransactionHistory = getTransactionHistory;
