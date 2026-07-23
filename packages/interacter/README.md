# @litools/interacter

Application-level click, hover, and pointer events for Babylon Lite meshes.

Interacter owns one reusable GPU picker, serializes asynchronous picks, coalesces hover work, and delivers resolved events through stable registration handles.

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

Only registered meshes participate in picks by default. Use `setInteractionFilter` to further restrict them.

## State and lifecycle

Use `setInteractionEnabled`, `isInteractionEnabled`, `getHoveredTarget`, `getPressedTarget`, `getActivePointers`, `isTargetHovered`, and `isTargetPressed` for application state.

Disabling interaction invalidates pending work and clears pointer/hover state. Disposing a target removes its listeners. Disposing a manager removes its canvas listeners immediately and releases its picker once an active pick settles.

## Examples

Run the standalone multi-page examples site:

```sh
npm run examples:dev --workspace @litools/interacter
```

Its index links to focused click, hover, pointer/context-menu, global-dispatch, and lifecycle examples.
