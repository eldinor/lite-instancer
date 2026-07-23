# Changelog

## 0.1.0 - 2026-07-23

### Added

- Add an explicit interaction-manager lifecycle with one reusable, serialized Babylon Lite GPU picker.
- Add opaque regular-mesh target registration handles and target-specific or manager-wide subscriptions.
- Add resolved `pointerdown`, `pointerup`, `click`, `doubleclick`, and `contextmenu` events.
- Add coalesced mouse and pen hover with ordered `hoverstart`, `hovermove`, and `hoverend` events.
- Add configurable click thresholds, native browser-event policies, mesh filtering, error reporting, and interaction state queries.
- Add deterministic unit coverage for dispatch, scheduling, click recognition, hover transitions, stale work, cancellation, filtering, and disposal.
- Add a standalone multi-page examples site and a direct `dist/index.js` consumer example.
- Add a static Babylon Lite Playground BoomBox GLB example that preserves the loaded scene and registers each child mesh for picking.
- Add an animated Samba Girl GLB example that exercises picking against live skeletal deformation with play/pause comparison.
- Add a Ready Player animated GLB example using the same live-skeleton picking and play/pause workflow.
- Add an 80-mesh interaction stress example with live event-rate counters and lifecycle controls.
- Add middle-button regression coverage, static production-example link verification, and npm tarball inspection.
- Document why the package exists, its interaction ownership model, and its intentionally focused version 0.1 scope.
