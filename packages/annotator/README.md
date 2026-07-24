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

Dimensions, arbitrary callouts, general pointer-event APIs, custom DOM content,
React bindings, and a GPU annotation renderer are intentionally deferred.

## Examples

Browse the
[example source](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
or run the multi-page gallery from the repository root:

```sh
npm run dev:annotator
```

The gallery includes mesh labels, dots and rings with viewport clamping, live
callback text, stable Instancer anchors, explicit lifecycle/disposal, eight
collision modes, and experimental batched depth occlusion.

The collision stress scene exercises selectable 100, 250, and 500-label loads
with moving anchors, changing text widths, and clamped edge labels. Its timing
panel reports the latest update, arithmetic mean, and p95. A p95 of `7.6 ms`
means 95% of sampled annotation updates completed in `7.6 ms` or less.

## Experimental depth occlusion

The optional Babylon adapter hides labels and markers whose anchors are behind
scene geometry. Create it before `registerScene()` and pass it to a layer,
which adopts and disposes it:

```ts
import { createBabylonDepthOcclusionProvider }
  from "@litools/annotator/babylon-occlusion";

const occlusionProvider = createBabylonDepthOcclusionProvider({
  scene,
  camera,
  canvas,
  enterHysteresis: 2,
  exitHysteresis: 2
});

const layer = createAnnotationLayer({
  scene,
  camera,
  canvas,
  backend,
  updateMode: "raf",
  occlusionProvider
});

createLabel(layer, {
  anchor: { kind: "mesh", mesh, preset: "top" },
  text: "Pump A-12",
  occlusion: "fade",
  occludedOpacity: 0.5,
  occlusionBias: 0.0005,
  style: { opacityTransitionDuration: 180 }
});
```

The adapter renders one reverse-Z screen-depth attachment and evaluates all
opted-in anchors in one compute dispatch. Results arrive asynchronously, so
visibility normally trails the rendered scene by one or two frames. Manual
layers must receive another `updateAnnotationLayer()` call to consume a
completed result.

`occlusion` supports `"none"`, `"hide"`, and `"fade"`. Fade multiplies
`style.opacity` by `occludedOpacity` (default `0.5`) while keeping the
annotation rendered. `style.opacityTransitionDuration` adds a CSS opacity
transition in milliseconds. The snapshot reports the stable result through
`occluded`.

The provider defaults to two consecutive samples when entering and leaving
occlusion, avoiding flicker at geometry edges. Tune this with
`enterHysteresis` and `exitHysteresis`. `provider.getStats()` exposes query,
readback, dropped-frame, and timing counters for diagnostics.

This entry point currently relies on private Babylon Lite frame-graph, render
target, and engine fields. Keep its Babylon peer version pinned within the
documented compatible range and rerun browser validation when upgrading Lite.
Transparent and custom materials may not contribute the same coverage as their
visible color pass.

## Label collisions

Collision handling is opt-in so existing layouts remain unchanged.

| Mode | Behavior |
| --- | --- |
| `"none"` | Never suppresses the label; the label still blocks managed labels. |
| `"hide"` | Hides the lower-priority label when it overlaps. |
| `"shift"` | Searches deterministic nearby directions. |
| `"shift-x"` | Searches horizontally only. |
| `"shift-y"` | Searches vertically only. |
| `"radial"` | Prefers deterministic spokes pointing away from the viewport center. |
| `"cluster"` | Replaces overlapping cluster labels with one `"N labels"` summary. |
| `"repel"` | Iteratively moves away from the rectangles currently blocking the label. |

```ts
createLabel(layer, {
  anchor: { kind: "mesh", mesh, preset: "top" },
  text: "Sensor 12",
  collision: "shift",
  collisionPadding: 4,
  collisionMaxShift: 96,
  leaderLine: {
    color: "#5bf0bd",
    width: 1,
    opacity: 0.75,
    minLength: 8
  },
  zIndex: 20
});
```

Higher `zIndex` labels win. Labels with equal z-index use creation order.
`collisionMaxShift` limits displacement in CSS pixels for every moving mode; if
no placement fits, the label falls back to collision hiding. Radial placement
uses deterministic spokes, including for labels exactly at the viewport
center. Labels using the default
`collision: "none"` always remain visible and act as obstacles. Shifted or
hidden labels are reconsidered on every update and return toward their anchors
as space becomes available. Inspect `snapshot.layoutOffset` to read the
applied displacement.

Cluster groups use the same deterministic z-index and creation-order priority.
Only labels using `"cluster"` join a cluster. The representative displays
`"N labels"` while grouped; isolated labels automatically recover their
original text and visibility. Stable groups reuse their summary and measured
geometry instead of rewriting the DOM every update.

Repel placement is deterministic, stays inside the active viewport and
`collisionMaxShift`, and falls back to collision hiding when no free position
can be reached.

Leader lines are optional and render only for shifted labels whose layout
displacement reaches `minLength`. They connect the pre-layout position to the
nearest label edge, remain behind all labels, and share the label's visibility
and disposal lifecycle. Pass `leaderLine: false` through `updateLabel()` to
remove one. The collision stress example leaves lines disabled so its timings
measure layout rather than hundreds of SVG elements.

## Clickable HTML labels

The HTML backend can make labels pointer- and keyboard-activatable:

```ts
const backend = createHtmlAnnotationBackend({
  container,
  onLabelActivate(annotationId, event) {
    focusTargetFor(annotationId);
  }
});
```

Interactive labels receive `pointer-events: auto`, keyboard focus, and
Enter/Space activation. Markers and non-interactive layers remain
non-interactive. The collision example maps label IDs to meshes and smoothly
retargets its ArcRotate camera when a label is activated.

See the [API reference](./API.md) for every public entry point, lifecycle
operation, option, anchor, snapshot field, and backend contract.

## Compatibility

| Annotator | Babylon Lite | Instancer |
| --- | --- | --- |
| `0.1.x` | `^1.13.0` | `^0.6.0` (optional) |
