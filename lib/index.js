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
const walletPersist = require('../skills/wallet-persist');
const viewingKeys = require('../skills/viewing-keys');
const balanceCheck = require('../skills/balance-check');
const sendTransaction = require('../skills/send-transaction');
const checkBalance = require('../skills/check-balance');

/**
 * ZCash Skills API
 */
const zcashSkills = {
  // Core skills
  generateAddress,
  validateAddress,
  createPaymentUri,
  parsePaymentUri,
  walletPersist,
  viewingKeys,
  balanceCheck,
  sendTransaction,
  checkBalance,

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
    'parse-payment-uri',
    'wallet-persist',
    'viewing-keys',
    'balance-check',
    'send-transaction',
    'check-balance'
  ]
};

// Export individual skills for direct import
zcashSkills.skills.generateAddress = generateAddress;
zcashSkills.skills.validateAddress = validateAddress;
zcashSkills.skills.createPaymentUri = createPaymentUri;
zcashSkills.skills.parsePaymentUri = parsePaymentUri;
zcashSkills.skills.walletPersist = walletPersist;
zcashSkills.skills.viewingKeys = viewingKeys;
zcashSkills.skills.balanceCheck = balanceCheck;
zcashSkills.skills.sendTransaction = sendTransaction;
zcashSkills.skills.checkBalance = checkBalance;

module.exports = zcashSkills;
