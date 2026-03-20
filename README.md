# ZCash Skills

> Privacy-preserving ZCash wallet SDK for AI agents — powered by librustzcash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What This Is

ZCashSkills is the first ZCash wallet SDK designed for AI agents (OpenClaw, LangChain). It wraps the official [librustzcash](https://github.com/zcash/librustzcash) cryptographic library into a native Node.js module via Neon bindings, providing shielded wallet operations with **zero external network calls** for all cryptographic operations.

All private key operations happen inside Rust — seeds are encrypted before crossing the FFI boundary and never appear in JavaScript memory.

## Features

| Skill | What It Does | Status |
|-------|-------------|--------|
| **generate-address** | Generate real ZCash shielded addresses (mainnet/testnet) | ✅ Working |
| **validate-address** | Validate address format, detect network and type | ✅ Working |
| **create-payment-uri** | Create ZIP-321 payment URIs for receiving funds | ✅ Working |
| **parse-payment-uri** | Parse ZIP-321 URIs into structured data | ✅ Working |
| **wallet-persist** | Create/unlock encrypted wallets with BIP-39 mnemonic backup | ✅ Working |
| **viewing-keys** | Export IVK/FVK/UFVK for selective disclosure (ZIP-316) | ✅ Working |
| **check-balance** | Query shielded balance via lightwalletd | 🔄 Planned |
| **send-payment** | Send z-to-z shielded payments | 🔄 Planned |

## Quick Start

### Prerequisites

- Node.js 16+
- Rust toolchain (for building from source): https://rustup.rs/

### Install & Build

```bash
git clone https://github.com/konradgnat/zcashskills.git
cd zcashskills
npm install
cd native && cargo build --release && cd ..
cp native/index.node prebuilds/darwin-arm64/zcash-native.node  # adjust platform
npm test  # 41 tests should pass
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

  // 4. Export a viewing key for an auditor (privacy-safe)
  const ivk = await zcash.viewingKeys.getIncomingViewingKey({
    passphrase: 'my-secure-passphrase-here',
    walletPath: './my-wallet.json'
  });
  console.log('Incoming Viewing Key:', ivk.viewingKey);
  // Starts with uivk1... — only reveals incoming transactions

  // 5. Export full viewing key (requires explicit confirmation)
  const fvk = await zcash.viewingKeys.getFullViewingKey({
    passphrase: 'my-secure-passphrase-here',
    walletPath: './my-wallet.json',
    confirm: true  // Required — FVK exposes outgoing tx graph
  });
  console.log('Full Viewing Key:', fvk.viewingKey);
  // Starts with uview1... — ZIP-316 bech32m encoded
}

demo().catch(console.error);
```

## Security Model

- **Seed encryption**: Argon2id KDF (OWASP params) + XChaCha20-Poly1305 AEAD
- **Key isolation**: Raw seed is generated, encrypted, and zeroed inside Rust — never crosses FFI as plaintext
- **Wallet files**: Encrypted JSON with 0600 permissions, includes KDF params and birthday height
- **BIP-39 backup**: 24-word mnemonic phrase shown once at creation
- **Viewing key privacy**: IVK (incoming only) is the default export; FVK (exposes outgoing graph) requires explicit `confirm: true`
- **No network calls**: All cryptographic operations are purely local

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
│  lib/index.js  lib/utils.js  lib/constants.js│
├─────────────────────────────────────────────┤
│              lib/native-loader.js            │
│         (platform detection + loading)       │
├─────────────────────────────────────────────┤
│              Rust Native Module              │
│            native/src/lib.rs                 │
│                                              │
│  generateShieldedAddress  validateAddress    │
│  createWallet             loadWallet         │
│  deriveViewingKey                            │
│                                              │
│  Crates: zcash_keys 0.12, zcash_address 0.10│
│          bip39 2.0, argon2 0.5, chacha20poly1305│
│          neon 0.10 (Node.js FFI)             │
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

// Share the URI — user pays from any ZCash wallet
console.log(`Pay here: ${paymentUri.uri}`);
```

### LangChain Tools

```javascript
const { DynamicTool } = require('langchain/tools');
const zcash = require('zcashskills');

const createWalletTool = new DynamicTool({
  name: "create-zcash-wallet",
  description: "Create an encrypted ZCash wallet with a shielded address",
  func: async (input) => {
    const { passphrase, network } = JSON.parse(input);
    const result = await zcash.walletPersist.createWallet({
      passphrase, network, walletPath: './agent-wallet.json'
    });
    return JSON.stringify({
      address: result.address,
      mnemonic: result.mnemonic,
      message: 'Wallet created. Save the mnemonic phrase securely.'
    });
  }
});
```

## API Reference

### zcash.walletPersist.createWallet(options)

Create a new encrypted wallet.

| Param | Type | Description |
|-------|------|-------------|
| passphrase | string | Min 8 chars. Used to derive encryption key via Argon2id |
| network | string | `'mainnet'` or `'testnet'` |
| walletPath | string | Optional. Path for wallet.json (default: `./zcash-wallet.json`) |

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
npm test           # 41 tests, 3 suites
npm run test:unit  # Unit tests only
```

## Roadmap

- [x] Phase 1: Encrypted wallet persistence (Argon2id + XChaCha20-Poly1305)
- [x] Phase 2: Viewing key export (IVK/FVK/UFVK per ZIP-316)
- [ ] Phase 3: Balance checking via lightwalletd
- [ ] Phase 4: Shielded send (z-to-z with Sapling proofs)
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
