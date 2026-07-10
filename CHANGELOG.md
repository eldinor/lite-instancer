# Changelog

## Unreleased

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

### Fixed

- Hardened GLB examples so they choose the loaded scene node that actually contains meshes instead of assuming `container.entities[0]` is always the model root.
