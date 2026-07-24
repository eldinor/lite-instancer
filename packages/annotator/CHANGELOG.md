# Changelog

All notable changes to `@litools/annotator` are documented here. The package
follows semantic versioning.

## Unreleased

No changes yet.

## 0.1.2 - 2026-07-24

### Added

- Add opt-in label overlap handling with deterministic z-index/creation-order
  priority, configurable CSS-pixel padding, automatic visibility recovery, and
  the queryable `collision` hidden reason.
- Add unit and browser collision coverage plus a dense-label gallery example.
- Add a collision stress example with selectable 100/250/500-label loads,
  moving resolver anchors, changing callback widths, viewport clamping, and
  live visibility and update-time metrics.
- Add viewport-aware `collision: "shift"` placement with configurable maximum
  displacement, deterministic search order, collision-hiding fallback,
  automatic return toward anchors, and queryable snapshot layout offsets.
- Cache HTML label geometry across position-only updates, remeasuring after
  content, style, or viewport-size changes to avoid per-label forced layout in
  moving collision scenes.
- Add optional shifted-label leader lines with portable color, width, opacity,
  and minimum-length options, nearest-edge geometry, shared visibility, and
  complete annotation/layer lifecycle cleanup.
- Add opt-in HTML label activation with pointer, Enter, and Space handling,
  keyboard focus, accessible default button semantics, and a collision-demo
  camera-focus interaction.
- Add an experimental `@litools/annotator/babylon-occlusion` adapter that
  renders reverse-Z screen depth and checks all opted-in anchors in one compute
  dispatch with pooled asynchronous readback.
- Add `hideWhenOccluded`, `occlusionBias`, the `occluded` hidden reason, an
  adoptable layer-level occlusion-provider contract, unit coverage, and a live
  wall-occlusion example.
- Add `occludedOpacity` and snapshot `occluded` state so annotations can remain
  rendered with reduced opacity while behind geometry.
- Add explicit `"none"`, `"hide"`, and `"fade"` occlusion modes while retaining
  `hideWhenOccluded` as a deprecated compatibility alias.
- Add independently configurable enter/exit hysteresis, HTML opacity
  transitions, adapter query/readback metrics, and live occlusion controls.
- Add deterministic vertical-only `collision: "shift-y"` and outward
  `collision: "radial"` placement, with all collision modes exposed directly
  in the collision-enabled demo panels.
- Add horizontal-only `collision: "shift-x"` placement to complement
  vertical-only layout.
- Add deterministic `collision: "cluster"` summaries that collapse
  overlapping labels into one count and restore individual labels when they
  separate.
- Add deterministic `collision: "repel"` placement that responds to actual
  blocking rectangles while respecting viewport and displacement limits.

### Changed

- Batch cluster summary finalization once per group and retain stable summaries
  across updates, eliminating repeated per-member DOM writes and measurements.
- Expand the collision and depth-occlusion panels to expose every collision
  mode directly.

## 0.1.1 - 2026-07-24

### Added

- Add package-local license, changelog, and API reference documents.
- Add direct README links to the examples, API reference, and changelog.

### Changed

- Refine the examples index typography, spacing, and card presentation.
- Keep the live-data example focused on its callback label without a separate
  marker on the same target.

## 0.1.0 - 2026-07-24

### Added

- Add opaque annotation layers and label/marker handles with explicit,
  idempotent disposal.
- Add world, mesh-point, and mesh-bounds anchors with world and CSS-pixel
  screen offsets.
- Add stable-ID Instancer anchors through the optional
  `@litools/annotator/instancer` entry point.
- Add an HTML backend that owns only its overlay root, tracks canvas layout,
  and cleans up DOM nodes and observers.
- Add perspective, orthographic, and normalized camera-viewport projection in
  canvas-local CSS pixels.
- Add visibility, distance, behind-camera, off-screen, and viewport-clamping
  rules with queryable annotation snapshots.
- Add portable label/marker styles, dynamic label text, and label ARIA
  attributes.
- Add deterministic manual updates and an optional cancellable RAF driver.
- Add unit, browser, visual, lifecycle, and Instancer integration coverage.
- Add a multi-page gallery covering labels, markers, live data, stable
  instances, and lifecycle management.
