/**
 * ZCash Skills Utility Functions
 * 
 * Shared utilities for ZCash operations including
 * ZIP-321 URI handling and common validations.
 */

/**
 * Create a ZIP-321 compliant ZCash payment URI
 * 
 * @param {Object} params - Payment parameters
 * @param {string} params.address - ZCash address
 * @param {number} [params.amount] - Payment amount in ZEC
 * @param {string} [params.memo] - Payment memo
 * @param {string} [params.label] - Payment label  
 * @param {string} [params.message] - Additional message
 * @returns {string} ZIP-321 payment URI
 */
function createPaymentURI({ address, amount, memo, label, message }) {
    if (!address) {
        throw new Error('Address is required for payment URI');
    }
    
    // Start with base URI
    let uri = `zcash:${address}`;
    
    // Add parameters
    const params = [];
    
    if (amount !== undefined && amount !== null) {
        params.push(`amount=${amount}`);
    }
    
    if (memo) {
        params.push(`memo=${encodeURIComponent(memo)}`);
    }
    
    if (label) {
        params.push(`label=${encodeURIComponent(label)}`);
    }
    
    if (message) {
        params.push(`message=${encodeURIComponent(message)}`);
    }
    
    // Append parameters if any exist
    if (params.length > 0) {
        uri += '?' + params.join('&');
    }
    
    return uri;
}

/**
 * Parse a ZIP-321 ZCash payment URI
 * 
 * @param {string} uri - Payment URI to parse
 * @returns {Object} Parsed components
 */
function parsePaymentURI(uri) {
    if (!uri || typeof uri !== 'string') {
        throw new Error('URI must be a string');
    }
    
    if (!uri.startsWith('zcash:')) {
        throw new Error('URI must start with zcash: protocol');
    }
    
    // Remove protocol prefix
    const uriBody = uri.substring(6); // Remove 'zcash:'
    
    // Split address and parameters
    const [addressPart, paramsPart] = uriBody.split('?', 2);
    
    if (!addressPart || addressPart.length === 0) {
        throw new Error('No address found in URI');
    }
    
    const result = {
        address: addressPart
    };
    
    // Parse parameters if they exist
    if (paramsPart) {
        const params = new URLSearchParams(paramsPart);
        
        // Extract known parameters
        if (params.has('amount')) {
            const amountStr = params.get('amount');
            const amount = parseFloat(amountStr);
            if (isNaN(amount) || amount <= 0) {
                throw new Error(`Invalid amount: ${amountStr}`);
            }
            result.amount = amount;
        }
        
        if (params.has('memo')) {
            result.memo = params.get('memo');
        }
        
        if (params.has('label')) {
            result.label = params.get('label');
        }
        
        if (params.has('message')) {
            result.message = params.get('message');
        }
    }
    
    return result;
}

/**
 * Validate network parameter
 * 
 * @param {string} network - Network to validate
 * @returns {boolean} Whether network is valid
 */
function isValidNetwork(network) {
    return ['mainnet', 'testnet'].includes(network);
}

/**
 * Get address prefix for network
 * 
 * @param {string} network - Network name
 * @param {string} type - Address type  
 * @returns {string} Expected address prefix
 */
function getAddressPrefix(network, type = 'shielded') {
    if (network === 'testnet') {
        return type === 'shielded' ? 'ztestsapling1' : 'tm';
    } else {
        return type === 'shielded' ? 'zs1' : 't1';
    }
}

/**
 * Format amount for display
 * 
 * @param {number} amount - Amount in ZEC
 * @returns {string} Formatted amount
 */
function formatAmount(amount) {
    if (typeof amount !== 'number') {
        return 'N/A';
    }
    
    // Format with up to 8 decimal places, remove trailing zeros
    return amount.toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Truncate address for display
 * 
 * @param {string} address - Full address
 * @param {number} [length=20] - Number of characters to show
 * @returns {string} Truncated address
 */
function truncateAddress(address, length = 20) {
    if (!address || typeof address !== 'string') {
        return 'Invalid address';
    }
    
    if (address.length <= length) {
        return address;
    }
    
    const start = Math.floor((length - 3) / 2);
    const end = length - 3 - start;
    
    return address.substring(0, start) + '...' + address.substring(address.length - end);
}

/**
 * Create a summary of payment URI details
 * 
 * @param {Object} parsed - Parsed payment URI
 * @returns {string} Human-readable summary
 */
function createPaymentSummary(parsed) {
    let summary = `Payment to ${truncateAddress(parsed.address)}`;
    
    if (parsed.amount) {
        summary += ` for ${formatAmount(parsed.amount)} ZEC`;
    }
    
    if (parsed.memo) {
        summary += ` (${parsed.memo})`;
    }
    
    return summary;
}

module.exports = {
    createPaymentURI,
    parsePaymentURI,
    isValidNetwork,
    getAddressPrefix,
    formatAmount,
    truncateAddress,
    createPaymentSummary
};