/**
 * ZCash Skills - Privacy-preserving skills for AI agents
 * 
 * Main entry point for the zcashskills package.
 * Provides access to all ZCash skills with local cryptographic execution.
 * 
 * @version 1.0.0
 * @author konradgnat
 */

const generateAddress = require('../skills/generate-address');
const validateAddress = require('../skills/validate-address');
const createPaymentUri = require('../skills/create-payment-uri');
const parsePaymentUri = require('../skills/parse-payment-uri');

/**
 * ZCash Skills API
 */
const zcashSkills = {
  // Core skills
  generateAddress,
  validateAddress,
  createPaymentUri,
  parsePaymentUri,
  
  // Convenience methods
  async generateTestnetAddress() {
    return generateAddress({ network: 'testnet' });
  },
  
  async generateMainnetAddress() {
    return generateAddress({ network: 'mainnet' });
  },
  
  async createTestnetPaymentUri(params) {
    // Auto-generate testnet address if none provided
    if (!params.address) {
      const addressResult = await this.generateTestnetAddress();
      if (!addressResult.success) {
        return addressResult;
      }
      params.address = addressResult.address;
    }
    
    return createPaymentUri(params);
  },
  
  // Meta information
  version: require('../package.json').version,
  
  // Supported networks
  networks: ['mainnet', 'testnet'],
  
  // Available skills
  skills: [
    'generate-address',
    'validate-address', 
    'create-payment-uri',
    'parse-payment-uri'
  ]
};

// Export individual skills for direct import
zcashSkills.skills.generateAddress = generateAddress;
zcashSkills.skills.validateAddress = validateAddress;
zcashSkills.skills.createPaymentUri = createPaymentUri;
zcashSkills.skills.parsePaymentUri = parsePaymentUri;

module.exports = zcashSkills;