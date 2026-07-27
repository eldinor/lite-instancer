# @litools/annotator API reference

Version 0.1.2 exposes six ESM entry points:

- `@litools/annotator` — layers, annotations, anchors, lifecycle, snapshots,
  projection, and backend contracts.
- `@litools/annotator/html` — the shipping HTML backend.
- `@litools/annotator/instancer` — optional stable-ID Instancer anchors.
- `@litools/annotator/babylon-occlusion` — experimental batched depth
  occlusion for Babylon Lite.
- `@litools/annotator/textrender` — optional GPU text and marker backend.

- `@litools/annotator/interaction` — optional synchronous CPU picking and
  pointer interaction for either backend.

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
  occlusionBias: 0,
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
disable it through `updateLabel()`. Lines appear when collision layout,
clamping, or an explicit `screenOffset` moves the label at least `minLength`
(default `8` CSS pixels) away from its projected anchor. They connect the
anchor to the nearest edge of the final label bounds and hide automatically
when the anchor falls inside the label or the label is not rendered.

```ts
interface LeaderLineOptions {
  color?: string;
  width?: number;
  opacity?: number;
  lineCap?: "square" | "round"; // default "square"
  minLength?: number;
}
```

Omitting `lineCap` uses square ends in both HTML and TextRenderer backends.
Rounded GPU lines are opt-in because each visible line uses one body and two
cap sprites instead of one stretched sprite.

### `createMarker(layer, options)`

```ts
const marker = createMarker(layer, {
  anchor: { kind: "world", position: [0, 1, 0] },
  shape: "ring",
  size: 14,
  animation: {
    type: "pulse",
    frequency: 1.2,
    phase: 0.25,
    minOpacity: 0.35,
    maxOpacity: 1
  },
  style: { color: "#58e6bd", borderWidth: 2 }
});
```

`MarkerShape` is an open string type with built-in `"dot"`, `"ring"`,
`"square"`, `"diamond"`, `"triangle"`, `"cross"`, and `"pin"` identifiers.
Sizes use CSS pixels. The optional `pulse` animation is implemented by the GPU
TextRenderer backend; `frequency` is cycles per second and `phase` is measured
in cycles. The HTML backend accepts but ignores this GPU presentation option.
Use `updateMarker(marker, { animation: null })` to return to the static path.

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

## GPU TextRenderer backend

The backend is exported only from its dedicated entry point so applications
using the main or HTML entries do not bundle TextRenderer or private layout
code.

```ts
import { createTextRendererAnnotationBackend }
  from "@litools/annotator/textrender";

await registerScene(scene);
const backend = createTextRendererAnnotationBackend({
  surface: scene.surface,
  font,
  defaultFontSize: 16,
  defaultColor: "#fff",
  coverageGamma: 1,
  shapeCacheSize: 512,
  shapingMode: "public"
});
```

```ts
type TextRendererShapingMode = "public" | "guarded-private";

interface TextRendererAnnotationBackendOptions {
  surface: SurfaceContext;
  font: Font;
  defaultFontSize?: number;
  defaultColor?: string;
  coverageGamma?: number;
  shapeCacheSize?: number;
  shapingMode?: TextRendererShapingMode;
  markerShapes?: Readonly<Record<string, TextRendererMarkerShapeRasterizer>>;
}

interface TextRendererAnnotationBackendStats {
  readonly requestedShapingMode: TextRendererShapingMode;
  readonly privateAdapterAvailable: boolean;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly publicShapes: number;
  readonly privateShapes: number;
  readonly privateFallbacks: number;
  readonly liveLabels: number;
  readonly spriteRendererActive: boolean;
  readonly spriteBuckets: number;
  readonly spriteDrawCalls: number;
  readonly textBuckets: number;
  readonly textDrawCalls: number;
  readonly liveLeaderLines: number;
  readonly leaderLineSprites: number;
  readonly leaderLineDrawCalls: number;
  readonly liveMarkers: number;
  readonly liveAnimatedMarkers: number;
  readonly markerSprites: number;
  readonly markerDrawCalls: number;
  readonly animatedMarkerDrawCalls: number;
  readonly fullMarkerUpdates: number;
  readonly markerPositionBatches: number;
  readonly batchedMarkerPositions: number;
}
```

Create the factory only after `registerScene()`. It creates and registers a
non-clearing Lite `TextRenderer`, sharing one glyph storage across all labels
and batching text data by distinct `zIndex`. Disposing the annotation layer
unregisters the renderer and releases its text data and glyph storage; the
surface and font are caller-owned.

For the default high-throughput path, omit `zIndex`. Every label then uses
`zIndex: 0`, producing one text bucket and one TextRenderer draw call regardless
of label count. Equal-z collision priority remains deterministic by creation
order. Each explicitly distinct `zIndex` creates a separate text bucket and
draw call, so use additional values only when different text draw ordering is
required. `getStats().textBuckets` and `textDrawCalls` expose the result.
`fullMarkerUpdates`, `markerPositionBatches`, and `batchedMarkerPositions` are
lifetime counters intended for profiling. Take snapshots before and after a
sample to obtain workload-local deltas.

The default public bridge shapes with temporary `DefaultTextData` and copies
its public run and metrics into shared storage. `"guarded-private"` is an
experimental opt-in that bundles Lite 1.14's internal layout implementation.
It validates the private font and layout structures before use. Any error or
structural mismatch disables the adapter permanently for that backend instance
and falls back to the public bridge; correctness never depends on private Lite
structures. Use `getStats()` to observe both paths and the bounded shape cache.

TextRenderer labels support text, CSS color, opacity, font size, z-order,
visibility, clamping, all collision modes, clustering, hide/fade occlusion,
GPU leader lines, and nine-slice backgrounds. CSS colors are converted from
sRGB to linear RGBA once per distinct value and reused for text and sprite
styling. Annotator coordinates and measured bounds remain CSS pixels; the
backend applies the same uniform canvas backing-store ratio to text and
Sprite2D layers and rejects materially different X/Y scales.

`backgroundColor`, `borderColor`, `borderWidth`, `borderRadius`, and `padding`
are supported for labels. Each distinct visual background is rasterized once
as nine premultiplied linear atlas patches. A live card uses nine sprites, but
all visible cards in one z bucket share one background layer and draw call.
Corner and border patches keep their CSS-pixel size while edge and center
patches stretch with shaped text. Padding and border width expand measured
bounds for clamping, collisions, leader-line endpoints, and interaction;
padding without a visible fill or border allocates no sprites. Hidden cards
retain invisible slots for reuse. Stats expose `liveLabelBackgrounds`,
`labelBackgroundSprites`, and `labelBackgroundDrawCalls`.

Leader lines lazily create one shared non-clearing SpriteRenderer and in-memory
square/circle atlas. The renderer is registered behind the TextRenderer.
Default square lines use one stretched sprite; `lineCap: "round"` uses a body
and two circular cap sprites. Null, hidden, occluded-hidden, clustered, and
unshifted line geometry keeps reusable slots invisible. Removing a line frees
its slots. All lines share one Sprite2D layer and use one line draw call while
any line is visible. GPU lines add no DOM/SVG accessibility, picking, or
interaction.

GPU markers support built-in `"dot"`, `"ring"`, `"square"`, `"diamond"`,
`"triangle"`, `"cross"`, and `"pin"` shapes, CSS-pixel size, color, opacity,
background color, border color/width, visibility, clamping, distance
limits, and hide/fade occlusion. Marker appearances are cached as
premultiplied linear atlas frames, so each live marker uses exactly one sprite.
Markers, backgrounds, and leader lines share one Sprite2D bucket per distinct
annotation `zIndex`. Each bucket owns line, label-background, then marker
layers; lower z-index buckets draw first and empty buckets are removed. A
visible layer costs one draw call, so the omitted `zIndex: 0` path remains the
fastest. Sprite2D
buckets render before the TextRenderer pass and therefore cannot interleave a
marker between text buckets. Stats expose `spriteBuckets`, `spriteDrawCalls`,
`markerDrawCalls`, and `leaderLineDrawCalls`.

GPU pulse animation lazily creates one Sprite FX marker layer per participating
z bucket. Phase, frequency, and minimum/maximum opacity are stored in each
sprite's instance tint and evaluated from Lite's public per-layer `fx.time`
clock. No per-frame `updateMarker()` calls or atlas changes are required.
Static markers keep the standard shader. Mixing static and animated markers in
one z bucket uses two marker draw calls; an all-animated bucket uses one.

After its first resolved frame, an unchanged marker skips projection and
backend sprite writes while the camera matrix/position, camera viewport,
resolved anchor position/visibility, requested visibility, definition, and
relevant occlusion inputs remain stable. GPU pulse continues through `fx.time`
during skipped CPU updates. Camera or target movement, viewport changes,
`updateMarker`, anchor replacement, visibility changes, and active asynchronous
occlusion invalidate the shortcut. Labels retain their normal measurement and
collision-layout updates.

During camera or viewport movement, a clean, unclamped marker can use the
backend's optional `updateMarkerPositions()` batch. Core projection reuses
scratch storage and defers allocation of the immutable public snapshot until
`getAnnotationSnapshot()` is called. The TextRenderer backend implements this
hook; other backends continue to receive ordinary `update()` calls. Any marker
definition, style, z-order, animation, clamping, visibility, or relevant
occlusion change automatically selects the full update path.

`projectAnnotationPosition(input, output?)` accepts an optional previous result
as reusable output storage for allocation-sensitive projection loops. Omitting
it preserves the original allocating behavior. Set `calculateDistance: false`
when distance output/filtering is not needed to skip the square-root operation;
the returned `distance` is then `0`.

`MarkerShape` is an open string union. `markerShapes` on
`TextRendererAnnotationBackendOptions` registers application rasterizers by
string ID; namespaced IDs are recommended. A rasterizer receives `frameSize`,
CSS `size` and `borderWidth`, and straight-alpha linear `fill` and `border`
colors. It returns a `frameSize * frameSize * 4` `Uint8Array` containing
premultiplied linear RGBA8 pixels. Built-ins cannot be replaced and an unknown
shape ID throws `AnnotatorError`.
`backend.supportsMarkerShape(id)` checks built-in and registered identifiers
without attempting to create a marker.

Background, border, radius, and padding styling is supported for labels and the
applicable marker fields. Font weight, classes, and opacity transitions throw
`AnnotatorError`. `ariaLabel` and
`role` are accepted but ignored, including for cluster summaries. This backend
has no DOM accessibility. Pointer interaction can be added explicitly through
`@litools/annotator/interaction`; use the HTML backend when DOM semantics or
keyboard accessibility are required.

## CPU interaction

Import from `@litools/annotator/interaction`; the main entry does not re-export
these functions.

```ts
const manager = createAnnotationInteractionManager({
  layer,
  canvas,
  hover: true,
  cellSize: 64,
  hitSlop: 0
});
const target = registerInteractiveAnnotation(manager, annotation, {
  enabled: true,
  hitSlop: 4
});
const remove = onAnnotationInteraction(target, "click", listener);
```

`createAnnotationInteractionManager(options)` observes core-owned final hit
regions for one layer. It does not call `getAnnotationSnapshot()` and does not
perform GPU readback. The uniform spatial index is synchronized lazily after a
registered region changes. Small dirty sets update only their previous and new
cells; large dirty sets use one full rebuild. `cellSize` must be positive;
hit-slop values must be non-negative. Logical hit priority is higher `zIndex`,
then later annotation creation. Leader lines are not targets.

`registerInteractiveAnnotation()` accepts labels and markers from the manager's
layer. Labels use measured bounds. Dot/ring, diamond, and triangle markers use
shape-aware tests; other shapes use their rectangular bounds. Hidden and
disposed annotations leave the index automatically.

Target listeners and `onAnnotationInteractionEvent(manager, type, listener)`
support `pointerdown`, `pointerup`, `click`, `doubleclick`, `contextmenu`,
`hoverstart`, `hovermove`, and `hoverend`. Hover is disabled for touch and
coalesced to the newest mouse/pen sample per animation frame. Listener errors
are isolated through `onError`. `stopPropagation()` prevents only the manager's
global listener; it does not alter native DOM propagation.

`pickInteractiveAnnotation(manager, canvasX, canvasY)` performs a synchronous
manual query in CSS pixels. Enable/lifecycle helpers are
`setAnnotationInteractionEnabled()`, `setInteractiveAnnotationEnabled()`,
`disposeInteractiveAnnotation()`, and
`disposeAnnotationInteractionManager()`. State/diagnostic queries are
`getHoveredAnnotation()`, `getPressedAnnotation()`, and
`getAnnotationInteractionDiagnostics()`. Diagnostics report registered/indexed
targets, grid cells and full rebuilds, incremental target updates, region
updates, queries/hits, candidate tests, and hover coalescing counters.

Interaction supplies no focus management, keyboard semantics, dragging,
selection ownership, or camera arbitration. Dispose the manager before or with
its annotation layer.

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
SVG layer renders leader lines behind all label elements. Lines use square caps
by default and rounded caps only when explicitly requested. The root, SVG layer,
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
backends. `updateMarkerPositions()` is optional: core calls it only for clean,
unclamped markers and passes reusable `BackendMarkerPositionUpdate` records.
Implementations must consume each record synchronously and must not retain the
record or the containing array. General pointer-event streams, arbitrary DOM
content, and serialization remain outside this version.
