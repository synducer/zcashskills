/**
 * Unit Tests for Wallet Persist Skill
 *
 * The native module is mocked to avoid requiring the actual compiled binary.
 * All filesystem I/O (createWallet writing, loadWallet reading) is tested with
 * a temporary directory so tests don't write to the real ~/.zcashskills path.
 */

// Mock native module before requiring the skill
jest.mock('../../lib/native-loader', () => ({
    createWallet: jest.fn(),
    loadWallet: jest.fn(),
    generateShieldedAddress: jest.fn(),
    validateAddress: jest.fn()
}));

const native = require('../../lib/native-loader');
const { createWallet, loadWallet } = require('../../skills/wallet-persist');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use a temp directory so tests don't write to real ~/.zcashskills
const TEST_WALLET_DIR = path.join(os.tmpdir(), 'zcashskills-test-' + Date.now());
const TEST_WALLET_PATH = path.join(TEST_WALLET_DIR, 'test-wallet.json');

describe('wallet-persist skill', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // Suppress console output during tests (matches project pattern)
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Clean up test wallet files
        try { fs.rmSync(TEST_WALLET_DIR, { recursive: true, force: true }); } catch (_) {}
        jest.restoreAllMocks();
    });

    describe('createWallet', () => {
        const MOCK_RUST_RESULT = {
            encryptedSeed: 'aabbccdd'.repeat(12),  // 48 bytes hex
            salt: 'deadbeef'.repeat(8),             // 32 bytes hex
            nonce: 'cafebabe'.repeat(6),            // 24 bytes hex
            address: 'zs1testaddress123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef',
            mnemonic: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24'
        };

        beforeEach(() => {
            native.createWallet.mockReturnValue(MOCK_RUST_RESULT);
        });

        it('returns success with address and mnemonic on valid input', async () => {
            const result = await createWallet({
                passphrase: 'testpassword123',
                network: 'mainnet',
                walletPath: TEST_WALLET_PATH
            });

            expect(result.success).toBe(true);
            expect(result.address).toBe(MOCK_RUST_RESULT.address);
            expect(result.mnemonic).toBe(MOCK_RUST_RESULT.mnemonic);
            expect(result.walletPath).toBe(TEST_WALLET_PATH);
            expect(result.network).toBe('mainnet');
        });

        it('writes wallet.json to disk with all required fields', async () => {
            await createWallet({
                passphrase: 'testpassword123',
                network: 'mainnet',
                walletPath: TEST_WALLET_PATH
            });

            expect(fs.existsSync(TEST_WALLET_PATH)).toBe(true);
            const written = JSON.parse(fs.readFileSync(TEST_WALLET_PATH, 'utf8'));
            expect(written.version).toBe(1);
            expect(written.network).toBe('mainnet');
            expect(written.encryptedSeed).toBe(MOCK_RUST_RESULT.encryptedSeed);
            expect(written.salt).toBe(MOCK_RUST_RESULT.salt);
            expect(written.nonce).toBe(MOCK_RUST_RESULT.nonce);
            expect(written.birthdayHeight).toBeGreaterThan(0);  // WALL-03
            expect(written.createdAt).toBeTruthy();
            expect(written.kdf.algorithm).toBe('argon2id');
            expect(written.cipher).toBe('xchacha20poly1305');
        });

        it('stores birthdayHeight for WALL-03 — never zero or missing', async () => {
            await createWallet({
                passphrase: 'testpassword123',
                network: 'mainnet',
                walletPath: TEST_WALLET_PATH
            });
            const written = JSON.parse(fs.readFileSync(TEST_WALLET_PATH, 'utf8'));
            expect(written.birthdayHeight).toBeDefined();
            expect(written.birthdayHeight).toBeGreaterThan(0);
        });

        it('accepts a custom birthdayHeight parameter', async () => {
            await createWallet({
                passphrase: 'testpassword123',
                network: 'mainnet',
                walletPath: TEST_WALLET_PATH,
                birthdayHeight: 2800000
            });
            const written = JSON.parse(fs.readFileSync(TEST_WALLET_PATH, 'utf8'));
            expect(written.birthdayHeight).toBe(2800000);
        });

        it('returns success: false with error message on short passphrase', async () => {
            const result = await createWallet({ passphrase: 'short', walletPath: TEST_WALLET_PATH });
            expect(result.success).toBe(false);
            expect(result.error).toContain('Passphrase must be at least 8 characters');
            expect(result.code).toBe('CREATE_WALLET_ERROR');
        });

        it('returns success: false on invalid network', async () => {
            const result = await createWallet({ passphrase: 'testpassword123', network: 'regtest', walletPath: TEST_WALLET_PATH });
            expect(result.success).toBe(false);
            expect(result.code).toBe('CREATE_WALLET_ERROR');
        });

        it('works with testnet network', async () => {
            const result = await createWallet({
                passphrase: 'testpassword123',
                network: 'testnet',
                walletPath: TEST_WALLET_PATH
            });
            expect(result.success).toBe(true);
            expect(result.network).toBe('testnet');
            const written = JSON.parse(fs.readFileSync(TEST_WALLET_PATH, 'utf8'));
            expect(written.birthdayHeight).toBeGreaterThan(0);
        });
    });

    describe('loadWallet', () => {
        const WALLET_JSON = {
            version: 1,
            network: 'mainnet',
            address: 'zs1testaddress123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef',
            encryptedSeed: 'aabbccdd'.repeat(12),
            salt: 'deadbeef'.repeat(8),
            nonce: 'cafebabe'.repeat(6),
            kdf: { algorithm: 'argon2id', version: 19, m_cost: 19456, t_cost: 2, p_cost: 1 },
            cipher: 'xchacha20poly1305',
            birthdayHeight: 2750000,
            createdAt: '2026-03-20T00:00:00.000Z'
        };

        beforeEach(() => {
            // Write a mock wallet file for load tests
            fs.mkdirSync(TEST_WALLET_DIR, { recursive: true });
            fs.writeFileSync(TEST_WALLET_PATH, JSON.stringify(WALLET_JSON, null, 2));
            native.loadWallet.mockReturnValue({ address: WALLET_JSON.address, network: 'mainnet' });
        });

        it('returns success with address and wallet metadata on correct passphrase', async () => {
            const result = await loadWallet({
                passphrase: 'testpassword123',
                walletPath: TEST_WALLET_PATH
            });
            expect(result.success).toBe(true);
            expect(result.address).toBe(WALLET_JSON.address);
            expect(result.network).toBe('mainnet');
            expect(result.birthdayHeight).toBe(2750000);
            expect(result.createdAt).toBe(WALLET_JSON.createdAt);
        });

        it('passes encryptedSeed, salt, nonce, network to native.loadWallet', async () => {
            await loadWallet({ passphrase: 'testpassword123', walletPath: TEST_WALLET_PATH });
            expect(native.loadWallet).toHaveBeenCalledWith(
                'testpassword123',
                WALLET_JSON.encryptedSeed,
                WALLET_JSON.salt,
                WALLET_JSON.nonce,
                WALLET_JSON.network
            );
        });

        it('returns success: false when wallet file does not exist', async () => {
            const result = await loadWallet({
                passphrase: 'testpassword123',
                walletPath: '/nonexistent/wallet.json'
            });
            expect(result.success).toBe(false);
            expect(result.code).toBe('LOAD_WALLET_ERROR');
        });

        it('returns success: false when native.loadWallet throws (wrong passphrase)', async () => {
            native.loadWallet.mockImplementation(() => {
                throw new Error('Decryption failed — wrong passphrase or corrupted wallet file');
            });
            const result = await loadWallet({
                passphrase: 'wrongpassword',
                walletPath: TEST_WALLET_PATH
            });
            expect(result.success).toBe(false);
            expect(result.error).toContain('Decryption failed');
            expect(result.code).toBe('LOAD_WALLET_ERROR');
        });

        it('returns success: false when passphrase is missing', async () => {
            const result = await loadWallet({ walletPath: TEST_WALLET_PATH });
            expect(result.success).toBe(false);
            expect(result.code).toBe('LOAD_WALLET_ERROR');
        });
    });

    describe('skill metadata', () => {
        it('createWallet has .meta with required fields', () => {
            expect(createWallet.meta).toBeDefined();
            expect(createWallet.meta.name).toBeTruthy();
            expect(createWallet.meta.execution).toBe('local');
        });

        it('loadWallet has .meta with required fields', () => {
            expect(loadWallet.meta).toBeDefined();
            expect(loadWallet.meta.name).toBeTruthy();
        });
    });
});
