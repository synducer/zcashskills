'use strict';

const path = require('path');
const os = require('os');

// Mock native-loader BEFORE requiring the skill
jest.mock('../../lib/native-loader', () => ({
  deriveViewingKey: jest.fn(),
  scanBlocks: jest.fn(),
  decryptMemo: jest.fn(),
}));

// Mock lightwalletd BEFORE requiring the skill
jest.mock('../../lib/lightwalletd', () => ({
  createClient: jest.fn(),
  getLatestBlock: jest.fn(),
  fetchBlocksAsProtoBytes: jest.fn(),
  getTransaction: jest.fn(),
}));

// Mock fs BEFORE requiring the skill
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

const native = require('../../lib/native-loader');
const { createClient, getLatestBlock, fetchBlocksAsProtoBytes, getTransaction } = require('../../lib/lightwalletd');
const fs = require('fs');
const { checkBalance } = require('../../skills/balance-check');

// Sample wallet JSON matching the wallet-persist format
const MOCK_WALLET = {
  version: 1,
  network: 'mainnet',
  address: 'zs1testaddress',
  encryptedSeed: 'aabbcc',
  salt: 'ddeeff',
  nonce: '112233',
  birthdayHeight: 2500000,
};

describe('balance-check skill', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {};
    createClient.mockReturnValue(mockClient);
    getLatestBlock.mockResolvedValue(2500100); // 100 blocks above birthday
    fetchBlocksAsProtoBytes.mockResolvedValue([Buffer.from('mockblock1'), Buffer.from('mockblock2')]);
    native.deriveViewingKey.mockReturnValue('uview1mockufvkstring');
    native.scanBlocks.mockReturnValue({
      confirmedZatoshis: '123456789',
      transactionsJson: '[]',
    });
    fs.readFileSync.mockReturnValue(JSON.stringify(MOCK_WALLET));
  });

  describe('input validation', () => {
    test('returns error when lightwalletdUrl is missing', async () => {
      const result = await checkBalance({ passphrase: 'testpass' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/lightwalletdUrl is required/);
      expect(result.code).toBe('BALANCE_ERROR');
    });

    test('returns error when passphrase is missing', async () => {
      const result = await checkBalance({ lightwalletdUrl: 'zec.rocks:443' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Passphrase is required/);
    });
  });

  describe('happy path', () => {
    const validParams = {
      lightwalletdUrl: 'zec.rocks:443',
      passphrase: 'testpassphrase',
    };

    test('returns success with balance fields', async () => {
      const result = await checkBalance(validParams);
      expect(result.success).toBe(true);
      expect(result.confirmedZatoshis).toBe('123456789');
      expect(result.spendableZatoshis).toBe('123456789'); // v1: same
      expect(result.confirmedZEC).toBe('1.23456789');
      expect(result.spendableZEC).toBe('1.23456789');
      expect(result.blockHeight).toBe(2500100);
      expect(result.scannedBlocks).toBe(2);
      expect(result.network).toBe('mainnet');
    });

    test('derives UFVK with keyType=full (not incoming)', async () => {
      await checkBalance(validParams);
      expect(native.deriveViewingKey).toHaveBeenCalledWith(
        'testpassphrase',
        MOCK_WALLET.encryptedSeed,
        MOCK_WALLET.salt,
        MOCK_WALLET.nonce,
        'mainnet',
        'full'  // MUST be 'full', not 'incoming'
      );
    });

    test('passes UFVK and network to native.scanBlocks', async () => {
      await checkBalance(validParams);
      expect(native.scanBlocks).toHaveBeenCalledWith(
        'uview1mockufvkstring',
        'mainnet',
        expect.any(Array)
      );
    });

    test('fetches blocks from birthdayHeight to tip', async () => {
      await checkBalance(validParams);
      expect(fetchBlocksAsProtoBytes).toHaveBeenCalledWith(
        mockClient,
        MOCK_WALLET.birthdayHeight,
        2500100
      );
    });
  });

  describe('zero balance', () => {
    test('returns zero balance correctly', async () => {
      native.scanBlocks.mockReturnValue({ confirmedZatoshis: '0', transactionsJson: '[]' });
      const result = await checkBalance({ lightwalletdUrl: 'zec.rocks:443', passphrase: 'pass' });
      expect(result.success).toBe(true);
      expect(result.confirmedZatoshis).toBe('0');
      expect(result.confirmedZEC).toBe('0.00000000');
    });
  });

  describe('birthday height fallback', () => {
    test('falls back to tipHeight - 100 if birthdayHeight is 0', async () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ ...MOCK_WALLET, birthdayHeight: 0 }));
      await checkBalance({ lightwalletdUrl: 'zec.rocks:443', passphrase: 'pass' });
      expect(fetchBlocksAsProtoBytes).toHaveBeenCalledWith(mockClient, 2500000, 2500100);
      // tipHeight=2500100, tip-100=2500000
    });
  });

  describe('error handling', () => {
    test('returns error when wallet file cannot be read', async () => {
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });
      const result = await checkBalance({ lightwalletdUrl: 'zec.rocks:443', passphrase: 'pass' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot read wallet file/);
    });

    test('returns error when native.scanBlocks throws', async () => {
      native.scanBlocks.mockImplementation(() => { throw new Error('Scan error at block 100'); });
      const result = await checkBalance({ lightwalletdUrl: 'zec.rocks:443', passphrase: 'pass' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('BALANCE_ERROR');
    });

    test('returns error when deriveViewingKey throws wrong passphrase', async () => {
      native.deriveViewingKey.mockImplementation(() => {
        throw new Error('Decryption failed — wrong passphrase');
      });
      const result = await checkBalance({ lightwalletdUrl: 'zec.rocks:443', passphrase: 'wrongpass' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Decryption failed/);
    });

    test('returns error when getLatestBlock fails', async () => {
      getLatestBlock.mockRejectedValue(new Error('Connection refused'));
      const result = await checkBalance({ lightwalletdUrl: 'bad.host:443', passphrase: 'pass' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('BALANCE_ERROR');
    });
  });

  describe('skill metadata', () => {
    test('checkBalance.meta has required fields', () => {
      expect(checkBalance.meta.name).toBe('balance-check');
      expect(checkBalance.meta.version).toBe('1.0.0');
    });
  });
});

describe('getTransactionHistory', () => {
  const { getTransactionHistory } = require('../../skills/balance-check');

  beforeEach(() => {
    jest.clearAllMocks();
    const mockClient = {};
    createClient.mockReturnValue(mockClient);
    getLatestBlock.mockResolvedValue(2500100);
    fetchBlocksAsProtoBytes.mockResolvedValue([Buffer.from('mockblock1'), Buffer.from('mockblock2')]);
    native.deriveViewingKey.mockReturnValue('uview1mockufvkstring');
    getTransaction.mockResolvedValue(Buffer.from('deadbeef', 'hex'));
    native.decryptMemo.mockReturnValue('Payment for invoice #42');
    native.scanBlocks.mockReturnValue({
      confirmedZatoshis: '500000000',
      transactionsJson: JSON.stringify([
        { txid: 'abc123', blockHeight: 2500050, valueZatoshis: 500000000 }
      ]),
    });
    const fs = require('fs');
    fs.readFileSync.mockReturnValue(JSON.stringify({
      version: 1,
      network: 'mainnet',
      address: 'zs1testaddress',
      encryptedSeed: 'aabbcc',
      salt: 'ddeeff',
      nonce: '112233',
      birthdayHeight: 2500000,
    }));
  });

  test('returns transactions with memo fields', async () => {
    const result = await getTransactionHistory({
      lightwalletdUrl: 'zec.rocks:443',
      passphrase: 'testpass',
    });
    expect(result.success).toBe(true);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].txid).toBe('abc123');
    expect(result.transactions[0].blockHeight).toBe(2500050);
    expect(result.transactions[0].valueZatoshis).toBe('500000000');
    expect(result.transactions[0].valueZEC).toBe('5.00000000');
    expect(result.transactions[0].memo).toBe('Payment for invoice #42');
  });

  test('returns memo: null when decryptMemo returns empty string', async () => {
    native.decryptMemo.mockReturnValue('');
    const result = await getTransactionHistory({
      lightwalletdUrl: 'zec.rocks:443',
      passphrase: 'testpass',
    });
    expect(result.transactions[0].memo).toBeNull();
  });

  test('returns memo: null when getTransaction throws (non-fatal)', async () => {
    getTransaction.mockRejectedValue(new Error('Transaction not found'));
    const result = await getTransactionHistory({
      lightwalletdUrl: 'zec.rocks:443',
      passphrase: 'testpass',
    });
    expect(result.success).toBe(true); // Non-fatal
    expect(result.transactions[0].memo).toBeNull();
  });

  test('returns empty transactions array when no notes found', async () => {
    native.scanBlocks.mockReturnValue({ confirmedZatoshis: '0', transactionsJson: '[]' });
    const result = await getTransactionHistory({
      lightwalletdUrl: 'zec.rocks:443',
      passphrase: 'testpass',
    });
    expect(result.success).toBe(true);
    expect(result.transactions).toHaveLength(0);
  });

  test('returns error when lightwalletdUrl missing', async () => {
    const result = await getTransactionHistory({ passphrase: 'pass' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('HISTORY_ERROR');
  });
});
