# @litools/interacter

Application-level click, hover, and pointer events for Babylon Lite meshes.

Interacter owns one reusable GPU picker, serializes asynchronous picks, coalesces hover work, and delivers resolved events through stable registration handles.

See [WHY.md](./WHY.md) for the design motivation, asynchronous-picking problems, and version 0.1 boundaries.

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

Use one manager for a scene/canvas pair. Registering the same mesh twice with one manager throws.

## Version 0.1 public API

Version 0.1 exposes only the package root, `@litools/interacter`. This is the complete supported runtime API:

- `createInteractionManager` and `disposeInteractionManager`
- `registerMesh` and `disposeInteractionTarget`
- `onInteraction` and `onInteractionEvent`
- `setInteractionEnabled` and `isInteractionEnabled`
- `setInteractionFilter`
- `getHoveredTarget`, `getPressedTarget`, and `getActivePointers`
- `isTargetHovered` and `isTargetPressed`

The root also exports the TypeScript types `ClickThreshold`, `ClickThresholds`, `InteractionErrorContext`, `InteractionEvent`, `InteractionEventType`, `InteractionListener`, `InteractionManager`, `InteractionManagerOptions`, `InteractionMeshFilter`, `InteractionPointerType`, and `InteractionTarget`.

Deep imports and internal picker, scheduler, resolver, and registration modules are not public API. Version 0.1 does not expose an adapter API or support Instancer targets.

## Events

Target subscriptions support:

- `pointerdown` and `pointerup`
- `click` and `doubleclick`
- `contextmenu`
- `hoverstart`, `hovermove`, and `hoverend`

Resolved target listeners run first. Manager-wide listeners registered with `onInteractionEvent` run afterward unless a target listener calls `stopPropagation()`.

```ts
onInteractionEvent(interactions, "click", (event) => {
  console.log("Any registered mesh:", event.mesh.name);
});
```

Picking is asynchronous, so events contain a snapshot of the original pointer fields rather than a synthetic DOM `preventDefault()`. Configure native browser behavior when the manager is created:

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

Its index links to focused click, hover, pointer/context-menu, global-dispatch, lifecycle, built-package consumer, static GLB-picking, Samba Girl skeletal picking, Ready Player skeletal picking, and 80-mesh stress-test examples. The consumer imports `dist/index.js` directly; the example scripts build the package before starting Vite.

## Release verification

Run the complete version 0.1 release audit with:

```sh
npm run release:check --workspace @litools/interacter
```

The audit typechecks, runs unit tests, builds the package and examples, verifies every production example index link, creates and inspects a temporary npm tarball, and removes that temporary archive afterward.
