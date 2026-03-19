/**
 * Validate Address Skill
 * 
 * Validates ZCash address format, network, and type
 * using librustzcash with complete local execution.
 */

const native = require('../../lib/native-loader');

/**
 * Validate a ZCash address format and extract information
 * 
 * @param {Object} params - Validation parameters
 * @param {string} params.address - Address to validate
 * @returns {Promise<Object>} Validation result
 * 
 * @example
 * const result = await validateAddress({ address: 'ztestsapling1abc123...' });
 * if (result.valid) {
 *   console.log(`Valid ${result.type} address on ${result.network}`);
 * }
 */
async function validateAddress({ address } = {}) {
    try {
        // Input validation
        if (!address) {
            throw new Error('Address parameter is required');
        }
        
        if (typeof address !== 'string') {
            throw new Error('Address must be a string');
        }
        
        if (address.trim().length === 0) {
            throw new Error('Address cannot be empty');
        }
        
        console.log(`🔍 Validating ZCash address: ${address.substring(0, 20)}...`);
        
        // Call native Rust validation function
        const rustResult = native.validateAddress(address.trim());
        
        if (rustResult.valid) {
            console.log(`✅ Valid ${rustResult.type} address on ${rustResult.network}`);
            
            // Generate recommendations based on address type
            const recommendations = [];
            
            if (rustResult.type === 'shielded') {
                recommendations.push('Address supports privacy-preserving transactions');
                recommendations.push('Transactions will be private and confidential');
                recommendations.push('Recommended for maximum privacy');
            } else if (rustResult.type === 'transparent') {
                recommendations.push('Consider using shielded addresses for better privacy');
                recommendations.push('Transparent addresses are visible on blockchain');
                recommendations.push('Upgrade to shielded for confidential transactions');
            } else if (rustResult.type === 'unified') {
                recommendations.push('Unified address supports multiple protocols');
                recommendations.push('Provides best privacy and flexibility');
                recommendations.push('Future-proof address format');
            }
            
            return {
                success: true,
                valid: true,
                address: address.trim(),
                network: rustResult.network,
                type: rustResult.type,
                message: `Valid ${rustResult.type} address on ${rustResult.network}`,
                recommendations: recommendations,
                execution: 'local',
                timestamp: new Date().toISOString(),
                library: 'librustzcash'
            };
        } else {
            console.log(`❌ Invalid address format: ${address.substring(0, 20)}...`);
            
            return {
                success: true,
                valid: false,
                address: address.trim(),
                message: 'Invalid ZCash address format',
                recommendations: [
                    'Check address format and encoding',
                    'Ensure address is properly copied',
                    'Verify address is from ZCash network',
                    'Check for extra spaces or characters'
                ],
                execution: 'local',
                timestamp: new Date().toISOString(),
                library: 'librustzcash'
            };
        }
        
    } catch (error) {
        console.error(`❌ Address validation failed:`, error.message);
        
        return {
            success: false,
            error: error.message,
            code: 'VALIDATION_ERROR',
            address: address || null,
            execution: 'local',
            timestamp: new Date().toISOString(),
            suggestions: [
                'Ensure address parameter is provided',
                'Check address is a valid string',
                'Verify native module is working',
                'Try with a known valid address for testing'
            ]
        };
    }
}

// Export for require() usage
module.exports = validateAddress;

// Named export for ES6 modules
module.exports.validateAddress = validateAddress;

// Add metadata for skill discovery
module.exports.meta = {
    name: 'validate-address',
    description: 'Validate ZCash addresses and extract network/type information',
    version: '1.0.0',
    author: 'konradgnat',
    dependencies: ['zcash_address'],
    networks: ['mainnet', 'testnet'],
    execution: 'local',
    addressTypes: ['shielded', 'transparent', 'unified']
};