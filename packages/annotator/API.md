# @litools/annotator API reference

Version 0.1 exposes three ESM entry points:

- `@litools/annotator` — layers, annotations, anchors, lifecycle, snapshots,
  projection, and backend contracts.
- `@litools/annotator/html` — the shipping HTML backend.
- `@litools/annotator/instancer` — optional stable-ID Instancer anchors.

## Layer lifecycle

### `createAnnotationLayer(options)`

Creates one annotation layer for one camera and its active viewport.

```ts
const layer = createAnnotationLayer({
  scene,
  camera,
  canvas,
  backend,
  updateMode: "manual",
  viewportPadding: 0
});
```

`updateMode` is `"manual"` by default. Use `"raf"` to let the layer own a
cancellable `requestAnimationFrame` loop.

### `updateAnnotationLayer(layer)`

Resolves anchors, projects positions, applies visibility, updates the backend,
and refreshes snapshots. Call it from the application update/render loop in
manual mode. Calling it in RAF mode processes the same deterministic update
path immediately.

### `invalidateAnnotationLayer(layer)`

Marks layer projection and layout data dirty. Use it after an external change
that cannot be observed automatically.

### `disposeAnnotationLayer(layer)`

Disposes every child annotation, backend resource, observer, owned listener,
DOM root, and RAF callback. Disposal is idempotent.

## Creating annotations

### `createLabel(layer, options)`

```ts
const label = createLabel(layer, {
  anchor: { kind: "mesh", mesh, preset: "top" },
  text: "Pump A-12",
  visible: true,
  zIndex: 10,
  worldOffset: [0, 0.15, 0],
  screenOffset: [0, -8],
  minDistance: 1,
  maxDistance: 50,
  hideWhenOffscreen: true,
  clampToViewport: false,
  ariaLabel: "Pump A-12 status",
  role: "status",
  style: {
    color: "#fff",
    backgroundColor: "#10251f",
    opacity: 1,
    fontSize: 14,
    fontWeight: 600,
    borderColor: "#58e6bd",
    borderWidth: 1,
    borderRadius: 6,
    padding: 6,
    className: "plant-label"
  }
});
```

`text` accepts a string or `() => string`. Callback text is evaluated on
creation and after `invalidateAnnotation(label)`, not every frame.

### `createMarker(layer, options)`

```ts
const marker = createMarker(layer, {
  anchor: { kind: "world", position: [0, 1, 0] },
  shape: "ring",
  size: 14,
  style: { color: "#58e6bd", borderWidth: 2 }
});
```

Marker shapes are `"dot"` and `"ring"`. Sizes use CSS pixels.

## Updating annotations

- `updateLabel(label, patch)` updates any label option.
- `updateMarker(marker, patch)` updates any marker option.
- `setAnnotationVisible(annotation, visible)` changes requested visibility.
- `setAnnotationAnchor(annotation, anchor)` replaces an anchor.
- `invalidateAnnotation(annotation)` refreshes callback text and marks the
  annotation dirty.
- `disposeAnnotation(annotation)` releases one annotation. Disposal is
  idempotent.

Any non-disposal operation on a disposed annotation or layer throws
`AnnotatorError`.

## Anchors

### World anchors

```ts
{ kind: "world", position: [x, y, z] }
```

Input vectors are copied when accepted.

### Mesh anchors

```ts
{ kind: "mesh", mesh, point: [x, y, z], space: "local" }
{ kind: "mesh", mesh, point: [x, y, z], space: "world" }
{ kind: "mesh", mesh, preset: "top" }
```

Point space defaults to `"local"`. Presets are `"center"`, `"top"`,
`"bottom"`, `"left"`, `"right"`, `"front"`, and `"back"`. A mesh anchor
without a point or preset uses the local bounds center. Hidden meshes hide
their annotations.

### Stable instance anchors

Import this helper only from the optional Instancer entry point:

```ts
import { createInstanceAnchor } from "@litools/annotator/instancer";

const anchor = createInstanceAnchor(instanceSet, instanceId, {
  localPoint: [0, 1, 0]
});
```

The helper resolves the stable ID every update and never retains a
thin-instance slot. A missing ID hides the annotation and may recover later.
For bounds presets, pass reusable local geometry bounds:

```ts
createInstanceAnchor(instanceSet, instanceId, {
  preset: "top",
  localBounds: {
    minimum: [-0.5, -0.5, -0.5],
    maximum: [0.5, 0.5, 0.5]
  }
});
```

## Snapshots

`getAnnotationSnapshot(annotation)` returns the latest immutable view:

```ts
interface AnnotationSnapshot {
  readonly id: AnnotationId;
  readonly type: "label" | "marker";
  readonly requestedVisible: boolean;
  readonly rendered: boolean;
  readonly hiddenReason:
    | "none"
    | "anchor-unavailable"
    | "target-hidden"
    | "behind-camera"
    | "offscreen"
    | "distance";
  readonly worldPosition: readonly [number, number, number] | null;
  readonly screenPosition: Readonly<{ x: number; y: number }> | null;
  readonly unclampedScreenPosition: Readonly<{ x: number; y: number }> | null;
  readonly depth: number | null;
  readonly bounds: Readonly<DOMRectReadOnly> | null;
}
```

Screen positions and bounds are relative to the canvas overlay in CSS pixels.

## HTML backend

```ts
import { createHtmlAnnotationBackend } from "@litools/annotator/html";

const backend = createHtmlAnnotationBackend({
  container,
  rootClassName: "my-annotation-root"
});
```

The caller owns the positioned container. The backend creates and owns only
its root inside that container and does not rewrite caller styles. The root
and annotation elements use `pointer-events: none`.

## Projection utility

`projectAnnotationPosition(input)` projects a world position through a supplied
view-projection matrix and camera viewport:

```ts
const result = projectAnnotationPosition({
  position,
  viewProjection,
  viewport: { left, top, width, height },
  cameraPosition
});
```

It returns `screenPosition`, normalized `depth`, camera `distance`,
`behindCamera`, and `offscreen`. All screen units are CSS pixels. CSS rotation
and skew on the canvas are unsupported in 0.1.

## Backend contract

`AnnotationBackend`, `BackendAnnotationDefinition`,
`BackendAnnotationUpdate`, and related types are exported for alternative
backends. HTML is the only backend shipped in 0.1; interaction, occlusion,
collision layout, arbitrary DOM content, serialization, and GPU rendering are
outside this version.
