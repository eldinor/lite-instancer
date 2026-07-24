# @litools/annotator

Spatial HTML labels and dot/ring markers for Babylon Lite meshes and stable
`@litools/instancer` IDs.

[Examples](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
· [API reference](./API.md)
· [Changelog](./CHANGELOG.md)

## Install

```sh
npm install @litools/annotator @babylonjs/lite
```

Install `@litools/instancer` as well when using stable instance anchors.

## Quick start

The caller owns a positioned container covering the canvas. Annotator creates
and removes only its root inside that container. The layer owns the backend
passed to it and disposes that backend with the layer.

```ts
import {
  createAnnotationLayer,
  createLabel,
  disposeAnnotationLayer,
  updateAnnotationLayer
} from "@litools/annotator";
import { createHtmlAnnotationBackend } from "@litools/annotator/html";

const layer = createAnnotationLayer({
  scene,
  camera,
  canvas,
  backend: createHtmlAnnotationBackend({ container: overlayContainer })
});

createLabel(layer, {
  anchor: { kind: "mesh", mesh, preset: "top" },
  text: "Pump A-12",
  clampToViewport: true
});

// Call from the application's update/render loop.
updateAnnotationLayer(layer);

// Removes every owned annotation and DOM node.
disposeAnnotationLayer(layer);
```

Use `updateMode: "raf"` only when the annotation layer should own a cancellable
browser RAF loop. Manual updates are the default.

## Stable instance anchors

```ts
import { createInstanceAnchor } from "@litools/annotator/instancer";

createLabel(layer, {
  anchor: createInstanceAnchor(instanceSet, instanceId, {
    localPoint: [0, 1, 0]
  }),
  text: () => instanceSet.getMetadata(instanceId)?.name ?? "Unknown"
});
```

The adapter resolves the stable ID on every update and never retains a thin
instance slot. Removed IDs hide their annotations without disposing the handle.
Call `invalidateAnnotation(label)` after metadata used by callback text changes.

Babylon Lite exposes aggregate world bounds for thin-instance meshes. Therefore,
instance presets require explicit reusable `localBounds`; without `localPoint`
or `localBounds`, an instance anchor uses the instance origin.

## Coordinate and lifecycle contract

- Public positions, offsets, sizes, bounds, and clamping use canvas-local CSS pixels.
- Device pixel ratio and backing-store size do not change public coordinates.
- One layer represents one camera viewport.
- CSS rotation and skew on the canvas are not supported in 0.1.
- Layer and annotation disposal are idempotent.
- Other operations on disposed handles throw `AnnotatorError`.
- The 0.1 model is runtime-only and is not serializable.

Dimensions, callouts, interaction, occlusion, collision layout, custom DOM
content, React bindings, and GPU rendering are intentionally deferred.

## Examples

Browse the
[example source](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
or run the multi-page gallery from the repository root:

```sh
npm run dev:annotator
```

The gallery includes mesh labels, dots and rings with viewport clamping, live
callback text, stable Instancer anchors, and explicit lifecycle/disposal.

See the [API reference](./API.md) for every public entry point, lifecycle
operation, option, anchor, snapshot field, and backend contract.

## Compatibility

| Annotator | Babylon Lite | Instancer |
| --- | --- | --- |
| `0.1.x` | `^1.13.0` | `^0.6.0` (optional) |
