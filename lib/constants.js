/**
 * ZCash Skills Constants
 * 
 * Network configurations, address prefixes, and other
 * constants used throughout the ZCash skills package.
 */

/**
 * Supported ZCash networks
 */
const NETWORKS = {
    MAINNET: 'mainnet',
    TESTNET: 'testnet'
};

/**
 * Address prefixes for each network and type
 */
const ADDRESS_PREFIXES = {
    [NETWORKS.MAINNET]: {
        shielded: 'zs1',
        transparent: 't1',
        unified: 'u1'
    },
    [NETWORKS.TESTNET]: {
        shielded: 'ztestsapling1',
        transparent: 'tm',
        unified: 'utest'
    }
};

/**
 * Address types supported by ZCash
 */
const ADDRESS_TYPES = {
    SHIELDED: 'shielded',
    TRANSPARENT: 'transparent', 
    UNIFIED: 'unified'
};

/**
 * ZIP-321 payment URI configuration
 */
const ZIP_321 = {
    PROTOCOL: 'zcash:',
    MAX_MEMO_BYTES: 512,
    SUPPORTED_PARAMS: [
        'amount',
        'memo', 
        'label',
        'message'
    ]
};

/**
 * Platform support matrix
 */
const PLATFORMS = {
    SUPPORTED: [
        'linux-x64',
        'darwin-x64',
        'darwin-arm64',
        'win32-x64'
    ],
    ALIASES: {
        'linux': 'linux-x64',
        'darwin': 'darwin-x64',
        'win32': 'win32-x64'
    }
};

/**
 * Skill metadata
 */
const SKILLS = {
    GENERATE_ADDRESS: {
        name: 'generate-address',
        description: 'Generate ZCash shielded addresses',
        dependencies: ['zcash_keys', 'zcash_address', 'rand']
    },
    VALIDATE_ADDRESS: {
        name: 'validate-address',
        description: 'Validate ZCash address format and network',
        dependencies: ['zcash_address']
    },
    CREATE_PAYMENT_URI: {
        name: 'create-payment-uri',
        description: 'Create ZIP-321 payment URIs',
        dependencies: []
    },
    PARSE_PAYMENT_URI: {
        name: 'parse-payment-uri', 
        description: 'Parse ZIP-321 payment URIs',
        dependencies: []
    }
};

/**
 * Error codes used by skills
 */
const ERROR_CODES = {
    GENERATION_ERROR: 'GENERATION_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    URI_CREATION_ERROR: 'URI_CREATION_ERROR',
    URI_PARSE_ERROR: 'URI_PARSE_ERROR',
    PLATFORM_ERROR: 'PLATFORM_ERROR',
    NATIVE_MODULE_ERROR: 'NATIVE_MODULE_ERROR',
    SEND_TRANSACTION_ERROR: 'SEND_TRANSACTION_ERROR',
    PARAMS_DOWNLOAD_ERROR: 'PARAMS_DOWNLOAD_ERROR',
    GRPC_ERROR: 'GRPC_ERROR',
    INSUFFICIENT_FUNDS_ERROR: 'INSUFFICIENT_FUNDS_ERROR'
};

/**
 * Validation rules
 */
const VALIDATION = {
    MIN_ADDRESS_LENGTH: 35,   // Minimum length for valid addresses
    MAX_ADDRESS_LENGTH: 200,  // Maximum reasonable address length
    MAX_AMOUNT_DECIMALS: 8,   // Maximum decimal places for amounts
    MIN_AMOUNT: 0.00000001,   // Minimum amount (1 zatoshi)
    MAX_AMOUNT: 21000000      // Maximum theoretical ZEC supply
};

/**
 * Lightwalletd gRPC server addresses
 */
const LIGHTWALLETD_SERVERS = {
    mainnet: 'zec.rocks:443',
    testnet: 'lightwalletd.testnet.electriccoin.co:9067'
};

/**
 * Transaction constants
 */
const TRANSACTION = {
    DEFAULT_FEE_ZATOSHIS: 10000,     // 0.0001 ZEC (ZIP-317 conventional fee)
    ZATOSHIS_PER_ZEC: 100000000,     // 1 ZEC = 100,000,000 zatoshis
    BLOCK_SCAN_BATCH_SIZE: 1000      // Number of blocks to fetch per gRPC batch
};

/**
 * Sapling proving parameter checksums (SHA-256)
 */
const SAPLING_PARAMS = {
    SPEND_HASH: '8270785a1a0d0bc77196f000ee6d221c9c9894f55307bd9b15c3f397ad08c8f4',
    OUTPUT_HASH: '657e3d38dbb5cb5e7dd2970e8b03d69b4571dd60825c31b4551cb3e69f1e8f0e',
    DOWNLOAD_BASE_URL: 'https://download.z.cash/downloads'
};

/**
 * Sapling activation birthday heights.
 * Conservative defaults for wallets created without a live lightwalletd query.
 * Phase 3 will replace these with live chain-tip queries via lightwalletd.
 *
 * mainnet: Sapling activated at 419200; 2750000 is a 2026 conservative estimate
 *          ensuring new wallets don't need to scan from genesis.
 * testnet: Sapling activation block on testnet (280000)
 */
const SAPLING_ACTIVATION = {
    mainnet: 2750000,
    testnet: 280000
};

module.exports = {
    NETWORKS,
    ADDRESS_PREFIXES,
    ADDRESS_TYPES,
    ZIP_321,
    PLATFORMS,
    SKILLS,
    ERROR_CODES,
    VALIDATION,
    SAPLING_ACTIVATION,
    LIGHTWALLETD_SERVERS,
    TRANSACTION,
    SAPLING_PARAMS
};