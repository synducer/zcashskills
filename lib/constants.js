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
    NATIVE_MODULE_ERROR: 'NATIVE_MODULE_ERROR'
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
    SAPLING_ACTIVATION
};