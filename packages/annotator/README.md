# @litools/annotator

Annotator is a lightweight annotation system for Babylon Lite that provides
world-space labels, dimensions, callouts, markers, and stable annotations for
regular meshes and `@litools/instancer` instances.

Babylon Lite provides the rendering foundation required for interactive 3D
applications, but application developers still need higher-level tools for
presenting spatial information.

Common use cases include:

- Displaying labels above objects.
- Showing dimensions between points.
- Attaching callouts to parts.
- Placing markers in world space.
- Keeping annotations readable on screen.
- Hiding labels behind geometry.
- Preventing label overlap.
- Attaching annotations to stable Instancer IDs.
- Making annotations interactive.

`@litools/annotator` provides these capabilities without becoming a general
GUI framework.

Babylon Lite renders the scene. `@litools/annotator` explains the scene.

[Annotator website](https://annotator.babylonpress.org)

Current release: **0.2.0**.

[Examples](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
· [API reference](./API.md)
· [Benchmarks](./BENCHMARK.md)
· [Changelog](./CHANGELOG.md)

## Rendering backends

The **HTML backend** renders annotations as DOM elements over the canvas. It is
the best choice for rich CSS styling, accessibility, familiar browser layout,
and smaller annotation counts.

The fast **GPU TextRenderer backend** renders text, markers, backgrounds, and
leader lines through Babylon Lite. It batches large annotation sets efficiently
and is the better choice for dense or frequently changing 3D scenes.

## Install

```sh
npm install @litools/annotator@^0.2.0 @babylonjs/lite@^1.14.0
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
and React bindings are intentionally deferred.

## Examples

Open the hosted [Annotator examples](https://annotator.babylonpress.org), browse the
repository source below, or run the gallery locally.

Browse the
[example source](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
or run the multi-page gallery from the repository root:

```sh
npm run dev:annotator
```

The unified gallery groups eight HTML-overlay and twelve GPU TextRenderer demos.
Every live page has breadcrumbs, previous/next controls, and an all-demos
drawer, so the complete learning path stays reachable without returning to the
catalog. It covers mesh labels, markers, live text, stable Instancer anchors,
lifecycle, collisions, depth occlusion, GPU shaping, Sprite2D leader lines,
manual JSON benchmarks, and selectable 100/250/500-label stress loads.
See [BENCHMARK.md](./BENCHMARK.md) for suite methodology, workload versions,
cache-churn coverage, reference results, and interpretation guidance.

## GPU TextRenderer annotations

Import the optional GPU label-and-marker backend from its tree-shakable entry point. The
scene must be registered before the backend factory runs because the factory
registers a non-clearing Lite `TextRenderer` pass.

```ts
import { loadFont, registerScene } from "@babylonjs/lite";
import { createAnnotationLayer } from "@litools/annotator";
import { createTextRendererAnnotationBackend }
  from "@litools/annotator/textrender";

await registerScene(scene);
const font = await loadFont("/fonts/Inter-Regular.ttf");
const backend = createTextRendererAnnotationBackend({
  surface: scene.surface,
  font,
  shapingMode: "public"
});
const layer = createAnnotationLayer({ scene, camera, canvas, backend });
```

The default `"public"` mode shapes through Lite's supported text-data API.
Opt-in `"guarded-private"` mode uses a bundled Lite 1.14 layout adapter for
faster shaping. Runtime guards permanently disable that adapter for the
backend instance after its first mismatch or error, then use the public path.
`backend.getStats()` reports cache activity, shaping-path counts, private
fallbacks, adapter availability, live labels, backgrounds and markers, text
buckets/draw calls, Sprite2D counts, bounded appearance-cache entries, atlas
frames/bytes, evictions, and capacity misses.

Long-running dynamic-style applications can tune independent cache limits:

```ts
const backend = createTextRendererAnnotationBackend({
  surface,
  font,
  shapeCacheSize: 512,
  colorCacheSize: 256,
  markerFrameCacheSize: 256,
  backgroundFrameCacheSize: 128,
  spriteAtlasFrameLimit: 2048
});
```

Colors use LRU eviction. Marker and nine-slice appearance records are
reference-counted and only evicted when unused; live records may temporarily
exceed a soft cache limit. The fixed 1024 x 1024 Sprite2D atlas is append-only
in the current Babylon Lite API, so evicting a lookup record does not reclaim
GPU pixels. The hard frame limit rejects new one-off appearances with a clear
error before an incorrect visual can be reused.

The default GPU path is already the fastest batching configuration. Labels
that omit `zIndex` all use `0`, so they share one TextRenderer bucket and one
text draw call. Assign distinct `zIndex` values only when labels require
different draw ordering: each distinct value creates another text bucket and
draw call. Equal-z labels keep deterministic collision priority through their
creation order.

The backend supports text, nine-slice label backgrounds, dots, rings, squares,
diamonds, triangles, crosses, pins, color, opacity, font size, visibility,
clamping, clustering, every collision mode, hide/fade occlusion, and GPU
Sprite2D leader lines. Markers use CSS-pixel size plus HTML-compatible fill,
border color, and border width. Cached atlas frames keep every marker at one
sprite; markers sharing a `zIndex` share one layer and draw call. Lines render
below markers in each Sprite2D bucket, and all sprites render below every text
bucket. Square line caps are the one-sprite default; rounded caps are an
explicit three-sprite option. By default, label background color, border
color/width/radius, and padding use nine reusable atlas patches per card and
one background draw call per visible z bucket. Set
`labelBackgroundMode: "rounded-card"` to opt into one analytic Sprite2D card
per label. Rounded cards batch by `zIndex` and visual style, so each distinct
visible style adds a custom-shader layer and draw call. Font weight, CSS
classes, opacity transitions, and
DOM accessibility remain HTML-only. The optional interaction entry adds pointer
hit testing to either backend without adding DOM semantics.

`MarkerShape` is an open string union: built-in names retain editor completion
without closing the API to later or application-defined shapes. Register a
namespaced custom GPU shape when creating the backend. Its rasterizer runs
once for each distinct styled atlas frame and must return a 64-by-64
premultiplied linear RGBA8 image:

```ts
const backend = createTextRendererAnnotationBackend({
  surface: scene.surface,
  font,
  markerShapes: {
    "factory/valve": ({ frameSize, fill, border, borderWidth, size }) =>
      rasterizeValve({ frameSize, fill, border, borderWidth, size })
  }
});
```

Unknown identifiers and attempts to replace a built-in shape throw a clear
`AnnotatorError`. Every built-in and registered shape remains one GPU sprite.

Marker pulse requests use Lite's public GPU Sprite FX clock by default, without
per-frame API calls. There is no CPU/GPU mode selector: specifying
`animation: { type: "pulse" }` selects the GPU path automatically:

```ts
createMarker(layer, {
  anchor,
  shape: "diamond",
  size: 18,
  animation: {
    type: "pulse",
    frequency: 1.2,
    phase: 0.25,
    minOpacity: 0.35,
    maxOpacity: 1
  },
  style: { color: "#72e6ff" }
});
```

The pulse parameters occupy per-sprite instance tint fields and the GPU
evaluates opacity from `fx.time`. Animated markers lazily use a separate layer,
leaving the static pipeline unchanged. An all-animated z bucket is one draw
call; mixing static and animated markers in the same bucket is two. The public
Sprite FX bridge supports fragment animation, so pulse changes opacity rather
than marker geometry. Do not simulate a pulse by changing marker size or
opacity with `updateMarker()` every frame; that CPU-driven pattern rewrites
every marker and scales poorly.

Unchanged markers reuse their latest projection and skip backend sprite writes
when the camera, viewport, resolved anchor, visibility, definition, and
occlusion inputs are stable. GPU pulse keeps running independently during this
CPU fast path. Camera/target movement or any relevant marker mutation restores
the full update automatically. Clean labels without clamping, collision layout,
or leader lines use a position batch after their first measured update.
Same-z GPU labels translate their existing Lite glyph slots in place without
allocating replacement runs. Labels whose measurement or collision layout can
change continue through the full update path.

Changing fixed-format text, such as `Sensor 01: 10.0` to `Sensor 01: 10.1`,
also patches compatible existing glyph slots in place. Compatibility requires
the newly shaped run to retain the same glyph count and use installed atlas
glyphs; otherwise the backend automatically uses the normal `replaceRun`
fallback. Runtime statistics report compatible run patches, patched glyph
slots, and fallbacks. Same-length ASCII digit substitutions additionally skip
general reshaping through a one-time per-size cache of digit glyphs, bearings,
and advances. Both tabular and proportional digits are supported; other text
keeps the full shaping path.

When the camera or viewport moves, the TextRenderer backend uses a marker-only
position batch. Projection reuses layer-owned scratch objects, Sprite2D receives
compact position/visibility writes, and immutable marker snapshots are created
only when `getAnnotationSnapshot()` is called. Definition, style, z-bucket,
animation, visibility, clamping, and occlusion changes automatically leave this
path and use the full update contract. Applications do not need to opt in.

The backend owns and disposes its renderer, text data, and shared glyph
storage. The supplied surface and font remain caller-owned. Canvas backing
dimensions may differ from CSS dimensions by a uniform scale (including DPR
1 and 2); non-uniform backing scales are rejected.

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
  occlusionBias: 0,
  style: { opacityTransitionDuration: 180 }
});
```

The adapter reads the scene render task's private live reverse-Z depth texture and evaluates all
opted-in anchors in one compute dispatch. Results arrive asynchronously, so
visibility normally trails the rendered scene by one or two frames. Manual
layers must receive another `updateAnnotationLayer()` call to consume a
completed result.

`occlusionBias` is measured in reverse-Z normalized depth, not world units.
Keep it small: perspective compression can make a valid wall/anchor separation
smaller than a large bias at distant or oblique camera angles.

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

Leader lines are optional and render when collision layout, clamping, or an
explicit `screenOffset` moves a label at least `minLength` from its projected
anchor. They connect the anchor to the nearest label edge, remain behind all
labels, and share the label's visibility and disposal lifecycle. This lets a
marker and offset label at the same anchor form a compound callout. Pass
`leaderLine: false` through `updateLabel()` to remove one. The collision stress
example leaves lines disabled so its timings measure layout rather than
hundreds of SVG elements.

## Next GPU additions

Sprite2D resources are batched by shared annotation `zIndex`. Each used value
creates one line layer and one marker layer; lower values draw first, with lines
behind markers inside the same bucket. Empty buckets are removed. Keep the
number of distinct values small because each visible layer is one draw call.
All Sprite2D buckets still render behind the later TextRenderer pass.

The manual label, marker, collision, cache-churn, and interaction benchmarks
are documented in [BENCHMARK.md](./BENCHMARK.md).

## Optional CPU interaction

Import interaction separately so applications that only render annotations do
not ship pointer management or the spatial index:

```ts
import {
  createAnnotationInteractionManager,
  registerInteractiveAnnotation,
  onAnnotationInteraction,
  disposeAnnotationInteractionManager
} from "@litools/annotator/interaction";

const interactions = createAnnotationInteractionManager({
  layer,
  canvas,
  cellSize: 64,
  hitSlop: 2
});
const target = registerInteractiveAnnotation(interactions, marker);
onAnnotationInteraction(target, "click", ({ annotation }) => {
  selectAnnotation(annotation);
});

disposeAnnotationInteractionManager(interactions);
```

Picking is synchronous CPU work in CSS-pixel space; it does not perform GPU
readback. Core publishes final projected, clamped, and collision-resolved bounds
directly to registered interaction managers without materializing every public
snapshot. The manager synchronizes its uniform spatial hash lazily: small
changes update only the affected targets' cells, while camera-wide or other
large changes use one full rebuild. Hidden, occluded-hidden, collision-hidden,
and disposed annotations are absent from the index.

Labels use their measured box. Dot/ring, diamond, and triangle markers receive
shape-aware tests; other built-in and custom markers use their rectangular
bounds. Higher logical `zIndex` wins and later annotation creation wins ties.
Mouse/pen hover keeps only the newest sample per animation frame. Clicks require
down and up on the same target within pointer-specific movement/time thresholds.
The entry also exposes global listeners, manual `pickInteractiveAnnotation()`,
target/manager enable controls, hover/pressed queries, and frozen spatial-index
diagnostics.

This is pointer interaction only. It adds no DOM accessibility, keyboard focus,
dragging, selection ownership, or automatic camera arbitration. The dedicated
GPU interaction demo includes the workload documented in
[BENCHMARK.md](./BENCHMARK.md).

The remaining useful GPU roadmap is marker presets and DynamicTexture icons.

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
| `0.1.x` | `^1.14.0` | `^0.6.0` (optional) |
