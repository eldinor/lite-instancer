# @litools/annotator API reference

Version 0.1.2 exposes four ESM entry points:

- `@litools/annotator` — layers, annotations, anchors, lifecycle, snapshots,
  projection, and backend contracts.
- `@litools/annotator/html` — the shipping HTML backend.
- `@litools/annotator/instancer` — optional stable-ID Instancer anchors.

- `@litools/annotator/babylon-occlusion` — experimental batched depth
  occlusion for Babylon Lite.

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
  collision: "shift",
  collisionPadding: 4,
  collisionMaxShift: 96,
  leaderLine: {
    color: "#5bf0bd",
    width: 1,
    opacity: 0.75,
    minLength: 8
  },
  visible: true,
  zIndex: 10,
  worldOffset: [0, 0.15, 0],
  screenOffset: [0, -8],
  minDistance: 1,
  maxDistance: 50,
  hideWhenOffscreen: true,
  occlusion: "fade",
  occludedOpacity: 0.5,
  occlusionBias: 0.0005,
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
    className: "plant-label",
    opacityTransitionDuration: 180
  }
});
```

`text` accepts a string or `() => string`. Callback text is evaluated on
creation and after `invalidateAnnotation(label)`, not every frame.

```ts
type LabelCollisionMode =
  | "none"
  | "hide"
  | "shift"
  | "shift-x"
  | "shift-y"
  | "radial"
  | "cluster"
  | "repel";
```

| Mode | Contract |
| --- | --- |
| `"none"` | Always remains visible and acts as an obstacle. |
| `"hide"` | Hides when a higher-priority rectangle blocks it. |
| `"shift"` | Searches deterministic nearby directions. |
| `"shift-x"` | Searches horizontally only. |
| `"shift-y"` | Searches vertically only. |
| `"radial"` | Prefers outward spokes from the viewport center. |
| `"cluster"` | Collapses overlapping cluster labels into one count summary. |
| `"repel"` | Iteratively moves away from the current blocking rectangle. |

Higher `zIndex` wins and equal values use creation order.
`collisionPadding` adds non-negative separation in CSS pixels.
`collisionMaxShift` limits all moving modes. If no placement fits inside the
active viewport, the label is hidden with `hiddenReason: "collision"`.
Managed labels are reconsidered every update and recover automatically.

`"cluster"` groups overlapping labels that also use `"cluster"` under the
highest-priority representative, changes its displayed text and accessible
name to `"N labels"`, and hides the other members. Original text and
visibility recover automatically when the group separates. Stable cluster
summaries avoid repeated DOM writes and measurements.

`"repel"` iteratively moves each lower-priority label away from its current
blocking rectangle. It respects the viewport and `collisionMaxShift`, remains
deterministic for coincident centers, and falls back to hiding if trapped.

`leaderLine` accepts `true` for defaults, an options object, or `false` to
disable it through `updateLabel()`. Lines appear only for shifted labels once
the collision-layout displacement reaches `minLength` (default `8` CSS
pixels). They connect the pre-layout position to the nearest edge of the final
label bounds and hide automatically when the label is unshifted or not
rendered.

```ts
interface LeaderLineOptions {
  color?: string;
  width?: number;
  opacity?: number;
  minLength?: number;
}
```

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

`occlusion` is `"none"` (default), `"hide"`, or `"fade"` and is active only
when the layer has an `occlusionProvider`. Fade keeps the annotation rendered
at `style.opacity * occludedOpacity`; the factor defaults to `0.5`.
`occlusionBias` is a non-negative reverse-Z depth separation and defaults to
`0.0001`. `opacityTransitionDuration` is an HTML opacity transition duration
in milliseconds. `hideWhenOccluded` remains as a deprecated compatibility
alias.

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
  readonly occluded: boolean;
  readonly hiddenReason:
    | "none"
    | "anchor-unavailable"
    | "target-hidden"
    | "behind-camera"
    | "offscreen"
    | "distance"
    | "occluded"
    | "collision";
  readonly worldPosition: readonly [number, number, number] | null;
  readonly screenPosition: Readonly<{ x: number; y: number }> | null;
  readonly unclampedScreenPosition: Readonly<{ x: number; y: number }> | null;
  readonly layoutOffset: Readonly<{ x: number; y: number }> | null;
  readonly depth: number | null;
  readonly bounds: Readonly<DOMRectReadOnly> | null;
}
```

Screen positions, layout offsets, and bounds are relative to the canvas overlay
in CSS pixels. `layoutOffset` is `{ x: 0, y: 0 }` for an unshifted rendered
annotation and `null` while hidden.

## Experimental Babylon depth occlusion

```ts
import { createBabylonDepthOcclusionProvider }
  from "@litools/annotator/babylon-occlusion";

const provider = createBabylonDepthOcclusionProvider({
  scene,
  camera,
  canvas,
  sampleRadius: 1,
  minimumOccludingSamples: 3,
  enterHysteresis: 2,
  exitHysteresis: 2
});

const layer = createAnnotationLayer({
  scene,
  camera,
  canvas,
  backend,
  occlusionProvider: provider
});
```

Create the provider before `registerScene()`. The layer adopts it and calls
`dispose()` during layer disposal. The adapter uses a five-sample cross around
each anchor; `sampleRadius` is a non-negative backing-store pixel distance and
`minimumOccludingSamples` is an integer from one through five.
`enterHysteresis` and `exitHysteresis` are positive consecutive-readback
thresholds and default to two. `provider.getStats()` returns query counts,
completed and dropped readbacks, in-flight work, and last/average readback
latency.

The implementation batches opted-in annotations into one compute dispatch and
packed asynchronous readback. Results can trail by one or two rendered frames.
It currently depends on Babylon Lite private fields and should be treated as
experimental compatibility surface.

## HTML backend

```ts
import { createHtmlAnnotationBackend } from "@litools/annotator/html";

const backend = createHtmlAnnotationBackend({
  container,
  rootClassName: "my-annotation-root",
  onLabelActivate(annotationId, event) {
    focusTargetFor(annotationId);
  }
});
```

The caller owns the positioned container. The backend creates and owns only
its root inside that container and does not rewrite caller styles. An internal
SVG layer renders leader lines behind all label elements. The root, SVG layer,
markers, and ordinary labels use `pointer-events: none`. When
`onLabelActivate` is provided, labels instead receive pointer events, keyboard
focus, and Enter/Space activation. An explicit annotation role is preserved;
otherwise interactive labels use `role="button"`.

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
backends. HTML is the only backend shipped in 0.1; general pointer-event
streams, scene occlusion, arbitrary DOM content, serialization, and GPU
rendering are outside this version.
