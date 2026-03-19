/**
 * Unit Tests for Generate Address Skill
 */

const generateAddress = require('../../skills/generate-address');

// Mock the native module for testing
jest.mock('../../lib/native-loader', () => ({
    generateShieldedAddress: jest.fn()
}));

const mockNative = require('../../lib/native-loader');

describe('generate-address skill', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn(); // Mock console.log
        console.error = jest.fn(); // Mock console.error
    });

    describe('successful generation', () => {
        test('generates valid mainnet address', async () => {
            // Mock successful Rust function call
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc',
                network: 'mainnet',
                type: 'shielded',
                derivation_path: 'm/32\'/133\'/0\''
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.success).toBe(true);
            expect(result.address).toMatch(/^zs1/);
            expect(result.network).toBe('mainnet');
            expect(result.type).toBe('shielded');
            expect(result.execution).toBe('local');
            expect(result.library).toBe('librustzcash');
            expect(mockNative.generateShieldedAddress).toHaveBeenCalledWith('mainnet');
        });

        test('generates valid testnet address', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'ztestsapling1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc',
                network: 'testnet',
                type: 'shielded',
                derivation_path: 'm/32\'/133\'/0\''
            });

            const result = await generateAddress({ network: 'testnet' });

            expect(result.success).toBe(true);
            expect(result.address).toMatch(/^ztestsapling1/);
            expect(result.network).toBe('testnet');
            expect(result.type).toBe('shielded');
            expect(mockNative.generateShieldedAddress).toHaveBeenCalledWith('testnet');
        });

        test('defaults to mainnet when no network specified', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc',
                network: 'mainnet',
                type: 'shielded'
            });

            const result = await generateAddress();

            expect(result.success).toBe(true);
            expect(result.network).toBe('mainnet');
            expect(mockNative.generateShieldedAddress).toHaveBeenCalledWith('mainnet');
        });
    });

    describe('input validation', () => {
        test('rejects invalid network', async () => {
            const result = await generateAddress({ network: 'invalid' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid network');
            expect(result.code).toBe('GENERATION_ERROR');
            expect(mockNative.generateShieldedAddress).not.toHaveBeenCalled();
        });

        test('handles empty network parameter', async () => {
            const result = await generateAddress({ network: '' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid network');
        });
    });

    describe('address validation', () => {
        test('rejects address with wrong mainnet prefix', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'wrong_prefix_abc123',
                network: 'mainnet',
                type: 'shielded'
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('invalid prefix');
        });

        test('rejects address with wrong testnet prefix', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1abc123def456',  // mainnet prefix for testnet
                network: 'testnet',
                type: 'shielded'
            });

            const result = await generateAddress({ network: 'testnet' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('invalid prefix');
        });

        test('rejects address that is too short', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1short',  // Too short
                network: 'mainnet',
                type: 'shielded'
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('too short');
        });
    });

    describe('error handling', () => {
        test('handles native module errors', async () => {
            mockNative.generateShieldedAddress.mockImplementation(() => {
                throw new Error('Native module error');
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Native module error');
            expect(result.code).toBe('GENERATION_ERROR');
            expect(result.suggestions).toContain('Check that network parameter is valid');
        });

        test('provides helpful suggestions on failure', async () => {
            const result = await generateAddress({ network: 'invalid' });

            expect(result.suggestions).toContain('Check that network parameter is valid');
            expect(result.suggestions).toContain('npm run rebuild');
        });
    });

    describe('metadata', () => {
        test('exports correct metadata', () => {
            expect(generateAddress.meta).toBeDefined();
            expect(generateAddress.meta.name).toBe('generate-address');
            expect(generateAddress.meta.description).toContain('Generate ZCash shielded addresses');
            expect(generateAddress.meta.networks).toContain('mainnet');
            expect(generateAddress.meta.networks).toContain('testnet');
            expect(generateAddress.meta.execution).toBe('local');
        });
    });

    describe('timestamp and library tracking', () => {
        test('includes timestamp in response', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc',
                network: 'mainnet',
                type: 'shielded'
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.timestamp).toBeDefined();
            expect(new Date(result.timestamp)).toBeInstanceOf(Date);
        });

        test('confirms librustzcash usage', async () => {
            mockNative.generateShieldedAddress.mockReturnValue({
                address: 'zs1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc',
                network: 'mainnet',
                type: 'shielded'
            });

            const result = await generateAddress({ network: 'mainnet' });

            expect(result.library).toBe('librustzcash');
        });
    });
});