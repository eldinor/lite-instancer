# Changelog

## 0.2.0 - 2026-07-23

### Added

- Add independent slot-aligned float streams with lifecycle-aware defaults, dirty-range coalescing, upload diagnostics, and native Babylon.js partial-buffer adapters.
- Add atomic `setPlayback()`/`setPlaybackMany()` and nested-safe `batchPlayback()` APIs to VAT instance and character sets.
- Add a standalone thermal-safe 100/500/1,000/1,500 lifecycle and partial-upload benchmark with centered status, camera locking, and copyable JSON reports.
- Add `auto`, `manual`, and conservative `fixed` bounds policies plus public `refreshBounds()` support across ordinary, hierarchy, VAT, and character sets.
- Add deterministic `babylon-matrix-vat` manifests/binary codecs, validation and integrity checks, bounded offline baking, portable sockets/bounds/source metadata, and runtime loading without animation resampling.
- Add Babylon.js capability reporting and frozen, side-effect-free VAT control descriptors matching Lite, without an Explorer dependency or registration layer.
- Add a standalone thermal-light VAT asset smoke-check page comparing runtime baking with deterministic encode/decode loading across lifecycle, metadata, playback, and disposal checks.

### Changed

- Batch ordinary, hierarchy, VAT, and coordinated-character bulk creation/removal into bounded renderer work.
- Keep VAT playback in persistent capacity-sized storage and upload only affected Babylon.js ranges during sparse edits, swaps, visibility changes, and batching.
- Reuse matrix scratch storage, prepare authored mesh transforms once per flush, initialize color slots to white, and avoid projected-point allocations during screen-space picking.
- Make ordinary and hierarchy disposal idempotent and reject later use consistently.
- Restore source-mesh bounds ownership on disposal and extend benchmark reports with automatic-versus-fixed bounds refresh timing.
- Suppress Babylon.js implicit bounds synchronization while buffers are owned, ensuring automatic mode performs exactly one aggregate scan per instancer batch.
- Sample VAT matrices and socket transforms through CPU animation/skeleton evaluation without submitting swap-chain frames, preventing synchronous WebGPU bake submissions from using destroyed presentation textures.

## 0.1.0

- Stable-ID rigid single-mesh and hierarchy thin-instance management.
- Picking, screen-space picking, colors, visibility, growth, metadata, and batched dirty-range uploads.
- Babylon.js-native VAT instance and multi-part character sets.
- Portable VAT socket sampling, attachment presets, and stable-ID attachment control.
