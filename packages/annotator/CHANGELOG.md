# Changelog

All notable changes to `@litools/annotator` are documented here. The package
follows semantic versioning.

## Unreleased

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
