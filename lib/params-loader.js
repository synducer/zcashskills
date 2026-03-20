/**
 * Sapling Proving Parameters Loader
 *
 * Downloads and caches the Sapling Groth16 proving parameters required
 * for building shielded transactions. These are ~50MB total and are
 * shared with zcashd at ~/.zcash-params/.
 *
 * Files:
 *   sapling-spend.params  (~47 MB)
 *   sapling-output.params (~3.5 MB)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { SAPLING_PARAMS } = require('./constants');

const PARAMS_DIR = path.join(os.homedir(), '.zcash-params');

const PARAM_FILES = [
    {
        name: 'sapling-spend.params',
        hash: SAPLING_PARAMS.SPEND_HASH,
        url: `${SAPLING_PARAMS.DOWNLOAD_BASE_URL}/sapling-spend.params`
    },
    {
        name: 'sapling-output.params',
        hash: SAPLING_PARAMS.OUTPUT_HASH,
        url: `${SAPLING_PARAMS.DOWNLOAD_BASE_URL}/sapling-output.params`
    }
];

/**
 * Download a file from HTTPS URL to a local path.
 * Follows redirects (up to 5).
 * @private
 */
function _downloadFile(url, destPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return _downloadFile(res.headers.location, destPath, maxRedirects - 1)
                    .then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
            }
            const file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', reject);
    });
}

/**
 * Compute SHA-256 hash of a file.
 * @private
 */
function _hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Ensure Sapling proving parameters are available locally.
 * Downloads them from z.cash if missing. Verifies SHA-256 checksums.
 *
 * @returns {Promise<{spendPath: string, outputPath: string}>}
 */
async function ensureParams() {
    fs.mkdirSync(PARAMS_DIR, { recursive: true });

    for (const param of PARAM_FILES) {
        const filePath = path.join(PARAMS_DIR, param.name);

        if (fs.existsSync(filePath)) {
            // Verify existing file
            const hash = await _hashFile(filePath);
            if (hash === param.hash) {
                console.log(`✅ ${param.name} verified`);
                continue;
            }
            console.warn(`⚠️  ${param.name} checksum mismatch, re-downloading...`);
        }

        console.log(`📥 Downloading ${param.name}... (this may take a moment)`);
        await _downloadFile(param.url, filePath);

        // Verify downloaded file
        const hash = await _hashFile(filePath);
        if (hash !== param.hash) {
            fs.unlinkSync(filePath);
            throw new Error(
                `${param.name} checksum mismatch after download. ` +
                `Expected ${param.hash}, got ${hash}`
            );
        }
        console.log(`✅ ${param.name} downloaded and verified`);
    }

    return {
        spendPath: path.join(PARAMS_DIR, 'sapling-spend.params'),
        outputPath: path.join(PARAMS_DIR, 'sapling-output.params')
    };
}

module.exports = { ensureParams, PARAMS_DIR };
