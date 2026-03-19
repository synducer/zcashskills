# ZCash Skills

> Privacy-preserving ZCash skills for AI agents with local cryptographic operations

[![npm version](https://badge.fury.io/js/zcashskills.svg)](https://badge.fury.io/js/zcashskills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/konradgnat/zcashskills/workflows/Node.js%20CI/badge.svg)](https://github.com/konradgnat/zcashskills/actions)

## 🎯 Overview

ZCashSkills is the first executable skills repository for ZCash AI agents, bringing privacy-preserving cryptocurrency operations directly to your agent's server with zero external dependencies.

**Key Features:**
- 🔐 **Privacy-First**: Shielded addresses by default
- ⚡ **Local Execution**: No external services required
- 🤖 **AI-Native**: Designed for agent consumption
- 🌍 **Cross-Platform**: Pre-compiled binaries for all major platforms
- 🔒 **Secure**: Uses official librustzcash cryptography

## 🚀 Quick Start

### Installation

```bash
npm install zcashskills
```

### Basic Usage

```javascript
const zcashSkills = require('zcashskills');

// Generate a private ZCash address
const result = await zcashSkills.generateAddress({ network: 'testnet' });
console.log(result.address);
// Output: ztestsapling1abc123def456ghi789...

// Create a payment URI
const uri = await zcashSkills.createPaymentUri({
  address: result.address,
  amount: 0.001,
  memo: 'Coffee payment'
});
console.log(uri.uri);
// Output: zcash:ztestsapling1...?amount=0.001&memo=Coffee%20payment
```

## 📋 Available Skills

### Core Skills

| Skill | Description | Status |
|-------|-------------|--------|
| `generate-address` | Generate ZCash shielded addresses locally | ✅ MVP |
| `validate-address` | Validate ZCash address format and network | ✅ MVP |
| `create-payment-uri` | Create ZIP-321 payment URIs | ✅ MVP |
| `parse-payment-uri` | Parse ZIP-321 URIs into structured data | ✅ MVP |

### Future Skills

| Skill | Description | Status |
|-------|-------------|--------|
| `check-balance` | Check address balance | 🔄 Planned |
| `send-payment` | Send ZCash payments | 🔄 Planned |
| `generate-viewing-key` | Generate viewing keys | 🔄 Planned |

## 🔧 Skills API

### generate-address

Generate new ZCash shielded addresses using librustzcash.

```javascript
const result = await zcashSkills.generateAddress({
  network: 'mainnet' // or 'testnet'
});

// Returns:
{
  success: true,
  address: 'zs1abc123def456ghi789...',
  network: 'mainnet',
  type: 'shielded',
  execution: 'local',
  message: 'Generated new ZCash mainnet address'
}
```

### validate-address

Validate ZCash address format and detect network/type.

```javascript
const result = await zcashSkills.validateAddress({
  address: 'ztestsapling1abc123...'
});

// Returns:
{
  success: true,
  valid: true,
  network: 'testnet',
  type: 'shielded',
  recommendations: ['Address supports privacy-preserving transactions']
}
```

### create-payment-uri

Create ZIP-321 compliant payment URIs.

```javascript
const result = await zcashSkills.createPaymentUri({
  address: 'ztestsapling1abc123...',
  amount: 0.001,           // Optional
  memo: 'Payment memo',    // Optional
  label: 'Store Purchase'  // Optional
});

// Returns:
{
  success: true,
  uri: 'zcash:ztestsapling1...?amount=0.001&memo=Payment%20memo',
  details: { address, amount, memo, label }
}
```

### parse-payment-uri

Parse ZIP-321 payment URIs into structured data.

```javascript
const result = await zcashSkills.parsePaymentUri({
  uri: 'zcash:ztestsapling1...?amount=0.001&memo=Coffee'
});

// Returns:
{
  success: true,
  parsed: {
    address: 'ztestsapling1abc123...',
    amount: 0.001,
    memo: 'Coffee',
    label: null
  }
}
```

## 🤖 AI Agent Integration

### OpenClaw Integration

```javascript
// OpenClaw skill file
const zcashSkills = require('zcashskills');

class PrivacyPaymentAgent {
  async generatePrivateAddress(network = 'mainnet') {
    const result = await zcashSkills.generateAddress({ network });
    
    if (result.success) {
      return `🔐 Generated private ${network} address: ${result.address}`;
    } else {
      return `❌ Failed to generate address: ${result.error}`;
    }
  }
  
  async createPaymentRequest(address, amount, memo) {
    const validation = await zcashSkills.validateAddress({ address });
    if (!validation.valid) {
      return `❌ Invalid address: ${address}`;
    }

    const uri = await zcashSkills.createPaymentUri({ address, amount, memo });
    if (uri.success) {
      return `💳 Payment request: ${uri.uri}`;
    } else {
      return `❌ Failed to create payment request: ${uri.error}`;
    }
  }
}

module.exports = PrivacyPaymentAgent;
```

### LangChain Tool Integration

```javascript
const { DynamicTool } = require('langchain/tools');
const zcashSkills = require('zcashskills');

const generateZcashTool = new DynamicTool({
  name: "generate-zcash-address",
  description: "Generate a ZCash shielded address for privacy payments",
  func: async (input) => {
    const { network = 'mainnet' } = JSON.parse(input);
    const result = await zcashSkills.generateAddress({ network });
    return JSON.stringify(result);
  }
});

const createPaymentTool = new DynamicTool({
  name: "create-zcash-payment-uri", 
  description: "Create a ZCash payment URI for requesting payments",
  func: async (input) => {
    const params = JSON.parse(input);
    const result = await zcashSkills.createPaymentUri(params);
    return JSON.stringify(result);
  }
});

module.exports = { generateZcashTool, createPaymentTool };
```

## 🏗️ Architecture

### Local Execution

ZCashSkills runs entirely on your agent's server with no external dependencies:

- ✅ **Rust cryptography** compiled to native Node.js modules
- ✅ **librustzcash** integration for official ZCash cryptographic operations  
- ✅ **Cross-platform binaries** for Linux, macOS, and Windows
- ✅ **Zero network calls** for core cryptographic operations

### Platform Support

Pre-compiled binaries are provided for:

- **linux-x64** - Most servers and cloud environments
- **darwin-x64** - Intel-based macOS systems
- **darwin-arm64** - Apple Silicon Macs (M1/M2/M3)
- **win32-x64** - Windows servers and development machines

### Security

- 🔐 **Private keys** generated and stored locally
- 🚫 **No external API calls** for cryptographic operations
- 🔍 **Auditable code** - all source code included
- 🛡️ **Official cryptography** - uses librustzcash

## 🧪 Development

### Prerequisites

- Node.js 16+
- Rust (only if building from source)

### Building from Source

```bash
git clone https://github.com/konradgnat/zcashskills.git
cd zcashskills
npm install
npm run build
npm test
```

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only  
npm run test:integration
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Adding New Skills

1. Create skill directory: `skills/my-new-skill/`
2. Implement skill: `skills/my-new-skill/index.js`
3. Add tests: `test/unit/my-new-skill.test.js`
4. Update documentation
5. Submit pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/konradgnat/zcashskills)
- [NPM Package](https://www.npmjs.com/package/zcashskills)
- [Issue Tracker](https://github.com/konradgnat/zcashskills/issues)
- [ZCash Foundation](https://www.zfnd.org/)
- [OpenClaw Platform](https://openclaw.ai/)

## 🏆 Acknowledgments

- [ZCash Foundation](https://www.zfnd.org/) for the amazing privacy technology
- [librustzcash](https://github.com/zcash/librustzcash) for the cryptographic foundation
- [Austin Griffith](https://github.com/austintgriffith/ethskills) for ethskills inspiration
- [OpenClaw](https://openclaw.ai/) for the AI agent platform

---

**Made with ❤️ for the privacy-preserving future of AI agents**