# Lite Instancer: Next Improvements

Review date: 2026-07-22  
Scope: `@litools/instancer` for Babylon Lite  
Status: Massive Avatar Arena work is complete

## Current Position

The completed thermal-safe Massive Avatar Arena benchmark shows that Lite Instancer's playback synchronization is no longer the main frame-time bottleneck.

At 1,500 animated avatars, the validated quick run reported:

- Playback/update CPU p95: `0.50 ms`.
- GPU p95 during the reaction wave: `24.22 ms`.
- Frame p95 during the reaction wave: `27.80 ms`.
- Playback mutations: `7,500`.
- Backing-array allocations: `0`.
- Rendered geometry: approximately `18.2 million` triangles per frame.

This workload is primarily GPU- and geometry-bound. Further micro-optimization of the current playback map or persistent CPU stream is unlikely to deliver a large visible improvement in Avatar Arena.

The next work should improve sparse GPU uploads, VAT startup and portability, coordinated application updates, and production diagnostics.

## Recommended Priorities

| Priority | Improvement | Main benefit | Dependency |
| ---: | --- | --- | --- |
| 1 | Babylon Lite partial VAT upload boundary | Upload only changed playback ranges | New public Babylon Lite VAT API |
| 2 | Complete portable VAT loading and offline compiler | Remove runtime baking and reduce startup cost | Public raw float VAT texture import |
| 3 | Unified VAT update transaction | Flush transforms, visibility, colors, and playback together | Existing internal batch and stream machinery |
| 4 | General instance-set diagnostics | Make allocation, growth, dirty work, and uploads observable | None |
| 5 | Optional Explorer adapter | Inspect and edit stable instances without exposing slots | Existing control descriptors |
| 6 | Snapshot and simulation bridge | Restore or stream crowds without per-record objects | Stable snapshot contract |

## 1. Partial VAT Uploads

### Current state

`SlotAlignedFloatStream` already tracks dirty slots and coalesces adjacent ranges. VAT playback modifies only affected CPU slots, but Babylon Lite currently accepts a complete submitted prefix through `VatHandle.setInstances()`.

### Proposed Babylon Lite boundary

A public API should accept dirty playback ranges without exposing engine-private GPU objects. A conceptual shape is:

```ts
vatHandle.setInstanceRanges(data, ranges, count);
```

The final API may instead be a standalone Babylon Lite function or a range-aware overload. It should support:

- A capacity-sized source array.
- A live or visible instance count.
- One or more slot ranges.
- Exact upload-call and byte reporting where available.
- A safe full-upload fallback.

### Adapter policy

The instancer should not always submit every dirty range independently. It should estimate the cost of:

- Several partial range uploads.
- One merged range.
- One complete visible-prefix upload.

The cheapest policy can then be selected based on call count and total bytes. This prevents highly fragmented edits from creating excessive GPU queue traffic.

### Expected benefit

Sparse clip, phase, and FPS edits could reduce VAT upload bytes by more than 90%. Avatar Arena may see only a small CPU improvement because its existing total payload is already low, but simulations with occasional per-instance edits would benefit substantially.

## 2. End-to-End Portable VAT Assets

### Current state

The package already provides:

- Versioned `LiteVatAsset` metadata.
- Deterministic manifest and binary codecs.
- Integrity validation.
- Clip, socket, bounds, basis, and source metadata.
- Preprocessing allocation limits.
- A reusable worker pool with queueing, cancellation, timeout, progress, and worker replacement.

The remaining gap is runtime texture creation. `createVatInstanceSetFromAsset()` requires an explicit `LiteVatAssetRuntime` because Babylon Lite does not currently publish a raw `rgba32float` matrix-VAT texture import API.

### Required public boundary

Babylon Lite should expose a supported way to create a `VatBakeResult` or equivalent VAT resource from:

- `Float32Array` matrix data.
- Texture width and height.
- Bone and frame counts.
- Clip row metadata.
- Optional captured socket or bone-origin data.

Lite Instancer must continue avoiding private device, texture, and mesh fields.

### Offline compiler

After the runtime boundary exists, add a separate build-time package or CLI so heavy loaders and headless animation dependencies stay outside the runtime package:

```text
GLB
  -> animation sampling
  -> matrix atlas packing
  -> socket and animated-bound baking
  -> validation and integrity hash
  -> JSON manifest + binary payload
```

A possible command is:

```sh
lit-instancer vat bake character.glb --out character.livat
```

### Expected benefit

- No live-scene VAT baking during normal application startup.
- Lower startup CPU and peak memory.
- Deterministic, cacheable animation artifacts.
- Faster repeat loads.
- A metadata envelope that can later be shared with the Babylon.js adapter while retaining engine-specific payload encodings.

## 3. Unified VAT Update Transaction

### Current state

Ordinary instance updates use `batch()`, while playback changes use `batchPlayback()`. Applications can nest them, but coordinated gameplay updates should have one obvious transaction boundary.

### Proposed API direction

Add a typed VAT transaction writer that can coordinate:

- Matrix and transform changes.
- Visibility changes.
- Color changes.
- Clip, phase, and FPS changes.

For example:

```ts
characters.batchInstances((writer) => {
  writer.setTransform(id, transform);
  writer.setPlayback(id, { clip: "Run", fps: 30 });
  writer.setColor(id, [1, 0.8, 0.7, 1]);
});
```

The transaction should flush each affected backend stream no more than once. Multi-part `VatCharacterSet` updates must remain coordinated across every mesh part.

### Expected benefit

- Fewer accidental uploads from separately issued operations.
- Simpler application code.
- A clean update boundary for ECS, worker, and network integrations.
- Matching behavior that can later be implemented by the Babylon.js adapter.

## 4. General Diagnostics

Playback upload statistics proved valuable in Avatar Arena. Extend the same observability to ordinary and hierarchy sets.

Suggested counters include:

- Matrix, color, and playback dirty slots.
- Coalesced dirty ranges.
- CPU bytes rewritten.
- Backend calls and bytes uploaded.
- No-op updates skipped.
- Buffer allocations and capacity growth.
- Capacity and live-count high-water marks.
- Full-upload versus partial-upload decisions.

Diagnostics should be cheap, read-only, and consistent across Lite and the future Babylon.js implementation. They should distinguish CPU dirty bytes from actual GPU submission bytes.

## 5. Optional Explorer Adapter

The package already contains side-effect-free control descriptors and a VAT control adapter. The next tooling step is an optional Babylon Lite Explorer integration that:

- Lists stable IDs rather than slots.
- Edits clip, FPS, phase, visibility, and tint.
- Displays metadata and current slot as diagnostics.
- Shows capabilities, fallbacks, and stream statistics.
- Does not add Explorer dependencies to the core entry point.

This should live behind a separate export or integration package.

## 6. Snapshot and Simulation Bridge

Large simulations often already store transforms and playback state in packed arrays. Creating temporary JavaScript objects for every update adds avoidable allocation pressure.

A future bridge should support:

- Typed-array or structure-of-arrays transform input.
- Packed playback updates.
- Stable application keys mapped to current `InstanceId` values.
- Versioned snapshots of transforms, visibility, colors, playback, and optional metadata.
- Restore with explicit old-ID to new-ID mapping rather than assuming renderer IDs can be imported blindly.

This should be designed as a narrow data-transfer boundary, not as a full ECS or networking framework.

## Work to Defer

The following items should remain later work:

- LOD integration and VAT GPU culling.
- Public application-defined GPU streams before Babylon Lite has a stable shader consumer boundary.
- Float16 and dual-quaternion VAT encodings before quality and performance benchmarks justify them.
- A general material or shader framework.
- Runtime Shado, decorators, AssemblyScript compilation, or a Shado dependency.
- Extraction of an `@litools/instancer-core` package before the Babylon.js adapter proves the shared implementation surface.

Animated whole-model and per-clip bounds should remain in portable assets so future culling work has correct data, but they do not need to drive rendering yet.

## Recommended Implementation Order

1. Propose or implement public Babylon Lite boundaries for partial VAT updates and raw float VAT import.
2. Add the range-cost policy to the existing Lite VAT stream adapter.
3. Complete `createVatInstanceSetFromAsset()` without requiring an application-supplied runtime.
4. Build the standalone offline VAT compiler and deterministic fixtures.
5. Add a unified VAT update transaction.
6. Generalize diagnostics across ordinary, hierarchy, VAT, and character sets.
7. Add the optional Explorer adapter.
8. Design snapshot and packed-simulation integration from real consumer requirements.

## Acceptance Principles

- Preserve stable `InstanceId` semantics.
- Keep slots and GPU indices internal.
- Avoid Babylon Lite private fields.
- Keep runtime and build-time dependencies separate.
- Measure CPU dirty bytes independently from GPU upload bytes.
- Preserve zero steady-state backing-array allocations.
- Keep engine-neutral behavior compatible with the future Babylon.js adapter.
- Require typecheck, unit contracts, package validation, and focused manual WebGPU/WebGL smoke tests; do not require Playwright.
