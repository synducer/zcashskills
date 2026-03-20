# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZCashSkills is an npm package providing privacy-preserving ZCash cryptographic operations for AI agents. It wraps Rust code (librustzcash) via Neon bindings into a Node.js native addon, enabling local shielded address generation and validation with zero network calls.

## Build & Test Commands

```bash
npm install              # Install deps + triggers native build via scripts/install.js
npm run build            # Build Rust native module via Neon (neon build --release)
npm run rebuild          # Alias for build
npm test                 # Run all tests (Jest)
npm run test:unit        # Unit tests only (test/unit/)
npm run test:integration # Integration tests only (test/integration/)
npm run lint             # ESLint on lib/, skills/, examples/
```

Building from source requires Rust (rustup.rs). Pre-compiled binaries go in `prebuilds/<platform-arch>/zcash-native.node`.

## Architecture

**Two-layer design: JS skills wrapping a Rust native module.**

- `native/src/lib.rs` — Rust core exposing two Neon functions: `generateShieldedAddress` and `validateAddress`. Uses `zcash_keys`, `zcash_address`, and `rand` crates. This is where actual cryptography happens.
- `native/src/addon.cpp` + `binding.gyp` — C++ N-API addon (alternative build path via node-addon-api).
- `lib/native-loader.js` — Platform detection and binary loading. Tries prebuilt binary from `prebuilds/<platform>-<arch>/zcash-native.node`, falls back to building from source.
- `lib/index.js` — Main entry point. Aggregates all skills and exposes convenience methods.
- `lib/utils.js` — ZIP-321 URI creation/parsing helpers used by payment URI skills.
- `lib/constants.js` — Network configs, address prefixes, validation rules.
- `skills/*/index.js` — Each skill is a standalone async function module. Skills call into the native module via `native-loader` for crypto ops, or use pure JS (payment URI skills use `lib/utils.js`).

**Skill pattern:** Each skill module exports an async function + `.meta` object for discovery. Skills return `{ success: true/false, ... }` result objects with error details and suggestions on failure.

## Adding a New Skill

1. Create `skills/<skill-name>/index.js` following the pattern in existing skills
2. Import native module if needed: `const native = require('../../lib/native-loader')`
3. Export async function + `.meta` object
4. Wire it into `lib/index.js`
5. Add tests in `test/unit/<skill-name>.test.js`

## Key Details

- Node.js >=16 required
- Rust native module built via Neon (`@neon-rs/cli`), configured in `native/Cargo.toml`
- Address prefixes: mainnet shielded = `zs1`, testnet shielded = `ztestsapling1`
- The native module is loaded at require-time (not lazy) — loading failures throw immediately
- Tests mock `console.log`/`console.error` in `beforeEach` since skills log progress messages
