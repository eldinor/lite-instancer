# Interacter Design: Current Core and Next Evolution

Status: active design; stages 1 through 5 complete  
Baseline: `@litools/interacter` 0.2 with the Babylon Lite 1.14 stages implemented  
Updated: 2026-07-26

## Purpose

Interacter is the application-level interaction owner for one Babylon Lite scene and canvas. It turns asynchronous GPU picks into deterministic pointer, hover, click, and drag semantics without taking ownership of application transforms, selection state, or UI policy.

This document has two jobs:

1. Record the invariants of the implemented core so later work does not weaken them.
2. Define the next API and architecture changes before they are implemented.

`README.md` remains the usage guide. `WHY.md` explains why the package exists. This document describes how the package should evolve.

## Design goals

- Preserve exact Babylon Lite GPU picking for static, skeletal, VAT, and thin-instanced geometry.
- Make event ordering deterministic even though GPU results are asynchronous.
- Keep drag responsive under sustained pointer movement.
- Expose exact face and barycentric information without forcing its cost on hover or point-only drag.
- Preserve stable application identity when renderer thin-instance slots change.
- Make cancellation, disable, disposal, and target removal observable and predictable.
- Keep the package independent from Instancer while allowing a future explicit adapter.
- Keep the public API small, typed, ESM-only, and tree-shakeable.

## Non-goals

Interacter should not:

- mutate mesh transforms or implement application-specific drag constraints;
- own selection sets, outlines, gizmos, snapping rules, or undo history;
- reproduce the full DOM capture/bubble hierarchy;
- run overlapping GPU picks to hide latency;
- silently replace exact GPU results with approximate CPU geometry;
- depend directly on `@litools/instancer` in the core package;
- add framework-specific bindings to the core;
- require browser automation as part of its test architecture.

Higher-level helpers may be added later, but they must build on the same interaction events rather than changing core ownership.

## Current architecture

```text
DOM pointer input
       |
       v
InteractionManager ---- registrations/listeners/state queries
       |
       v
PickScheduler --------- FIFO discrete queue
       |                immediate/latest drag queue
       |                frame/latest hover queue
       v
Basic GPU picker + lazily-created detailed GPU picker
       |
       v
Target resolution ---- mesh + thin-instance slot + stable instance ID
       |
       v
InteractionEvent ----- target identity + picked-surface identity
```

The manager owns browser listeners and pointer sessions. The scheduler is the only component allowed to start a pick. The picker driver is the only Babylon Lite-specific boundary. Registration resolves a picked mesh and renderer slot to a stable target. Dispatch runs target listeners before manager-wide listeners.

### Component responsibilities

| Component | Owns | Must not own |
| --- | --- | --- |
| Interaction manager | DOM snapshots, pointer sessions, click/drag/hover semantics, lifecycle | Mesh transforms, selection state |
| Pick scheduler | Serialization, priority, coalescing, picker disposal handoff | Target resolution, event dispatch |
| Pick driver | Babylon Lite picker creation and result conversion | Event policy |
| Registration | Live target identity and stable instance-ID mapping | Renderer slot allocation |
| Surface utilities | Barycentric attribute interpolation | VAT animation state or sockets |

## Hard invariants

The following rules are requirements, not implementation details.

### One interaction owner

An application should create one manager for a scene/canvas pair. The manager owns its DOM listeners and picker resources until disposal. Multiple managers on the same canvas are possible JavaScript objects but are unsupported because they duplicate picking and native-event policy.

### At most one GPU pick in flight

Basic and detailed pickers share one serialized scheduler. Creating a second picker for detailed attachments must not permit overlapping reads. This avoids result reordering and limits GPU readback pressure.

### Event snapshots are immutable

Pointer coordinates, buttons, modifiers, pointer type, and timestamp describe the DOM event that requested the pick. They are captured synchronously and never replaced with the browser's newer pointer state when the result resolves.

### Target and surface identities are separate

For ordinary events, the target and picked mesh normally match. During drag they can differ:

| Identity | Fields |
| --- | --- |
| Registered interaction target | `target`, `mesh`, `thinInstanceIndex`, `instanceId` |
| Current picked surface | `pickedMesh`, `pickedThinInstanceIndex`, `pickedPoint`, `distance`, `pickDetails` |

No drag implementation may overwrite target identity with surface identity.

### Stable identity is application-owned

`thinInstanceIndex` is a renderer slot, not a durable object ID. When configured, `resolveInstanceId(slot)` is evaluated for event creation and its result is exposed as `instanceId`. Interacter does not cache slot-to-ID mappings across application mutations.

### Listener failures do not corrupt scheduling

A throwing listener is reported and later listeners still run. Picker and resolver errors use the same manager error channel. No error path may leave the scheduler permanently busy.

### Disposal is final

After manager disposal, new work and subscriptions fail or no-op according to the existing public contract. Pending results cannot dispatch ordinary interaction events. Picker resources are released after the active request settles.

## Scheduling model

Different input classes need different backpressure policies.

| Work class | Queue policy | Start policy | Completed result policy |
| --- | --- | --- | --- |
| Pointer down/up, context menu | FIFO | Immediate when picker is free | Deliver if lifecycle epoch is current |
| Drag | One latest unsent sample per pointer | Immediate; before hover | Deliver in-flight result, then process newest unsent sample |
| Hover | One latest unsent sample | At most one start per animation frame | Drop stale result when a newer generation exists |

The distinction between drag and hover is deliberate. A stale hover result can create an incorrect visual state and should be discarded. A completed drag-surface result remains useful for continuous motion and must be delivered; discarding every in-flight sample can starve dragging until the pointer stops.

Discrete work stays ahead of continuous work because pointer button ordering defines click correctness. Active drag stays ahead of hover because hover is decorative while drag is direct manipulation.

### Latency model

Total drag latency is approximately:

```text
DOM delivery + scheduler overhead + GPU pick/render/readback + listener/render update
```

The scheduler must contribute no intentional animation-frame wait to drag. GPU readback remains asynchronous and device-dependent. Interacter must describe this honestly rather than emit a synchronous event containing a guessed hit.

Applications that require visually zero-latency planar movement may render an application-level prediction and reconcile it with later exact `drag` results. Such prediction belongs in an opt-in helper because it depends on the drag constraint and cannot preserve exact VAT or arbitrary-surface hits.

## Detailed picking and VAT

Babylon Lite 1.14 detailed picking provides primitive ID and barycentric data. Interacter exposes it as an optional capability, not a universal event cost.

### Required detailed result contract

When `pickDetailsStatus === "available"`:

- `faceId` identifies the primitive returned by Lite;
- `barycentric` contains three weights in the same vertex order used by `vertexIndices`;
- the weights should sum to one within normal floating-point tolerance;
- `bu` and `bv` preserve Lite's original fields;
- `subMeshId` and picked thin-instance slot refer to the picked surface;
- normals and UV may be `null` when Lite cannot provide a valid deformed value;
- lack of CPU-retained indices yields `vertexIndices: null`, not fabricated indices.

For VAT, the GPU pick is authoritative for the animated surface. `interpolatePickedAttribute()` may interpolate application-owned per-vertex socket, attachment, mask, or metadata values using the returned indices and weights. It must not claim to reconstruct a deformed normal when the required animated normal data is unavailable.

### Per-workload detailed-picking configuration

Detailed picking uses one per-workload form:

```ts
detailedPicking: {
  discrete: true,
  drag: false,
  hover: false
}
```

Fields omitted by the application default to `false`. The policy is copied once when the manager is created, so later mutation of the supplied object cannot change picker selection. This separates drag responsiveness from detailed click requirements and keeps the configuration unambiguous.

## Drag lifecycle

The core emits events and never changes a transform. Applications decide whether movement is planar, axis-constrained, snapped, offset-preserving, physics-driven, or rejected.

### Start

Pointer capture may happen at pointer down so movement outside the canvas remains observable. A drag begins only when:

- drag is enabled;
- the initial down pick resolved to a live registered target;
- the pointer session remains down and uncancelled;
- movement exceeds `startDistance`.

The initial target remains fixed for the session. A later surface pick cannot retarget the drag.

### Move

Each delivered `drag` represents one completed GPU surface pick. A miss is still meaningful and carries `pickedMesh: null` and `pickedPoint: null`; the application may retain the last valid position, reject the move, or use a fallback constraint.

The default ignore rule excludes the dragged mesh. For thin instances it should exclude only the selected renderer slot, allowing other instances in the same mesh to remain valid surfaces.

### End and cancellation

Every started drag produces exactly one terminal event unless the whole manager is being disposed. The discriminated `dragend` event carries a required reason:

```ts
type InteractionDragEndReason =
  | "released"
  | "pointercancel"
  | "disabled"
  | "target-disposed";

// Exported by @litools/interacter:
type InteractionDragEndEvent = InteractionEventFor<"dragend">;
```

`dragEndReason` exists only on `dragend`; event-type narrowing makes it available without a nullable field on unrelated events. Manager disposal is intentionally excluded from callback delivery: disposal remains a quiet final teardown. This preserves the rule that normal listeners do not run after disposal begins.

Disabling interaction or disposing the active target should emit `dragend` before clearing state. Pointer capture must be released on every terminal path, even when a listener throws.

## Target resolution and future adapters

The 0.1 registration contract is mesh-first and already supports stable IDs for Babylon Lite thin instances. The core should not import Instancer.

An adapter must be explicit and capability-based. The implemented direction is the optional Instancer-owned `@litools/instancer/interacter` subpath, not detection of foreign objects inside the core. A separate adapter package remains unnecessary while the integration is a small resolver and registration-lifecycle layer.

An adapter needs to provide only:

- the pickable Babylon Lite mesh or meshes;
- renderer-slot-to-stable-ID resolution;
- optional liveness validation;
- optional ignore conversion for one logical instance.

It must not receive scheduler ownership or bypass manager serialization. Adapter failure is reported as a resolver error and produces no target.

## State model

The manager maintains independent state per pointer ID:

```text
idle
  -> pressed-awaiting-down-pick
  -> pressed-target-resolved
  -> dragging
  -> released-awaiting-up-pick
  -> idle
```

`pointercancel`, disable, target disposal, and manager disposal can terminate the active path. Hover state is separate from pressed/drag state and is disabled for touch by default.

State query APIs report manager-owned state only. They do not infer application selection or transform activity.

## Native event policy

Native `preventDefault()` decisions must occur in the DOM callback, before asynchronous picking. They remain manager configuration rather than methods on `InteractionEvent`.

Pointer capture is a drag-session mechanism, not DOM-style event propagation. Failure to capture or release is tolerated and reported only when it represents a real application-actionable error; browser differences should not crash the manager.

Camera arbitration remains explicit. The camera should query whether an external drag is active, while Interacter remains unaware of a particular camera implementation.

## Performance and observability

Interacter exposes allocation-conscious diagnostics without logging by default:

```ts
interface InteractionDiagnostics {
  readonly queuedDiscrete: number;
  readonly queuedHover: number;
  readonly queuedDrag: number;
  readonly inFlightKind: InteractionPickKind | null;
  readonly completedPicks: number;
  readonly failedPicks: number;
  readonly coalescedHoverSamples: number;
  readonly coalescedDragSamples: number;
  readonly lastSchedulerWaitMs: number | null;
  readonly lastPickDurationMs: number | null;
  readonly averagePickDurationMs: number | null;
  readonly maximumPickDurationMs: number | null;
}

getInteractionDiagnostics(manager): InteractionDiagnostics;
```

Diagnostics are frozen snapshots for profiling and examples. Queue counts and in-flight kind describe the sampled instant; completion, failure, and coalescing counters are cumulative for the manager lifetime. Scheduler wait covers enqueue-to-start time, while pick duration covers the asynchronous picker call and excludes listener/application work. The average includes all settled successful and failed picks. Diagnostics do not expose mutable scheduler internals or promise timing hooks.

Performance acceptance criteria:

- never more than one manager-owned GPU pick in flight;
- no animation-frame gate before a free scheduler starts drag work;
- at most one unsent hover sample and one unsent drag sample per pointer;
- no per-move detailed picker creation;
- no unbounded queue growth from hover or drag;
- no console output unless the application chooses it in `onError` or diagnostics UI.

## Public API evolution rules

- API changes before the first stable release may remove provisional forms instead of retaining compatibility aliases.
- New configuration uses additive optional fields and normalization at manager creation.
- Opaque manager and target handles remain opaque.
- Internal scheduler, driver, sessions, and registration implementations remain private.
- Event fields are readonly snapshots.
- New terminal-state fields use explicit unions rather than ambiguous booleans.
- Deep imports remain unsupported.

## Testing strategy

The core test suite stays deterministic and does not use Playwright.

### Unit tests

Use a fake canvas, manual frame driver, and controllable pick driver to verify:

- strict discrete FIFO ordering and one active pick;
- hover latest-value coalescing and stale-result rejection;
- immediate drag start, priority over hover, and sustained-movement delivery;
- one newest unsent drag sample per pointer;
- exact target/surface identity separation;
- stable thin-instance ID resolution;
- VAT barycentric preservation and attribute interpolation;
- cancellation, disable, target disposal, and manager disposal paths;
- listener, resolver, and picker failure isolation;
- basic/detailed picker selection after per-workload policy normalization.

### Production verification

- TypeScript typecheck.
- Vitest unit suite.
- Library and declaration build.
- Every example production build and static link verification.
- npm tarball contents and export inspection.
- Manual WebGPU checks for device-specific picking behavior when needed.

The examples are executable documentation, not the source of correctness. Core behavior must remain testable without a browser automation dependency.

## Delivery plan

### Stage 1: consolidate the current core

- Keep the new low-latency drag scheduler and starvation regression coverage.
- Ship the drag playground and VAT detailed-picking example.
- Align README, WHY, changelog, and generated declarations.

Exit condition: release audit passes and the documented scheduler rules match tests.

### Stage 2: separate detail policy by workload — complete

- Add the object-form detailed-picking policy.
- Copy and normalize omitted fields once at manager creation.
- Add tests showing detailed click plus basic drag plus basic hover.
- Update the drag playground to compare point-only and detailed drag modes.

Exit condition: applications can request VAT barycentric clicks without paying detailed-pick cost during dragging.

### Stage 3: complete drag termination semantics — complete

- Add `dragEndReason`.
- Emit exactly one terminal drag event for release, pointer cancel, disable, and target disposal.
- Keep manager disposal quiet while always releasing pointer capture and GPU resources.
- Add multi-pointer termination tests.

Exit condition: application cleanup never has to infer why a drag stopped.

### Stage 4: diagnostics and measured performance — complete

- Add read-only scheduler diagnostics. Complete.
- Show pick duration, coalescing, and queue state in the drag example's separate right panel. Complete.
- Add a dedicated performance-diagnostics page with configurable mesh count, picker detail, hover workload, throughput, local sampling baselines, and a fixed-duration in-page workload generator. Complete.
- Establish initial repeatable basic/detailed thin-instance baselines. Complete; asset- and device-specific skeletal/VAT baselines remain release profiling rather than core API work.

Exit condition: reports of delay can distinguish DOM, scheduler, GPU, and application-listener cost.

### Stage 5: adapter evaluation — complete

- Prototype an Instancer adapter outside the core. Complete as the optional `@litools/instancer/interacter` entry.
- Validate stable IDs through slot compaction and removal. Complete with a live-resolver regression test.
- Decide whether the adapter belongs in a separate package based on real usage. Keep it as an Instancer-owned subpath until its policy or release lifecycle grows.

Exit condition: no core dependency on Instancer and no leakage of renderer slots as durable identity.

Selection models, keyboard navigation, gestures, transform constraints, and framework bindings remain later layers. They should be proposed in separate design documents after the core stages above are complete.

## Decisions and rejected alternatives

### Accepted

- GPU picking remains authoritative for visible/deformed geometry.
- Pick requests remain serialized.
- Hover and drag use different stale-result policies.
- Drag target identity is immutable for a session.
- Mesh mutation stays in application listeners.
- Detailed picking is opt-in and should become configurable per workload.
- Core verification remains deterministic and Playwright-free.

### Rejected

- Starting one GPU pick for every DOM `pointermove`: creates overlap and readback pressure.
- Dropping completed drag results whenever a newer pointer sample exists: can starve movement indefinitely.
- Treating the drag surface as the event target: loses the identity of the object being manipulated.
- Making detailed picking universal: penalizes hover and point-only drag.
- Synchronous guessed VAT hits: breaks exact animated-surface semantics.
- Direct Instancer imports in the core: couples lifecycle and release cadence unnecessarily.
- Automatic mesh movement: embeds application constraint, snapping, physics, and undo policy in the interaction layer.

## Open questions

These require implementation evidence before becoming public API:

- Should drag detail policy be part of `detailedPicking` only, or also overridable inside `drag`?
- Is one latest drag sample per pointer sufficient for simultaneous multi-touch manipulation?
- Should an optional planar prediction helper live in Interacter or a separate transform package?

Until answered, these remain design questions rather than implied commitments.
