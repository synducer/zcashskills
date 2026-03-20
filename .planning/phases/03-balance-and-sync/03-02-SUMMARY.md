---
phase: 03-balance-and-sync
plan: 02
subsystem: api
tags: [grpc, protobuf, lightwalletd, grpc-js, proto-loader, protobufjs, compact-blocks]

# Dependency graph
requires:
  - phase: 03-balance-and-sync
    provides: Plan 01 Rust side (note scanning) — shares no files with this plan

provides:
  - proto/service.proto with CompactTxStreamer gRPC service definition
  - proto/compact_formats.proto with CompactBlock protobuf message definition
  - lib/lightwalletd.js with createClient, getLatestBlock, fetchBlocksAsProtoBytes
  - "@grpc/grpc-js and @grpc/proto-loader in package.json"

affects:
  - 03-balance-and-sync plan 03+
  - Any plan that calls native.scanBlocks with blocks fetched via lightwalletd

# Tech tracking
tech-stack:
  added:
    - "@grpc/grpc-js ^1.14.3 — gRPC runtime for Node.js"
    - "@grpc/proto-loader — proto file loading, brings protobufjs as transitive dep"
  patterns:
    - "JS handles async gRPC streaming; Rust handles note decryption — clear language boundary"
    - "Re-encode deserialized JS objects back to raw protobuf bytes via protobufjs so Rust prost can decode"
    - "maxBlocks guard (10k) prevents accidental large sync requests"
    - "Dual CompactBlock lookup (fully-qualified then bare name) for proto namespace resilience"

key-files:
  created:
    - proto/service.proto
    - proto/compact_formats.proto
    - lib/lightwalletd.js
  modified:
    - package.json (added @grpc/grpc-js, @grpc/proto-loader)
    - package-lock.json

key-decisions:
  - "protobufjs used for re-encoding: @grpc/grpc-js deserializes CompactBlock to JS objects by default; Rust prost needs raw bytes — re-encode each block via protobufjs.encode().finish()"
  - "keepCase:true in proto-loader options to preserve snake_case field names matching Rust prost wire format"
  - "protobufjs NOT installed separately — available as transitive dep of @grpc/proto-loader"
  - "Package namespace cash.z.wallet.sdk.rpc confirmed from downloaded proto files"

patterns-established:
  - "createClient pattern: protoLoader.loadSync + grpc.loadPackageDefinition + proto.cash.z.wallet.sdk.rpc.CompactTxStreamer"
  - "Streaming pattern: call.on('data') re-encodes each block, call.on('end') resolves or rejects"

requirements-completed: [SYNC-01]

# Metrics
duration: 2min
completed: 2026-03-20
---

# Phase 3 Plan 02: gRPC Client Infrastructure Summary

**@grpc/grpc-js streaming client with protobufjs re-encoding — fetches CompactBlocks from lightwalletd and returns raw protobuf Buffer[] for Rust prost decode**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-20T13:28:45Z
- **Completed:** 2026-03-20T13:30:51Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Downloaded canonical proto files (service.proto, compact_formats.proto) from zcash/lightwallet-protocol
- Installed @grpc/grpc-js and @grpc/proto-loader; protobufjs available as transitive dep
- Implemented lib/lightwalletd.js with three exports matching the JS-Rust boundary contract
- fetchBlocksAsProtoBytes re-encodes each JS CompactBlock object back to raw protobuf bytes so Rust's prost::Message::decode() receives valid wire-format data
- All 41 existing tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Download proto files and install npm dependencies** - `b1fdfe9` (chore)
2. **Task 2: Implement lib/lightwalletd.js gRPC client module** - `1a8e9cf` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `proto/service.proto` - CompactTxStreamer gRPC service definition from zcash/lightwallet-protocol
- `proto/compact_formats.proto` - CompactBlock protobuf message definition
- `lib/lightwalletd.js` - createClient, getLatestBlock, fetchBlocksAsProtoBytes exports
- `package.json` - Added @grpc/grpc-js and @grpc/proto-loader dependencies
- `package-lock.json` - Updated lockfile

## Decisions Made

- **Re-encoding approach:** @grpc/grpc-js deserializes CompactBlock messages to JS objects before delivering to `call.on('data')`. Since Rust's prost expects raw protobuf bytes, each received block is re-encoded using protobufjs `CompactBlockType.encode(block).finish()`. This avoids needing a custom deserializer and keeps the gRPC client standard.
- **protobufjs source:** Not installed directly — used as transitive dep of @grpc/proto-loader to avoid version conflicts.
- **keepCase:true:** Ensures proto field names stay snake_case, matching Rust prost's wire format expectations.
- **maxBlocks=10000 guard:** Prevents accidental large sync requests; callers must paginate above this limit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - canonical proto URLs responded immediately, npm install succeeded, proto namespace matched expected `cash.z.wallet.sdk.rpc`.

## User Setup Required

None - no external service configuration required at this stage. A live lightwalletd endpoint (e.g., zec.rocks:443) is needed when calling createClient in production, but no configuration files are required.

## Next Phase Readiness

- JS gRPC layer ready: createClient + fetchBlocksAsProtoBytes return Buffer[] for Rust integration
- Proto files committed and stable; Plan 03 can reference them
- Rust scanning layer (Plan 01) plus this JS layer together enable the full sync loop in Plan 03+
- No blockers from this plan

---
*Phase: 03-balance-and-sync*
*Completed: 2026-03-20*
