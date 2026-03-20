/**
 * Lightwalletd gRPC Client
 *
 * Connects to a ZCash lightwalletd server over gRPC/TLS to:
 *  - Stream compact blocks for note scanning
 *  - Broadcast signed transactions
 *  - Query chain state (latest block, tree state)
 *
 * All crypto remains in Rust — this module handles network I/O only.
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { LIGHTWALLETD_SERVERS } = require('./constants');

const PROTO_DIR = path.join(__dirname, '..', 'proto');

class LightwalletClient {
    /**
     * @param {string} [network='mainnet'] - 'mainnet' or 'testnet'
     * @param {string} [serverUrl] - Override lightwalletd URL
     */
    constructor(network = 'mainnet', serverUrl) {
        this.network = network;
        this.serverUrl = serverUrl || LIGHTWALLETD_SERVERS[network];
        if (!this.serverUrl) {
            throw new Error(`No lightwalletd server configured for network: ${network}`);
        }

        const packageDef = protoLoader.loadSync(
            path.join(PROTO_DIR, 'service.proto'),
            {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
                includeDirs: [PROTO_DIR]
            }
        );
        const proto = grpc.loadPackageDefinition(packageDef);
        this.client = new proto.cash.z.wallet.sdk.rpc.CompactTxStreamer(
            this.serverUrl,
            grpc.credentials.createSsl()
        );
    }

    /**
     * Get the latest block height from the server.
     * @returns {Promise<{height: number, hash: Buffer}>}
     */
    getLatestBlock() {
        return new Promise((resolve, reject) => {
            this.client.GetLatestBlock({}, (err, response) => {
                if (err) return reject(err);
                resolve({
                    height: parseInt(response.height, 10),
                    hash: response.hash
                });
            });
        });
    }

    /**
     * Get server info (chain name, block height, sapling activation).
     * @returns {Promise<Object>}
     */
    getLightdInfo() {
        return new Promise((resolve, reject) => {
            this.client.GetLightdInfo({}, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    }

    /**
     * Stream compact blocks in a range [startHeight, endHeight].
     * Returns an array of CompactBlock objects.
     * @param {number} startHeight
     * @param {number} endHeight
     * @returns {Promise<Array>}
     */
    getCompactBlocks(startHeight, endHeight) {
        return new Promise((resolve, reject) => {
            const blocks = [];
            const stream = this.client.GetBlockRange({
                start: { height: startHeight },
                end: { height: endHeight }
            });
            stream.on('data', (block) => blocks.push(block));
            stream.on('error', (err) => reject(err));
            stream.on('end', () => resolve(blocks));
        });
    }

    /**
     * Get Sapling commitment tree state at a given block height.
     * @param {number} height
     * @returns {Promise<Object>} TreeState with saplingTree field
     */
    getTreeState(height) {
        return new Promise((resolve, reject) => {
            this.client.GetTreeState({ height }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    }

    /**
     * Broadcast a raw signed transaction to the network.
     * @param {Buffer|Uint8Array} rawTxBytes - Raw transaction bytes
     * @returns {Promise<{errorCode: number, errorMessage: string}>}
     */
    sendTransaction(rawTxBytes) {
        return new Promise((resolve, reject) => {
            this.client.SendTransaction(
                { data: rawTxBytes, height: 0 },
                (err, response) => {
                    if (err) return reject(err);
                    resolve(response);
                }
            );
        });
    }

    /**
     * Close the gRPC connection.
     */
    close() {
        this.client.close();
    }
}

module.exports = LightwalletClient;
