# @litools/stager

Application-stage lifecycle, cancellation, transitions, and resource ownership
for Babylon Lite applications.

Stager's core is renderer-independent. The optional Babylon adapter owns the
repetitive scene and camera-control lifecycle for ordinary Lite applications.

## Quick start

```ts
import {
  activateStage,
  createStageManager,
  navigateToStage,
  preloadStage
} from "@litools/stager";
import {
  arcRotateCameraControls,
  createBabylonStageHost,
  defineBabylonStage
} from "@litools/stager/babylon";

const stager = createStageManager();
const babylon = createBabylonStageHost({ canvas });

defineBabylonStage(stager, babylon, {
  id: "viewer",

  async load() {
    const { scene, camera } = createViewerScene(engine);

    return {
      scene,
      controls: arcRotateCameraControls(camera),
      data: { productId: "chair" }
    };
  }
});

await navigateToStage(stager, "viewer");
```

The Babylon adapter automatically:

- keeps scene registration exclusive so incoming stages clear color, depth, and
  stencil instead of becoming swapchain overlays;
- attaches camera controls only while their stage is active;
- detaches controls on exit, failure, and disposal;
- disposes stage-owned `SceneContext` objects;
- cleans up scenes returned after cancelled or obsolete loads.

If incoming scene registration, camera-control attachment, or the stage's
`enter()` hook fails, the adapter re-registers the outgoing scene and reattaches
its controls before rejecting navigation. If restoration also fails, the
rejection is an `AggregateError` containing both the activation and rollback
errors.

Stages without interactive camera controls can omit `controls`.

## Camera types

Babylon Lite 1.14 has separate control functions for its camera types. Stager
provides an explicit strategy for each one:

```ts
import {
  arcRotateCameraControls,
  freeCameraControls,
  geospatialCameraControls
} from "@litools/stager/babylon";

arcRotateCameraControls(arcRotateCamera, options);
freeCameraControls(freeCamera);
geospatialCameraControls(geospatialCamera, options);
```

The adapter does not guess a camera type from runtime properties. Custom camera
controls can implement the same small interface:

```ts
const controls = {
  attach(canvas, scene) {
    return attachCustomControls(camera, canvas, scene);
  }
};
```

The returned cleanup function must be idempotent. It is called when the stage
stops owning input from the shared canvas.

## Additional resource ownership

The adapter owns the scene and camera-control lease. Resources whose ownership
depends on the application remain explicit:

```ts
defineBabylonStage(stager, babylon, {
  id: "editor",

  async load(context) {
    const { scene, camera } = createEditorScene(engine);

    const picker = context.resources.own(
      createGpuPicker(scene),
      disposePicker
    );

    return {
      scene,
      controls: freeCameraControls(camera),
      data: { picker }
    };
  }
});
```

Register stage-owned pickers, utility layers, gizmos, physics or navigation
objects, audio objects, auxiliary renderers, buffers, application listeners,
timers, workers, and ecosystem managers this way.

Do not register the application engine, primary surface, canvas, persistent
services, or resources intentionally shared between stages as stage-owned.
Shared resources should use `context.shared.acquire()`.

`disposeScene()` already releases the scene frame graph, scene render targets,
scene renderables, scene-owned GPU references, callbacks, and disposers
registered through Babylon Lite's `onSceneDispose()`.

## Preload and camera isolation

```ts
await preloadStage(stager, "viewer");
```

Preloading creates the scene but does not register it or attach its controls.
Only `activateStage()` or navigation gives that camera input ownership:

```ts
await activateStage(stager, "viewer");
```

This prevents pointer and wheel events from changing inactive cameras.

## DOM transitions

Browser overlay transitions are optional:

```ts
import { createStageManager } from "@litools/stager";
import { htmlFadeTransition } from "@litools/stager/dom";

const stager = createStageManager({
  defaultTransition: htmlFadeTransition({
    host: document.querySelector<HTMLElement>("#stage-overlay")!,
    duration: 300,
    color: "#000",
    blockPointerInput: true,
    respectReducedMotion: true
  })
});
```

The application owns the overlay host. Stager restores it to a hidden,
non-interactive state after completion, cancellation, or failure.

## Renderer-independent core

Use `defineStage()` directly when integrating another renderer, managing a
logical state without a scene, or requiring custom lifecycle ordering. In that
case the application owns all renderer registration, input attachment, and
disposal hooks.

## Examples

Run the gallery directly from source:

```sh
npm run examples:dev --workspace @litools/stager
```

The command does not build the package first. The gallery includes navigation,
preload/progress, cancellation/failure preservation, resource ownership, and
DOM fade examples, plus focused Free Camera, Geospatial Camera, and activation
rollback demonstrations.
