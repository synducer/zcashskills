# ZCash Skills

> Privacy-preserving ZCash wallet SDK for AI agents — powered by librustzcash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What This Is

ZCashSkills is the first ZCash wallet SDK designed for AI agents (OpenClaw, LangChain). It wraps the official [librustzcash](https://github.com/zcash/librustzcash) cryptographic library into a native Node.js module via Neon bindings, providing shielded wallet operations with full transaction support.

All private key operations happen inside Rust — seeds are encrypted before crossing the FFI boundary and never appear in JavaScript memory. Transaction building and Groth16 proof generation also execute entirely in Rust.

## Features

| Skill | What It Does | Status |
|-------|-------------|--------|
| **generate-address** | Generate real ZCash shielded addresses (mainnet/testnet) | ✅ Working |
| **validate-address** | Validate address format, detect network and type | ✅ Working |
| **create-payment-uri** | Create ZIP-321 payment URIs for receiving funds | ✅ Working |
| **parse-payment-uri** | Parse ZIP-321 URIs into structured data | ✅ Working |
| **wallet-persist** | Create/unlock encrypted wallets with BIP-39 mnemonic backup | ✅ Working |
| **viewing-keys** | Export IVK/FVK/UFVK for selective disclosure (ZIP-316) | ✅ Working |
| **send-transaction** | Send z-to-z shielded payments with Sapling Groth16 proofs | ✅ Working |
| **check-balance** | Check shielded wallet balance by scanning the blockchain | ✅ Working |

## Quick Start

### Prerequisites

- Node.js 16+
- Rust toolchain (for building from source): https://rustup.rs/

### Install & Build

```bash
git clone https://github.com/synducer/zcashskills.git
cd zcashskills
npm install
cd native && cargo build --release && cd ..
```

### Demo: Full Wallet Flow

```javascript
const zcash = require('./lib/index');

async function demo() {
  // 1. Create an encrypted wallet (seed never leaves Rust)
  const wallet = await zcash.walletPersist.createWallet({
    passphrase: 'my-secure-passphrase-here',
    network: 'mainnet',
    walletPath: './my-wallet.json'
  });
  console.log('Address:', wallet.address);
  console.log('Mnemonic (SAVE THIS):', wallet.mnemonic);
  // wallet.json is encrypted with Argon2id + XChaCha20-Poly1305

  // 2. Create a payment URI so someone can send you ZEC
  const uri = await zcash.createPaymentUri({
    address: wallet.address,
    amount: 0.01,
    memo: 'Test payment'
  });
  console.log('Payment URI:', uri.uri);

  // 3. Later: unlock the wallet
  const loaded = await zcash.walletPersist.loadWallet({
    passphrase: 'my-secure-passphrase-here',
    walletPath: './my-wallet.json'
  });
  console.log('Unlocked address:', loaded.address);

  // 4. Send shielded ZCash
  const tx = await zcash.sendTransaction({
    passphrase: 'my-secure-passphrase-here',
    toAddress: 'zs1recipient...',
    amount: 0.5,
    memo: 'Payment for services',
    walletPath: './my-wallet.json'
  });
  console.log('Transaction ID:', tx.txId);

  // 5. Export a viewing key for an auditor (privacy-safe)
  const ivk = await zcash.viewingKeys.getIncomingViewingKey({
    passphrase: 'my-secure-passphrase-here',
    walletPath: './my-wallet.json'
  });
  console.log('Incoming Viewing Key:', ivk.viewingKey);
  // Starts with uivk1... — only reveals incoming transactions
}

demo().catch(console.error);
```

## Sending ZCash

The `sendTransaction` skill handles the full shielded payment pipeline:

1. **Wallet decryption** — Unlocks the encrypted seed in Rust
2. **Proving parameters** — Downloads Sapling Groth16 params (~50MB, cached at `~/.zcash-params/`)
3. **Block scanning** — Connects to lightwalletd via gRPC, trial-decrypts compact blocks to find spendable notes
4. **Transaction building** — Constructs the Sapling transaction with Groth16 proofs (all in Rust)
5. **Broadcasting** — Submits the signed transaction to the network via lightwalletd

```javascript
const result = await zcash.sendTransaction({
  passphrase: 'your-passphrase',
  toAddress: 'zs1...',           // Destination Sapling address
  amount: 0.5,                   // Amount in ZEC
  memo: 'Optional memo text',   // Up to 511 bytes
  network: 'mainnet',           // 'mainnet' or 'testnet'
});

// Result: { success, txId, rawTx, amount, toAddress, fee, network }
```

**Lightwalletd servers used:**
- Mainnet: `mainnet.lightwalletd.com:9067`
- Testnet: `lightwalletd.testnet.electriccoin.co:9067`

**Transaction fee:** 0.0001 ZEC (10,000 zatoshis) — ZIP-317 conventional fee.

## Security Model

- **Seed encryption**: Argon2id KDF (OWASP params) + XChaCha20-Poly1305 AEAD
- **Key isolation**: Raw seed is generated, encrypted, and zeroed inside Rust — never crosses FFI as plaintext
- **Transaction signing**: Spending keys are derived and used entirely within Rust; Groth16 proofs generated in Rust
- **Wallet files**: Encrypted JSON with 0600 permissions, includes KDF params and birthday height
- **BIP-39 backup**: 24-word mnemonic phrase shown once at creation
- **Viewing key privacy**: IVK (incoming only) is the default export; FVK (exposes outgoing graph) requires explicit `confirm: true`
- **Proving parameters**: SHA-256 verified on download from z.cash official servers

## Architecture

```
┌─────────────────────────────────────────────┐
│                  JS Layer                    │
│  skills/generate-address/index.js           │
│  skills/validate-address/index.js           │
│  skills/create-payment-uri/index.js         │
│  skills/parse-payment-uri/index.js          │
│  skills/wallet-persist/index.js             │
│  skills/viewing-keys/index.js               │
│  skills/send-transaction/index.js           │
│  lib/index.js  lib/utils.js  lib/constants.js│
│  lib/grpc-client.js  lib/params-loader.js   │
├─────────────────────────────────────────────┤
│              lib/native-loader.js            │
│         (platform detection + loading)       │
├─────────────────────────────────────────────┤
│              Rust Native Module              │
│            native/src/lib.rs                 │
│                                              │
│  generateShieldedAddress  validateAddress    │
│  createWallet             loadWallet         │
│  deriveViewingKey         scanNotes          │
│  createTransaction                           │
│                                              │
│  Crates: zcash_keys 0.12, zcash_address 0.10│
│          zcash_primitives 0.26, zcash_proofs │
│          sapling-crypto 0.5, bip39 2.0       │
│          argon2 0.5, chacha20poly1305        │
│          neon 0.10 (Node.js FFI)             │
├─────────────────────────────────────────────┤
│              Network Layer (JS)              │
│  lightwalletd gRPC (block sync + broadcast) │
│  proto/service.proto + compact_formats.proto │
│  @grpc/grpc-js + @grpc/proto-loader         │
└─────────────────────────────────────────────┘
```

## AI Agent Integration

### OpenClaw Skill

```javascript
const zcash = require('zcashskills');

// Agent creates a wallet for a user
const wallet = await zcash.walletPersist.createWallet({
  passphrase: userPassphrase,
  network: 'mainnet',
  walletPath: `./wallets/${userId}.json`
});

// Agent generates a payment request
const paymentUri = await zcash.createPaymentUri({
  address: wallet.address,
  amount: 0.5,
  memo: 'Payment for services'
});

// Agent sends a shielded payment
const tx = await zcash.sendTransaction({
  passphrase: userPassphrase,
  toAddress: recipientAddress,
  amount: 0.25,
  memo: 'Automated payment',
  walletPath: `./wallets/${userId}.json`
});
```

### LangChain Tools

```javascript
const { DynamicTool } = require('langchain/tools');
const zcash = require('zcashskills');

const sendZcashTool = new DynamicTool({
  name: "send-zcash",
  description: "Send shielded ZCash to a destination address",
  func: async (input) => {
    const { passphrase, toAddress, amount, memo } = JSON.parse(input);
    const result = await zcash.sendTransaction({
      passphrase, toAddress, amount, memo
    });
    return JSON.stringify({
      txId: result.txId,
      amount: result.amount,
      fee: result.fee,
      message: result.message
    });
  }
});
```

## API Reference

### zcash.checkBalance(options)

Check the shielded wallet balance by scanning the blockchain via lightwalletd.

| Param | Type | Description |
|-------|------|-------------|
| passphrase | string | Wallet passphrase |
| network | string | `'mainnet'` or `'testnet'` (default: `'mainnet'`) |
| walletPath | string | Path to wallet.json (default: `~/.zcashskills/wallet.json`) |
| serverUrl | string | Override lightwalletd server URL |

Returns: `{ success, balance, balanceZatoshis, address, notes, notesUnspent, network, chainHeight }`

### zcash.sendTransaction(options)

Send shielded ZCash via Sapling.

| Param | Type | Description |
|-------|------|-------------|
| passphrase | string | Wallet passphrase |
| toAddress | string | Destination Sapling address (`zs1...`) |
| amount | number | Amount in ZEC (e.g. `0.5`) |
| memo | string | Optional memo text (max 511 bytes) |
| network | string | `'mainnet'` or `'testnet'` (default: `'mainnet'`) |
| walletPath | string | Path to wallet.json (default: `~/.zcashskills/wallet.json`) |
| serverUrl | string | Override lightwalletd server URL |

Returns: `{ success, txId, rawTx, amount, amountZatoshis, toAddress, fee, feeZatoshis, network, memo }`

### zcash.walletPersist.createWallet(options)

Create a new encrypted wallet.

| Param | Type | Description |
|-------|------|-------------|
| passphrase | string | Min 8 chars. Used to derive encryption key via Argon2id |
| network | string | `'mainnet'` or `'testnet'` |
| walletPath | string | Optional. Path for wallet.json (default: `~/.zcashskills/wallet.json`) |

Returns: `{ success, address, mnemonic, walletPath, birthdayHeight, network }`

### zcash.walletPersist.loadWallet(options)

Unlock an existing wallet.

| Param | Type | Description |
|-------|------|-------------|
| passphrase | string | Same passphrase used at creation |
| walletPath | string | Path to wallet.json |

Returns: `{ success, address, network, birthdayHeight, createdAt }`

### zcash.viewingKeys.getIncomingViewingKey(options)

Export incoming viewing key (privacy-safe — reveals only inbound transactions).

Returns: `{ success, viewingKey, keyType: 'incoming' }` — key starts with `uivk1...`

### zcash.viewingKeys.getFullViewingKey(options)

Export full viewing key (requires `confirm: true` — exposes outgoing tx graph).

Returns: `{ success, viewingKey, keyType: 'full' }` — key starts with `uview1...` (ZIP-316 bech32m)

### zcash.generateAddress(options)

Generate a new shielded address (no wallet persistence).

### zcash.validateAddress(options)

Validate a ZCash address and detect network/type.

### zcash.createPaymentUri(options)

Create a ZIP-321 payment URI.

### zcash.parsePaymentUri(options)

Parse a ZIP-321 payment URI.

## Tests

```bash
npm test           # Run all tests
npm run test:unit  # Unit tests only
```

## Roadmap

- [x] Phase 1: Encrypted wallet persistence (Argon2id + XChaCha20-Poly1305)
- [x] Phase 2: Viewing key export (IVK/FVK/UFVK per ZIP-316)
- [x] Phase 3: Send shielded transactions (Sapling Groth16 proofs via lightwalletd)
- [x] Phase 4: Balance checking via lightwalletd (block scanning + trial decryption)
- [ ] Phase 5: npm publish + OpenClaw ClawHub skill + ZCG grant application

## ZCash Community Grants

This project targets [ZCash Community Grants](https://zcashcommunitygrants.org/) funding in the categories:
- **SDK** — First Node.js ZCash wallet SDK using official librustzcash
- **Key-management tools** — Encrypted seed persistence with BIP-39 backup
- **Easy one-click shielded payments** — AI agent-powered payment workflows

## License

MIT — see [LICENSE](LICENSE)

## Acknowledgments

- [librustzcash](https://github.com/zcash/librustzcash) — Official ZCash cryptographic foundation
- [ZCash Foundation](https://www.zfnd.org/) — Privacy technology
- [ethskills](https://github.com/austintgriffith/ethskills) — Inspiration (Austin Griffith)
- [OpenClaw](https://openclaw.ai/) — AI agent platform
