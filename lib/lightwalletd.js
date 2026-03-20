'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const protobuf = require('protobufjs');
const path = require('path');

const PROTO_DIR = path.join(__dirname, '../proto');
const SERVICE_PROTO = path.join(PROTO_DIR, 'service.proto');

// Proto-loader options — keepCase:true preserves snake_case field names
// which match the wire format used by prost in Rust (avoids name mismatch)
const PROTO_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR]
};

/**
 * Create a CompactTxStreamer gRPC client stub.
 *
 * @param {string} url - lightwalletd endpoint, e.g. "zec.rocks:443" (TLS) or "127.0.0.1:9067" (insecure)
 * @param {Object} [options]
 * @param {boolean} [options.insecure=false] - Use insecure credentials (for local dev only)
 * @returns {Object} gRPC client stub with CompactTxStreamer methods
 */
function createClient(url, { insecure = false } = {}) {
  const packageDef = protoLoader.loadSync(SERVICE_PROTO, PROTO_OPTIONS);
  const proto = grpc.loadPackageDefinition(packageDef);

  // Navigate the package namespace: cash.z.wallet.sdk.rpc.CompactTxStreamer
  const { CompactTxStreamer } = proto.cash.z.wallet.sdk.rpc;

  const credentials = insecure
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();

  return new CompactTxStreamer(url, credentials);
}

/**
 * Query the current chain tip height from lightwalletd.
 *
 * @param {Object} client - gRPC stub from createClient()
 * @param {number} [timeoutMs=10000] - RPC deadline in milliseconds
 * @returns {Promise<number>} Current block height
 */
function getLatestBlock(client, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.getLatestBlock({}, { deadline }, (err, result) => {
      if (err) return reject(new Error(`getLatestBlock failed: ${err.message}`));
      resolve(Number(result.height));
    });
  });
}

/**
 * Fetch a range of compact blocks as raw protobuf bytes.
 * Each element in the returned array is a Buffer containing one CompactBlock
 * encoded as protobuf bytes — ready to pass to native.scanBlocks() in Rust.
 *
 * @param {Object} client - gRPC stub from createClient()
 * @param {number} startHeight - First block height to fetch (inclusive)
 * @param {number} endHeight - Last block height to fetch (inclusive)
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=120000] - Stream deadline in milliseconds
 * @param {number} [options.maxBlocks=10000] - Block count limit (warn above this)
 * @returns {Promise<Buffer[]>} Array of protobuf-encoded CompactBlock buffers
 */
async function fetchBlocksAsProtoBytes(client, startHeight, endHeight, {
  timeoutMs = 120_000,
  maxBlocks = 10_000
} = {}) {
  const blockCount = endHeight - startHeight + 1;
  if (blockCount > maxBlocks) {
    throw new Error(
      `Requested ${blockCount} blocks exceeds limit of ${maxBlocks}. ` +
      'Use a more recent birthday height or implement incremental sync (SYNC-04 in v2).'
    );
  }

  // Load protobufjs root for re-encoding — use same proto files as gRPC client
  // protobufjs is a dep of @grpc/proto-loader, available without direct install
  const root = await protobuf.load(path.join(PROTO_DIR, 'compact_formats.proto'));

  // Look up the CompactBlock message type.
  // Package declaration in compact_formats.proto: cash.z.wallet.sdk.rpc
  let CompactBlockType;
  try {
    CompactBlockType = root.lookupType('cash.z.wallet.sdk.rpc.CompactBlock');
  } catch (_) {
    try {
      CompactBlockType = root.lookupType('CompactBlock');
    } catch (e) {
      throw new Error(`Could not find CompactBlock type in proto: ${e.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    const buffers = [];
    const deadline = new Date(Date.now() + timeoutMs);

    const call = client.getBlockRange(
      {
        start: { height: String(startHeight) },
        end: { height: String(endHeight) }
      },
      { deadline }
    );

    call.on('data', (block) => {
      // Re-encode the deserialized JS CompactBlock object back to raw protobuf bytes
      // so Rust's prost::Message::decode() can decode it correctly
      try {
        const errMsg = CompactBlockType.verify(block);
        if (errMsg) {
          // Log but don't reject — some fields may be unknown/optional
          // console.warn('CompactBlock verify warning:', errMsg);
        }
        const encoded = CompactBlockType.encode(block).finish();
        buffers.push(Buffer.from(encoded));
      } catch (encErr) {
        // If re-encoding fails, collect the error but continue streaming
        // (reject at end if any blocks failed)
        buffers.push(new Error(`Block encode failed: ${encErr.message}`));
      }
    });

    call.on('end', () => {
      // Check for any encoding errors collected during streaming
      const errors = buffers.filter(b => b instanceof Error);
      if (errors.length > 0) {
        return reject(new Error(`${errors.length} blocks failed to encode: ${errors[0].message}`));
      }
      resolve(buffers);
    });

    call.on('error', (err) => {
      reject(new Error(`GetBlockRange stream error: ${err.message}`));
    });
  });
}

/**
 * Fetch a full raw transaction from lightwalletd by transaction ID.
 * Used for memo decryption — compact blocks don't contain full memos.
 *
 * @param {Object} client - gRPC stub from createClient()
 * @param {string} txidHex - Transaction ID as hex string (32 bytes = 64 hex chars)
 * @param {number} [timeoutMs=15000] - RPC deadline
 * @returns {Promise<Buffer>} Raw serialized transaction bytes
 */
function getTransaction(client, txidHex, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    // Convert hex txid to bytes for the TxFilter message
    const txIdBytes = Buffer.from(txidHex, 'hex');
    client.getTransaction({ txID: txIdBytes }, { deadline }, (err, rawTx) => {
      if (err) return reject(new Error(`getTransaction failed for ${txidHex}: ${err.message}`));
      // rawTx.data contains the serialized transaction bytes
      if (!rawTx || !rawTx.data) {
        return reject(new Error(`Empty response for txid ${txidHex}`));
      }
      resolve(Buffer.from(rawTx.data));
    });
  });
}

module.exports = { createClient, getLatestBlock, fetchBlocksAsProtoBytes, getTransaction };
