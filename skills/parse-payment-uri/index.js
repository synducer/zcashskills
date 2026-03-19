/**
 * Parse Payment URI Skill
 * 
 * Parses ZIP-321 ZCash payment URIs into structured data
 * for processing by AI agents and applications.
 */

const { parsePaymentURI } = require('../../lib/utils');

/**
 * Parse a ZIP-321 ZCash payment URI into structured data
 * 
 * @param {Object} params - Parse parameters
 * @param {string} params.uri - ZCash payment URI to parse
 * @returns {Promise<Object>} Parse result with structured data
 * 
 * @example
 * const result = await parsePaymentUri({
 *   uri: 'zcash:ztestsapling1...?amount=0.001&memo=Coffee'
 * });
 * console.log(result.parsed.amount); // 0.001
 * console.log(result.parsed.memo);   // 'Coffee'
 */
async function parsePaymentUri({ uri } = {}) {
    try {
        // Input validation
        if (!uri) {
            throw new Error('URI parameter is required');
        }
        
        if (typeof uri !== 'string' || uri.trim().length === 0) {
            throw new Error('URI must be a non-empty string');
        }
        
        const cleanUri = uri.trim();
        
        // Basic URI format validation
        if (!cleanUri.startsWith('zcash:')) {
            throw new Error('URI must start with "zcash:" protocol identifier');
        }
        
        console.log(`🔍 Parsing ZCash payment URI: ${cleanUri.substring(0, 50)}...`);
        
        // Parse the URI using utility function
        const parsed = parsePaymentURI(cleanUri);
        
        // Validate extracted address
        if (!parsed.address) {
            throw new Error('No address found in payment URI');
        }
        
        // Validate address format
        const validateAddress = require('../validate-address');
        const validation = await validateAddress({ address: parsed.address });
        
        if (!validation.valid) {
            throw new Error(`Invalid address in payment URI: ${parsed.address}`);
        }
        
        console.log(`✅ Parsed payment URI for ${validation.network} ${validation.type} address`);
        
        // Return structured result
        return {
            success: true,
            valid: true,
            uri: cleanUri,
            parsed: {
                address: parsed.address,
                amount: parsed.amount || null,
                memo: parsed.memo || null,
                label: parsed.label || null,
                message: parsed.message || null
            },
            addressInfo: {
                network: validation.network,
                type: validation.type
            },
            message: 'Payment URI parsed successfully',
            execution: 'local',
            timestamp: new Date().toISOString(),
            standard: 'ZIP-321'
        };
        
    } catch (error) {
        console.error(`❌ Payment URI parsing failed:`, error.message);
        
        return {
            success: false,
            error: error.message,
            code: 'URI_PARSE_ERROR',
            uri: uri || null,
            execution: 'local',
            timestamp: new Date().toISOString(),
            suggestions: [
                'Ensure URI starts with "zcash:" protocol',
                'Check URI format follows ZIP-321 standard',
                'Verify address in URI is valid',
                'Check for proper URL encoding of parameters'
            ]
        };
    }
}

// Export for require() usage
module.exports = parsePaymentUri;

// Named export for ES6 modules
module.exports.parsePaymentUri = parsePaymentUri;

// Add metadata for skill discovery
module.exports.meta = {
    name: 'parse-payment-uri',
    description: 'Parse ZIP-321 ZCash payment URIs into structured data',
    version: '1.0.0',
    author: 'konradgnat',
    dependencies: [],
    standard: 'ZIP-321',
    execution: 'local',
    protocols: ['zcash:']
};