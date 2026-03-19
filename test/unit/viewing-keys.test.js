/**
 * Unit Tests for Viewing Keys Skill
 *
 * The native module is mocked to avoid requiring the actual compiled binary.
 * fs.readFileSync is mocked per test to control wallet JSON data without
 * real disk reads for negative cases, and a real temp file is written for
 * happy path tests.
 *
 * Tests cover VIEW-01 (IVK), VIEW-02 (FVK confirm gate), VIEW-03 (FVK encoding).
 */

// Mock native module before requiring the skill
jest.mock('../../lib/native-loader', () => ({
    deriveViewingKey: jest.fn(),
    createWallet: jest.fn(),
    loadWallet: jest.fn(),
    generateShieldedAddress: jest.fn(),
    validateAddress: jest.fn()
}));

const native = require('../../lib/native-loader');
const { getIncomingViewingKey, getFullViewingKey } = require('../../skills/viewing-keys');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Fixture wallet JSON matching the format written by createWallet
const MOCK_WALLET = {
    version: 1,
    network: 'mainnet',
    address: 'zs1mockaddress',
    encryptedSeed: 'deadbeef'.repeat(12),
    salt: 'cafebabe'.repeat(8),
    nonce: '12345678'.repeat(6),
    kdf: { algorithm: 'argon2id' },
    cipher: 'xchacha20poly1305',
    birthdayHeight: 2750000,
    createdAt: '2026-03-20T00:00:00.000Z'
};

// Temp wallet path for tests that need real disk files
const TEST_WALLET_DIR = path.join(os.tmpdir(), 'zcashskills-vk-test-' + Date.now());
const TEST_WALLET_PATH = path.join(TEST_WALLET_DIR, 'test-wallet.json');

describe('viewing-keys skill', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // Suppress console output during tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        // Default native mock: return appropriate key based on keyType
        native.deriveViewingKey.mockImplementation((pass, enc, salt, nonce, net, keyType) => {
            if (keyType === 'incoming') return 'uivk1mockkey';
            if (keyType === 'full') return 'uview1mockkey';
            throw new Error('Invalid keyType');
        });

        // Write a real wallet file for tests that do actual file reads
        fs.mkdirSync(TEST_WALLET_DIR, { recursive: true });
        fs.writeFileSync(TEST_WALLET_PATH, JSON.stringify(MOCK_WALLET, null, 2));
    });

    afterEach(() => {
        try { fs.rmSync(TEST_WALLET_DIR, { recursive: true, force: true }); } catch (_) {}
        jest.restoreAllMocks();
    });

    describe('getIncomingViewingKey', () => {

        it('returns success with viewingKey, keyType incoming, and network on happy path', async () => {
            const result = await getIncomingViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH
            });

            expect(result.success).toBe(true);
            expect(result.viewingKey).toBe('uivk1mockkey');
            expect(result.keyType).toBe('incoming');
            expect(result.network).toBe('mainnet');
        });

        it('calls native.deriveViewingKey with correct arguments', async () => {
            await getIncomingViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH
            });

            expect(native.deriveViewingKey).toHaveBeenCalledWith(
                'testpass123',
                MOCK_WALLET.encryptedSeed,
                MOCK_WALLET.salt,
                MOCK_WALLET.nonce,
                MOCK_WALLET.network,
                'incoming'
            );
        });

        it('returns success: false with IVK_ERROR code when passphrase is missing', async () => {
            const result = await getIncomingViewingKey({ walletPath: TEST_WALLET_PATH });

            expect(result.success).toBe(false);
            expect(result.code).toBe('IVK_ERROR');
            expect(result.error).toBeTruthy();
        });

        it('returns success: false with error containing walletPath when file not found', async () => {
            const badPath = '/nonexistent/wallet.json';
            const result = await getIncomingViewingKey({
                passphrase: 'testpass123',
                walletPath: badPath
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('IVK_ERROR');
            expect(result.error).toContain(badPath);
        });

        it('returns success: false when wallet JSON is missing encryptedSeed field', async () => {
            const badWallet = { ...MOCK_WALLET };
            delete badWallet.encryptedSeed;
            fs.writeFileSync(TEST_WALLET_PATH, JSON.stringify(badWallet));

            const result = await getIncomingViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('IVK_ERROR');
            expect(result.error).toContain('encryptedSeed');
        });

        it('returns success: false when native throws (wrong passphrase)', async () => {
            native.deriveViewingKey.mockImplementation(() => {
                throw new Error('Decryption failed — wrong passphrase');
            });

            const result = await getIncomingViewingKey({
                passphrase: 'wrongpassword',
                walletPath: TEST_WALLET_PATH
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('IVK_ERROR');
            expect(result.error).toContain('Decryption failed');
        });

        it('has .meta property with required fields', () => {
            expect(getIncomingViewingKey.meta).toBeDefined();
            expect(getIncomingViewingKey.meta.name).toBe('viewing-keys-incoming');
            expect(getIncomingViewingKey.meta.execution).toBe('local');
            expect(getIncomingViewingKey.meta.version).toBeTruthy();
        });
    });

    describe('getFullViewingKey', () => {

        it('returns FVK_CONFIRMATION_REQUIRED when confirm is not provided', async () => {
            const result = await getFullViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('FVK_CONFIRMATION_REQUIRED');
            // Must NOT call native.deriveViewingKey when confirm is missing
            expect(native.deriveViewingKey).not.toHaveBeenCalled();
        });

        it('returns FVK_CONFIRMATION_REQUIRED when confirm is false', async () => {
            const result = await getFullViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH,
                confirm: false
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('FVK_CONFIRMATION_REQUIRED');
            expect(native.deriveViewingKey).not.toHaveBeenCalled();
        });

        it('returns success with UFVK, keyType full, and network when confirm: true', async () => {
            const result = await getFullViewingKey({
                passphrase: 'testpass123',
                walletPath: TEST_WALLET_PATH,
                confirm: true
            });

            expect(result.success).toBe(true);
            expect(result.viewingKey).toBe('uview1mockkey');
            expect(result.keyType).toBe('full');
            expect(result.network).toBe('mainnet');
        });

        it('returns success: false with FVK_ERROR when native throws with confirm: true', async () => {
            native.deriveViewingKey.mockImplementation(() => {
                throw new Error('Decryption failed — wrong passphrase');
            });

            const result = await getFullViewingKey({
                passphrase: 'wrongpassword',
                walletPath: TEST_WALLET_PATH,
                confirm: true
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('FVK_ERROR');
            expect(result.error).toContain('Decryption failed');
        });

        it('returns success: false with FVK_ERROR when passphrase missing and confirm: true', async () => {
            const result = await getFullViewingKey({
                walletPath: TEST_WALLET_PATH,
                confirm: true
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('FVK_ERROR');
        });

        it('returns success: false with FVK_ERROR when wallet file not found and confirm: true', async () => {
            const badPath = '/nonexistent/wallet.json';
            const result = await getFullViewingKey({
                passphrase: 'testpass123',
                walletPath: badPath,
                confirm: true
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe('FVK_ERROR');
            expect(result.error).toContain(badPath);
        });

        it('has .meta property with required fields', () => {
            expect(getFullViewingKey.meta).toBeDefined();
            expect(getFullViewingKey.meta.name).toBe('viewing-keys-full');
            expect(getFullViewingKey.meta.execution).toBe('local');
            expect(getFullViewingKey.meta.version).toBeTruthy();
        });
    });

    describe('lib/index.js integration', () => {
        it('zcashSkills.viewingKeys is accessible with both functions', () => {
            const zcashSkills = require('../../lib/index');

            expect(typeof zcashSkills.viewingKeys).toBe('object');
            expect(typeof zcashSkills.viewingKeys.getIncomingViewingKey).toBe('function');
            expect(typeof zcashSkills.viewingKeys.getFullViewingKey).toBe('function');
            expect(zcashSkills.skills.includes('viewing-keys')).toBe(true);
            expect(typeof zcashSkills.skills.viewingKeys).toBe('object');
        });
    });
});
