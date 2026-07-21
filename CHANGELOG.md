# Changelog

## 0.5.0 - 2026-07-18

- Fix inverted-hull ordering so opaque hosts write depth before their outline meshes.
- Show five Shader Ball GLB copies through one hierarchy `InstanceSet`, with synchronized outlines on every mesh part.
- Add an eight-part Marble Tower glTF scenario to the outline examples gallery.
- Show three resource-sharing Marble Towers with distinct outline palettes and slowly rotating wheels.
- Add automatic live-skeleton deformation to outline attachments and an animated Vintage Desk Fan glTF example.
- Update the example UI integration to `babylon-lite-explorer` 0.5.0.
- Use retained native Lite glTF geometry directly so the outliner applies exactly one inverted-hull winding reversal.
- Add an imported Babylon Shader Ball scenario to the thin-instance outline gallery.
- Add the Massive Avatar Arena example with three independently baked VAT populations, 2,500-character capacity, normalized action waves, screen-space crowd selection, and an outlined animated `avatar_5` hero.

### Added

- Added the optional `@litools/instancer/outline` entry point with native Babylon Lite WGSL inverted-hull outlines, compact highlighted-instance pools, stable-`InstanceId` and standalone raw-index managers, per-instance colors/phases, smooth outline normals, and animated pulse, color-cycle, edge-flow, rim-flow, and sizzle effects.
- Added the multi-scenario Thin Instance Outline Gallery for selection, box/sphere/cylinder/capsule/torus/torus-knot geometry, colors, normal smoothing, single meshes, effects, and standalone thin instances.
- Diversified the effects gallery so pulse, color cycle, edge flow, rim flow, and sizzle run on distinct sphere, torus, capsule, torus-knot, and box silhouettes.

## 0.3.2 - 2026-07-17

### Changed

- Coalesced VAT playback-parameter uploads during `VatInstanceSet.createMany()` and coordinated `VatCharacterSet.createMany()` calls, avoiding repeated full uploads while preserving per-instance playback data.

### Fixed

- Serve example-only public GLB assets during local development, so the Ready Player examples and GLB VAT Socket Configurator load `/fantasy_sword.glb` as a binary asset instead of Vite's HTML fallback.

## 0.3.1 - 2026-07-17

### Changed

- Updated the Babylon Lite peer and development dependency to `^1.11.0`.

## 0.3.0 - 2026-07-16

### Added

- Added multi-part `VatCharacterSet` support, reusable baked socket assets, full-hierarchy VAT attachments, portable `VatAttachmentPreset` serialization, socket candidate discovery, and GLB/VAT lifecycle disposal helpers.
- Added the GLB VAT Socket Configurator example with Ready Player and Samba Girl presets, local GLB inputs, curated Fantasy Sword attachment, numeric grip controls, and JSON/TypeScript export.
- Added the Unarmed VAT Arena Crowd example. It uses three independently baked groups, selects nine of the source asset's 64 clips, and supports visible crowd density from 300 through 3,000 characters.

### Changed

- `createVatAttachmentController()` now accepts the shared `BaseInstanceSet` contract, enabling full GLB hierarchy attachments as well as single meshes.

## 0.2.1 - 2026-07-13

### Added

- Added a shared `BaseInstanceSet` API type for app-level utilities that work with both single-mesh and hierarchy instance sets.
- Added iteration helpers on instance sets: `ids`, `visibleIds`, `slots`, `entries`, and `forEach`.
- Added bulk helpers: `createMany`, `removeMany`, `setMatrices`, `setTransforms`, and `setVisibleMany`.
- Added non-throwing helpers for stale-ID workflows: `trySetMatrix`, `trySetTransform`, `trySetVisible`, `trySetMetadata`, `getMatrixOrUndefined`, and `getVisibleOrUndefined`.
- Added transform convenience helpers: `getPosition`, `getPositionOrUndefined`, `setPosition`, `trySetPosition`, `translate`, `tryTranslate`, `setScale`, and `trySetScale`.
- Added metadata query/update helpers: `findByMetadata`, `filterByMetadata`, `updateMetadata`, and `tryUpdateMetadata`.
- Added direct common instance-set wrappers on `VatInstanceSet`, so VAT users can call transforms, visibility, metadata, colors, iteration, batching, and raw editing methods without going through `.set`.
- Added `User_Guide.md` with practical usage guidance for the main functions and helpers.

### Changed

- Updated README and docs to mention iteration, bulk operations, non-throwing helpers, the user guide, and the changelog.
- Included `CHANGELOG.md` and `User_Guide.md` in the package file list.
- Narrowed `PickingRegistry`'s accepted set contract to the slot lookup it actually uses, which keeps picking registration compatible with set-like wrappers.
- VAT `batch` now avoids rebuilding per-slot playback parameters for matrix-only batches. It still resyncs playback when batched visibility changes can move slots.
- Shared ID, slot, active-count visibility, metadata, and iteration bookkeeping now lives in one internal slot store used by both single-mesh and hierarchy sets.
- `HierarchyInstanceSet` now tracks dirty slots and flushes targeted hierarchy matrix updates for common matrix, visibility, batch, and raw-edit paths.
- Updated example docs to focus on public API usage patterns and removed internal-oriented wording.

### Fixed

- Restored the shark examples to the shared transform path while keeping VAT animation helpers from the package.
