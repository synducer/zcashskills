/**
 * Generate Address Skill
 * 
 * Generates new ZCash shielded addresses using librustzcash
 * with complete local execution for maximum privacy and security.
 */

const native = require('../../lib/native-loader');

/**
 * Generate a new ZCash shielded address locally
 * 
 * @param {Object} params - Generation parameters
 * @param {string} [params.network='mainnet'] - Network ('mainnet' or 'testnet')
 * @returns {Promise<Object>} Generation result
 * 
 * @example
 * const result = await generateAddress({ network: 'testnet' });
 * if (result.success) {
 *   console.log(`Address: ${result.address}`);
 *   console.log(`Network: ${result.network}`);
 * }
 */
async function generateAddress({ network = 'mainnet' } = {}) {
    try {
        // Input validation
        const validNetworks = ['mainnet', 'testnet'];
        if (!validNetworks.includes(network)) {
            throw new Error(
                `Invalid network: ${network}. Must be one of: ${validNetworks.join(', ')}`
            );
        }

        console.log(`🔑 Generating ZCash ${network} address using librustzcash...`);
        
        // Call native Rust function (synchronous - very fast)
        const rustResult = native.generateShieldedAddress(network);
        
        // Validate address format based on network
        const expectedPrefix = network === 'testnet' ? 'ztestsapling1' : 'zs1';
        if (!rustResult.address.startsWith(expectedPrefix)) {
            throw new Error(
                `Generated address has invalid prefix. Expected ${expectedPrefix}, ` +
                `got ${rustResult.address.substring(0, 12)}...`
            );
        }
        
        // Validate address length (ZCash addresses are long)
        if (rustResult.address.length < 78) {
            throw new Error(
                `Generated address appears too short: ${rustResult.address.length} characters`
            );
        }
        
        console.log(`✅ Generated ${network} address: ${rustResult.address.substring(0, 20)}...`);
        
        // Return standardized result
        return {
            success: true,
            address: rustResult.address,
            network: rustResult.network,
            type: rustResult.type,
            derivation_path: rustResult.derivation_path || "m/32'/133'/0'",
            message: `Generated new ZCash ${network} address: ${rustResult.address}`,
            execution: 'local',              // Confirms local execution
            timestamp: new Date().toISOString(),
            library: 'librustzcash'         // Confirms using official library
        };
        
    } catch (error) {
        console.error(`❌ Address generation failed:`, error.message);
        
        return {
            success: false,
            error: error.message,
            code: 'GENERATION_ERROR',
            network: network,
            execution: 'local',
            timestamp: new Date().toISOString(),
            suggestions: [
                'Check that network parameter is valid ("mainnet" or "testnet")',
                'Ensure native module is properly installed',
                'Try rebuilding native modules: npm run rebuild',
                'Check platform support: https://github.com/konradgnat/zcashskills#platform-support'
            ]
        };
    }
}

// Export for require() usage
module.exports = generateAddress;

// Named export for ES6 modules
module.exports.generateAddress = generateAddress;

// Add metadata for skill discovery
module.exports.meta = {
    name: 'generate-address',
    description: 'Generate ZCash shielded addresses using librustzcash',
    version: '1.0.0',
    author: 'konradgnat',
    dependencies: ['zcash_keys', 'zcash_address', 'rand'],
    networks: ['mainnet', 'testnet'],
    execution: 'local',
    privacy: 'shielded-only'
};