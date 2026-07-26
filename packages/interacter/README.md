# @litools/interacter

Application-level pointer, click, hover, and drag events for Babylon Lite meshes.

Interacter owns one reusable GPU picker, serializes asynchronous picks, coalesces hover work, and delivers resolved events through stable registration handles.

See [WHY.md](./WHY.md) for the package motivation and scope.

## Install

```sh
npm install @litools/interacter @babylonjs/lite
```

The package is ESM-only and has no dependency on `@litools/instancer`.

## Quick start

```ts
import {
  createInteractionManager,
  disposeInteractionManager,
  disposeInteractionTarget,
  interpolatePickedAttribute,
  onInteraction,
  registerMesh
} from "@litools/interacter";

const interactions = createInteractionManager({ scene, canvas });
const target = registerMesh(interactions, mesh);

const unsubscribe = onInteraction(target, "click", (event) => {
  console.log(event.mesh, event.pickedPoint);
});

unsubscribe();
disposeInteractionTarget(target);
disposeInteractionManager(interactions);
```

Babylon Lite 1.14 exact surface details are opt-in because they add a GPU attachment and readback data. Enable them independently for discrete, drag, and hover work:

```ts
const interactions = createInteractionManager({
  scene,
  canvas,
  detailedPicking: { discrete: true }
});

onInteraction(registerMesh(interactions, mesh), "click", (event) => {
  console.log(event.pickDetails?.faceId, event.pickDetails?.barycentric, event.pickDetails?.pickedUV);
});
```

`pickDetails` is `null` when detailed picking is disabled, the device lacks WebGPU primitive-index support, the pointer misses, or Lite cannot resolve an exact primitive. The existing `pickedPoint` and `distance` fields remain available on every hit.

Use `event.pickDetailsStatus` to distinguish `"disabled"`, `"unavailable"`, and `"available"`.

| Policy field | Workload |
| --- | --- |
| `discrete` | Pointer down/up, click, double-click, and context menu |
| `drag` | Drag-surface picks |
| `hover` | Hover picks |

Use the object form when workloads need different tradeoffs. For example, retain exact VAT click data while keeping drag and hover on the basic picker:

```ts
const interactions = createInteractionManager({
  scene,
  canvas,
  detailedPicking: {
    discrete: true,
    drag: false,
    hover: false
  }
});
```

Omitted fields default to `false`. Omitting `detailedPicking` therefore keeps every workload on the basic picker.

For VAT meshes, Lite performs the pick against the animated GPU projection. `barycentric` contains the weights for the picked face's first, second, and third indexed vertices, while `vertexIndices` identifies those vertices. This makes the result suitable for interpolating VAT socket or attachment data. UV interpolation remains valid; deformed surface normals may be `null` because Lite cannot derive them from the base mesh normals after vertex deformation.

```ts
const sampled = interpolatePickedAttribute(event.pickDetails, perVertexValues, itemSize);
```

### Thin-instance identity

Map Lite's renderer slot to a stable application ID during registration:

```ts
const target = registerMesh(interactions, vatMesh, {
  resolveInstanceId: (slot) => instances.getIdForSlot(slot) ?? null
});

onInteraction(target, "click", (event) => {
  console.log(event.thinInstanceIndex, event.instanceId);
});
```

### Lite pick options

`pickOptions` forwards Lite 1.14 `ignore`, `discard`, and `debugLabel` settings. It can be a fixed object or a function selected by interaction kind and event type:

```ts
const interactions = createInteractionManager({
  scene,
  canvas,
  pickOptions: ({ kind, eventType }) =>
    kind === "discrete"
      ? { discard: alphaDiscardRule, debugLabel: eventType }
      : { debugLabel: eventType }
});
```

### Dragging

Enable coalesced asynchronous drag events with pointer capture. By default Interacter ignores only the dragged thin instance during drag-surface picks:

```ts
const interactions = createInteractionManager({
  scene,
  canvas,
  detailedPicking: { discrete: true, drag: false, hover: false },
  drag: {
    surfaceFilter: (mesh) => mesh === ground
  }
});

onInteraction(target, "drag", (event) => {
  if (event.pickedPoint) moveTo(event.pickedPoint);
});
```

Drag listeners receive `dragstart`, low-latency coalesced `drag`, and `dragend`. Target identity and drag-surface identity intentionally remain separate:

| Event field | Meaning during drag |
| --- | --- |
| `mesh`, `thinInstanceIndex`, `instanceId` | The registered object being dragged |
| `pickedMesh`, `pickedThinInstanceIndex` | The surface resolved under the current pointer sample |
| `pickedPoint`, `distance` | Current hit position and distance on that surface |
| `pickDetails`, `pickDetailsStatus` | Optional face, barycentric, normal, and UV data for that surface |

The surface does not need to be registered when `surfaceFilter` admits it. With `ignoreTarget: true` (the default), Interacter excludes the dragged mesh—or only its selected thin instance—from surface picks. This prevents the object from picking itself as it moves under the pointer.

#### Drag latency and coalescing

Babylon Lite GPU picking is asynchronous, so a `drag` event cannot be synchronous with its DOM `pointermove`. Interacter minimizes the delay without inventing an inaccurate CPU hit:

1. A drag pick starts immediately; it does not wait for the hover animation-frame throttle.
2. Active drag work is selected before queued hover work.
3. The completed in-flight pick is delivered even when the pointer moved again meanwhile.
4. While that pick is in flight, only the newest unsent sample is retained.

This produces updates at the GPU pick-completion rate and prevents sustained movement from starving drag events. It does not remove the device's inherent GPU readback time. Detailed picking carries more surface data. Set `detailedPicking.drag` to `false` when dragging needs only `pickedPoint`; set it to `true` when drag listeners require face or barycentric data.

`dragstart` begins after movement exceeds `startDistance`. Pointer capture defaults to enabled, so the session continues outside the canvas. Configure `startDistance`, `capturePointer`, `ignoreTarget`, and `surfaceFilter` when those defaults are not appropriate.

Every started drag emits exactly one terminal `dragend`, except quiet manager disposal. The discriminated `dragend` event requires `dragEndReason`:

| Reason | Cause |
| --- | --- |
| `"released"` | The pointer was released normally |
| `"pointercancel"` | The browser or operating system cancelled the pointer |
| `"disabled"` | Interaction was disabled during the drag |
| `"target-disposed"` | The active interaction target was disposed |

```ts
onInteraction(target, "dragend", (event) => {
  // The literal event type narrows the callback to InteractionEventFor<"dragend">.
  console.log(event.dragEndReason);
});
```

Disable and target disposal deliver `dragend` before clearing their listeners and session state. All terminal paths release pointer capture. Disposing the whole manager remains quiet: it releases capture and resources but does not invoke ordinary interaction listeners during teardown.

When an ArcRotate camera shares the canvas, prevent camera movement while an Interacter drag is active:

```ts
let activeDrag = false;

onInteractionEvent(interactions, "dragstart", () => { activeDrag = true; });
onInteractionEvent(interactions, "dragend", () => { activeDrag = false; });

attachControl(camera, canvas, scene, {
  isExternalDragActive: () => activeDrag
});
```

Use one manager for a scene/canvas pair. Registering the same mesh twice with one manager throws.

## Version 0.2 public API

Version 0.2 exposes the package root, `@litools/interacter`. This is the complete supported runtime API:

- `createInteractionManager` and `disposeInteractionManager`
- `registerMesh` and `disposeInteractionTarget`
- `interpolatePickedAttribute`
- `onInteraction` and `onInteractionEvent`
- `setInteractionEnabled` and `isInteractionEnabled`
- `setInteractionFilter`
- `getInteractionDiagnostics`
- `getHoveredTarget`, `getPressedTarget`, and `getActivePointers`
- `isTargetHovered` and `isTargetPressed`

The root also exports the TypeScript types for manager, target, discriminated events, drag-end reasons, detailed-pick policy, filtering, and listener configuration.

Deep imports and internal picker, scheduler, and registration modules are not public API. Version 0.2 exposes the target-level stable-ID resolver contract but no concrete Instancer dependency; use the optional `@litools/instancer/interacter` adapter for Instancer targets.

### Diagnostics

`getInteractionDiagnostics(manager)` returns a frozen, read-only snapshot of scheduler state and lifetime counters. Reading it does not enable logging or add picker callbacks, so applications can sample it only while a profiling UI is visible.

```ts
const diagnostics = getInteractionDiagnostics(interactions);

console.log({
  queued: {
    discrete: diagnostics.queuedDiscrete,
    drag: diagnostics.queuedDrag,
    hover: diagnostics.queuedHover
  },
  inFlight: diagnostics.inFlightKind,
  schedulerWaitMs: diagnostics.lastSchedulerWaitMs,
  pickDurationMs: diagnostics.lastPickDurationMs
});
```

`lastSchedulerWaitMs` measures time from request enqueueing until its pick starts. Pick-duration values measure the asynchronous picker call itself, excluding listener and application rendering work. Completed and failed counters are separate; duration averages include every settled pick. Coalescing counters show how many pending hover or drag samples were replaced by newer input.

## Events

Target subscriptions support:

- `pointerdown` and `pointerup`
- `click` and `doubleclick`
- `contextmenu`
- `dragstart`, `drag`, and `dragend`
- `hoverstart`, `hovermove`, and `hoverend`

Resolved target listeners run first. Manager-wide listeners registered with `onInteractionEvent` run afterward unless a target listener calls `stopPropagation()`.

```ts
onInteractionEvent(interactions, "click", (event) => {
  console.log("Any registered mesh:", event.mesh.name);
});
```

Picking is asynchronous, so events contain a snapshot of the original pointer fields (`x`, `y`, button state, modifiers, and timestamp) rather than a synthetic DOM `preventDefault()`. The snapshot corresponds to the pick that produced the event; a newer DOM pointer position may already exist when the listener runs. Configure native browser behavior when the manager is created:

```ts
const interactions = createInteractionManager({
  scene,
  canvas,
  preventContextMenu: true,
  preventPointerDefault: false,
  onError(error, context) {
    console.error(context.phase, error);
  }
});
```

### Mouse buttons

Picked `pointerdown` and `pointerup` events are delivered for primary, middle, and secondary mouse buttons. Use `event.button` to identify the changed button:

- `0`: primary
- `1`: middle
- `2`: secondary

`event.buttons` contains the DOM button-state bitmask; the middle-button bit is `4`.

Only the primary button can produce Interacter `click` and `doubleclick` events. A middle-button interaction therefore produces `pointerdown` and `pointerup`, but no `click`, `doubleclick`, or `contextmenu`. Handle a middle-button action explicitly when needed:

```ts
onInteraction(target, "pointerup", (event) => {
  if (event.button === 1) {
    console.log("Middle button:", event.mesh);
  }
});
```

Native middle-button browser behavior remains enabled with the default `preventPointerDefault: false`. Set `preventPointerDefault: true` when the application needs to suppress native pointer defaults synchronously.

For touch manipulation, applications may also need CSS such as:

```css
canvas {
  touch-action: none;
}
```

## Click and hover behavior

Clicks require pointer down and up to resolve to the same live target. Defaults are 4 CSS pixels/500 ms for mouse and pen, and 12 CSS pixels/700 ms for touch. Override them with the `click` manager option.

A matching double-click emits two immediate `click` events plus `doubleclick`. The default pair delay is 400 ms.

Hover is enabled for mouse and pen. Pointer moves are coalesced to the newest position, limited to one pick start per animation frame, and stale results are ignored. Touch does not create persistent hover.

During rapid pointer movement, intermediate meshes may intentionally receive no hover event. For example, moving quickly across a row can resolve only the first and final positions:

```text
first mesh: hoverstart
first mesh: hoverend
final mesh: hoverstart
```

After movement stops, only the final mesh should remain hovered. The earlier mesh must receive `hoverend`; two meshes remaining visibly hovered indicates an application cleanup problem or a missing hover transition.

Only registered meshes participate in picks by default. Use `setInteractionFilter` to further restrict them.

## State and lifecycle

Use `setInteractionEnabled`, `isInteractionEnabled`, `getHoveredTarget`, `getPressedTarget`, `getActivePointers`, `isTargetHovered`, and `isTargetPressed` for application state.

Disabling interaction invalidates pending work and clears pointer/hover state. Disposing a target removes its listeners. Disposing a manager removes its canvas listeners immediately and releases its picker once an active pick settles.

## Examples

Run the standalone multi-page examples site:

```sh
npm run examples:dev --workspace @litools/interacter
```

Open `/drag-playground/` for the extensive drag example. Its Drag details control reloads the example with basic or detailed drag picking so responsiveness and exact barycentric data can be compared directly. Active targets use this repository's `createThinInstanceOutliner` with ordinary-mesh index `0`, so drag feedback never modifies target scale. The outline is cyan for floor dragging and red for wall dragging. Unregistered floor and wall meshes are admitted by `surfaceFilter`; the listener uses `pickedMesh` to apply X/Z floor movement or X/Y wall movement while preserving grab offset and clamping to surface bounds. The left panel contains drag controls and event output; a separate right panel samples the public diagnostics API to show live queue depth, in-flight workload, coalescing, scheduler wait, and pick duration. The example also covers pointer capture, optional grid snapping, camera arbitration, and enable/disable cleanup.

Open `/performance-diagnostics/` to compare 80, 200, or 500 registered meshes using basic or detailed discrete/hover picking. A separate diagnostics panel reports live queue depth, peak queue, throughput, coalescing, scheduler wait, and picker duration. Run benchmark suite performs an excluded two-second warm-up followed by three isolated five-second rounds. Every phase dispatches 30 deterministic in-page pointer moves per second with one click cycle every four moves and drains the scheduler before continuing; it does not require browser automation. Changing a workload setting reloads the scene with a fresh manager; Reset sample creates a new local baseline without mutating scheduler counters. Copy JSON report writes only the benchmark result object containing its mesh-count/picker/hover configuration, workload, warm-up, rounds, and median. Outer report metadata, live samples, and manager-lifetime panel values are excluded.

Open `/instancer-adapter/` for the optional `@litools/instancer/interacter` integration. The page registers one Instancer `InstanceSet`, reports both `event.instanceId` and `event.thinInstanceIndex`, and lets you remove the selected instance. Its live mapping and compaction log show a moved renderer slot while subsequent clicks continue to resolve the same stable application ID.

The index also links to focused click, hover, pointer/context-menu, global-dispatch, lifecycle, built-package consumer, static GLB-picking, skeletal picking, VAT detailed picking, Instancer stable-ID integration, and an 80-mesh lifecycle stress test. The consumer imports `dist/index.js` directly; the example scripts build the package before starting Vite.

## Release verification

Run the complete version 0.1 release audit with:

```sh
npm run release:check --workspace @litools/interacter
```

The audit typechecks, runs unit tests, builds the package and examples, verifies every production example index link, creates and inspects a temporary npm tarball, and removes that temporary archive afterward.
