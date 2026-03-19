/**
 * Create Payment URI Skill
 * 
 * Creates ZIP-321 compliant ZCash payment URIs
 * for requesting payments with amount, memo, and metadata.
 */

const { createPaymentURI } = require('../../lib/utils');

/**
 * Create a ZIP-321 compliant ZCash payment URI
 * 
 * @param {Object} params - Payment URI parameters
 * @param {string} params.address - ZCash address to receive payment
 * @param {number} [params.amount] - Payment amount in ZEC
 * @param {string} [params.memo] - Payment memo/note (encrypted)
 * @param {string} [params.label] - Payment label for wallet display
 * @param {string} [params.message] - Additional message
 * @returns {Promise<Object>} Payment URI creation result
 * 
 * @example
 * const result = await createPaymentUri({
 *   address: 'ztestsapling1abc123...',
 *   amount: 0.001,
 *   memo: 'Coffee payment',
 *   label: 'Starbucks'
 * });
 * console.log(result.uri); // zcash:ztestsapling1...?amount=0.001&memo=Coffee%20payment
 */
async function createPaymentUri({ address, amount, memo, label, message } = {}) {
    try {
        // Input validation
        if (!address) {
            throw new Error('Address parameter is required');
        }
        
        if (typeof address !== 'string' || address.trim().length === 0) {
            throw new Error('Address must be a non-empty string');
        }
        
        // Validate address format first
        const validateAddress = require('../validate-address');
        const validation = await validateAddress({ address: address.trim() });
        
        if (!validation.valid) {
            throw new Error(`Invalid ZCash address: ${address}`);
        }
        
        // Validate amount if provided
        if (amount !== undefined && amount !== null) {
            if (typeof amount !== 'number' || amount < 0) {
                throw new Error('Amount must be a positive number');
            }
            
            if (amount === 0) {
                throw new Error('Amount cannot be zero');
            }
            
            // Check for reasonable amount (not too many decimal places)
            if (amount.toString().split('.')[1]?.length > 8) {
                throw new Error('Amount has too many decimal places (max 8)');
            }
        }
        
        // Validate memo length (ZIP-321 limit is 512 bytes)
        if (memo && typeof memo === 'string' && Buffer.byteLength(memo, 'utf8') > 512) {
            throw new Error('Memo exceeds maximum length of 512 bytes');
        }
        
        console.log(`💳 Creating payment URI for ${validation.network} ${validation.type} address...`);
        
        // Create ZIP-321 compliant URI
        const uri = createPaymentURI({
            address: address.trim(),
            amount: amount,
            memo: memo,
            label: label,
            message: message
        });
        
        console.log(`✅ Payment URI created: ${uri.substring(0, 50)}...`);
        
        // Return standardized result
        return {
            success: true,
            uri: uri,
            details: {
                address: address.trim(),
                amount: amount || null,
                memo: memo || null,
                label: label || null,
                message: message || null
            },
            addressInfo: {
                network: validation.network,
                type: validation.type
            },
            message: 'ZIP-321 payment URI created successfully',
            execution: 'local',
            timestamp: new Date().toISOString(),
            standard: 'ZIP-321'
        };
        
    } catch (error) {
        console.error(`❌ Payment URI creation failed:`, error.message);
        
        return {
            success: false,
            error: error.message,
            code: 'URI_CREATION_ERROR',
            address: address || null,
            execution: 'local',
            timestamp: new Date().toISOString(),
            suggestions: [
                'Ensure address is valid ZCash address',
                'Check amount is positive number if provided',
                'Verify memo is under 512 bytes',
                'Use proper ZIP-321 parameter format'
            ]
        };
    }
}

// Export for require() usage
module.exports = createPaymentUri;

// Named export for ES6 modules  
module.exports.createPaymentUri = createPaymentUri;

// Add metadata for skill discovery
module.exports.meta = {
    name: 'create-payment-uri',
    description: 'Create ZIP-321 compliant ZCash payment URIs',
    version: '1.0.0',
    author: 'konradgnat',
    dependencies: [],
    standard: 'ZIP-321',
    execution: 'local',
    maxMemoBytes: 512
};