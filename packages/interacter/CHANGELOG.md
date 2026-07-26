# Changelog

## Unreleased

## 0.2.1 - 2026-07-26

### Added

- Add selective Babylon Lite 1.14 detailed GPU picking with separate basic/detailed pickers and exact face, vertex-index, barycentric, normal, UV, submesh, and thin-instance data.
- Add stable thin-instance ID resolution and reusable picked-attribute interpolation.
- Add per-event Lite `ignore`, `discard`, and `debugLabel` pick policies.
- Add coalesced `dragstart`, `drag`, and `dragend` events with pointer capture and configurable drag-surface filtering.
- Add a VAT detailed-picking example that validates barycentric weights and stable instance identity.
- Add an extensive drag playground covering multiple targets, an unregistered surface, detailed pick diagnostics, camera arbitration, grid snapping, and lifecycle controls.
- Start drag picks immediately and prioritize them over frame-throttled hover work to remove an avoidable frame of input latency.
- Deliver completed drag picks during sustained pointer movement instead of discarding every in-flight result as stale.
- Add a forward-looking design document covering scheduler invariants, VAT details, drag termination, per-workload detail policy, diagnostics, adapters, and staged delivery.
- Add an object-only `{ discrete, drag, hover }` detailed-picking policy so exact VAT clicks do not require detailed drag or hover picks.
- Add a basic/detailed drag comparison control to the drag playground, with basic drag as the responsive default.
- Add discriminated interaction event types and a required `dragEndReason` for `dragend`.
- Guarantee exactly one drag termination for release, pointer cancellation, disable, or target disposal while keeping manager disposal quiet.
- Release pointer capture on every drag termination path and cover simultaneous pointer cleanup.
- Replace drag-playground scale feedback with the repository thin-instance outliner for transform-safe highlighting.
- Add an unregistered vertical wall to the drag playground with target/surface identity switching, X/Y constraints, offset preservation, and surface-bound clamping.
- Use a red active outline for wall dragging and cyan for floor dragging, including multi-pointer-safe color restoration.
- Add immutable scheduler diagnostics for queue depth, active workload, completion and failure counts, coalescing, scheduler wait, and pick-duration measurements.
- Show live scheduler diagnostics in a separate right-side panel in the drag playground, keeping drag controls and event output in the left panel.
- Add a dedicated performance-diagnostics demo for comparing basic and detailed workloads across 80, 200, or 500 meshes with live throughput, queue, coalescing, and timing measurements.
- Add clipboard export of a structured JSON performance report containing workload configuration, environment context, sample counters, and lifetime scheduler diagnostics.
- Add a repeatable in-page performance suite with an excluded warm-up, three measured rounds, fixed pointer-move and click rates, scheduler-drain completion, progress feedback, and per-round/median timing, throughput, resolved-hit, and detailed-result data in copied reports.
- Copy only the benchmark result object, excluding outer metadata, environment, live sample, and manager-lifetime panel snapshots.
- Embed mesh count, picker mode, and hover state directly in the copied benchmark result so comparisons remain self-describing.
- Add an Instancer adapter demo that exposes stable IDs, renderer slots, and removal-driven slot compaction.
- Replace hover-demo mesh scaling with transform-safe repository outline feedback.
- Report Ready Player animated picks on primary-button pointer release so skeleton motion between down and up cannot suppress the diagnostic.

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
