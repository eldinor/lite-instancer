# Changelog

All notable changes to `@litools/annotator` are documented here. The package
follows semantic versioning.

## Unreleased

### Added

- Add the tree-shakable `@litools/annotator/textrender` entry with a label-only
  GPU TextRenderer backend, public shaping bridge, shared glyph storage,
  z-index batching, bounded shape cache, CSS-pixel measurement, and runtime
  statistics.
- Add an opt-in guarded-private Lite 1.14 layout adapter that permanently falls
  back to public shaping on an error or structural mismatch, with third-party
  notices for the bundled Apache-2.0 implementation.
- Add four TextRenderer demos for basic, dynamic, collision, and
  100/250/500-label stress scenarios plus a bundled OFL-licensed Inter font.
- Add unit and build-isolation coverage for the GPU text backend while
  preserving the existing HTML entry and gallery pages.
- Add lazy GPU Sprite2D leader lines to the TextRenderer backend with a
  one-sprite square default, opt-in three-sprite rounded caps, shared DPR
  scaling, reusable hidden slots, lifecycle cleanup, and renderer statistics.
- Add collision-page leader-line cap/style cases and a manual 30-warm-up,
  180-sample JSON benchmark with clipboard fallback.
- Add one-sprite GPU dot and ring markers with cached styled atlas frames,
  shared DPR scaling, HTML-compatible marker colors/borders, lifecycle cleanup,
  one marker draw call, statistics, and basic-demo examples.
- Add compound marker/label callouts by extending leader lines to explicit
  screen offsets and clamped labels, plus focused GPU callout and animated
  marker demos with stable sprite-slot updates.
- Add one-sprite square, diamond, triangle, cross, and pin GPU markers, an open
  `MarkerShape` string union, namespaced custom rasterizer registration, and a
  focused built-in/custom marker-shapes demo.
- Add lifecycle-managed Sprite2D buckets per annotation `zIndex`, with lines
  ordered behind markers, draw-call statistics, slot migration, and empty
  bucket removal.
- Add a manually started automatic GPU marker benchmark covering 100–10,000
  markers, one/four z buckets, CPU/GPU pulsing, visibility churn, and JSON
  timing reports.
- Add opt-in GPU marker pulse animation through Lite's public Sprite FX clock,
  with per-sprite phase/frequency/opacity parameters, lazy animated layers,
  static-path isolation, animation statistics, and no per-frame marker calls.
- Skip unchanged marker projection and backend sprite writes when camera,
  viewport, resolved anchor, visibility, definition, and occlusion inputs are
  stable; retain full invalidation for movement and add a forced-orbit
  benchmark comparison.
- Batch clean TextRenderer marker positions during camera/viewport movement,
  reuse projection scratch storage, and lazily materialize immutable public
  snapshots to reduce high-count moving-camera CPU and allocation overhead;
  the 10,000-marker reference orbit benchmark dropped about 65%.

### Changed

- Raise the Babylon Lite peer dependency to `^1.14.0`.
- Change omitted leader-line caps from rounded to square in both backends for
  the faster universal default; rounded caps are now explicitly opt-in.
- Replace the disconnected example galleries with one readable catalog and a
  shared live-demo header, learning-path controls, and accessible demos drawer.
- Remove Annotator's browser-automation configuration, fixtures, snapshots,
  scripts, and package dependency; release checks now use unit and build gates.

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
