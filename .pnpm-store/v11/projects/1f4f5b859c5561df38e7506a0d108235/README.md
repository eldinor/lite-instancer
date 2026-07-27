# @litools/annotator

Spatial HTML annotations and optional GPU text labels for Babylon Lite meshes
and stable `@litools/instancer` IDs.

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
and React bindings are intentionally deferred.

## Examples

Browse the
[example source](https://github.com/eldinor/lite-instancer/tree/main/packages/annotator/examples)
or run the multi-page gallery from the repository root:

```sh
npm run dev:annotator
```

The unified gallery groups eight HTML-overlay and eight GPU TextRenderer demos.
Every live page has breadcrumbs, previous/next controls, and an all-demos
drawer, so the complete learning path stays reachable without returning to the
catalog. It covers mesh labels, markers, live text, stable Instancer anchors,
lifecycle, collisions, depth occlusion, GPU shaping, Sprite2D leader lines,
manual JSON benchmarks, and selectable 100/250/500-label stress loads.

The collision stress scene exercises selectable 100, 250, and 500-label loads
with moving anchors, changing text widths, and clamped edge labels. Its timing
panel reports the latest update, arithmetic mean, and p95. A p95 of `7.6 ms`
means 95% of sampled annotation updates completed in `7.6 ms` or less.

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
buckets/draw calls, and Sprite2D counts.

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
explicit three-sprite option. Label background color, border color/width/radius,
and padding use nine reusable atlas patches per card and one background draw
call per visible z bucket. Font weight, CSS classes, opacity transitions, and
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

Markers can pulse through Lite's public Sprite FX clock without per-frame API
calls:

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
than marker geometry.

Unchanged markers reuse their latest projection and skip backend sprite writes
when the camera, viewport, resolved anchor, visibility, definition, and
occlusion inputs are stable. GPU pulse keeps running independently during this
CPU fast path. Camera/target movement or any relevant marker mutation restores
the full update automatically. Labels are intentionally excluded because
measurement and collision layout can depend on other labels each frame.

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

The manually started marker benchmark offers a quick one-round check and a
thorough three-round run. Both cover ten cases spanning
100–10,000 markers, one versus four z buckets, CPU pulse updates, GPU Sprite FX
pulse, visibility churn, and forced camera movement. Static and GPU-pulse cases
exercise cached projection; the orbit case measures full reprojection plus the
TextRenderer position batch.

The version 3 JSON report separates application mutation from
`updateAnnotationLayer()`, retains their combined CPU cost, and adds first-frame
and preparation timing, frame cadence and dropped-frame counts, whole-frame GPU
timestamps when Lite/device support is available, fast-path backend deltas,
draw calls, environment information, and sampled correctness checks. The
thorough profile uses 15 settling frames, 30 excluded warm-up frames, and three
180-frame measured rounds, reporting the median of round summaries.

One version 2 reference run with Chrome 150 on Windows, DPR 1, and a 1669 x 953 canvas
measured 10,000 camera-orbit markers at 2.72 ms mean / 3.0 ms p95, down from
7.85 ms / 8.6 ms before batching (about 65% lower). Static and GPU-pulse cases
were about 0.40 ms. These are CPU annotation-update measurements from one
machine. Version 3 reports CPU annotation work and whole-frame GPU timing as
separate scopes; use the bundled benchmark on target hardware for capacity
decisions.

A newer version 3 thorough run with Chrome 150 on Windows, DPR 1, and a
1920 x 953 canvas measured the following 10,000-marker median results. CPU
values are combined application mutation plus Annotator update; GPU values are
asynchronous whole-frame Lite timestamps:

| Workload | CPU mean / p95 | GPU mean / p95 | Result |
| --- | ---: | ---: | --- |
| Static, one bucket | 0.39 / 0.50 ms | 0.33 / 0.87 ms | No backend writes |
| GPU pulse | 0.37 / 0.60 ms | 0.34 / 0.90 ms | No per-frame marker writes |
| Visibility churn | 2.03 / 2.30 ms | 0.76 / 0.90 ms | 1,250 hide + 1,250 show writes/frame |
| Camera orbit | 2.94 / 3.60 ms | 0.28 / 0.87 ms | About 10,000 batched positions/frame |
| CPU pulse | 18.01 / 21.00 ms | 1.86 / 3.35 ms | Still exceeds 16.7 ms; use GPU pulse |

Stable-workload correctness checksums matched across rounds; camera-orbit
checksums changed with the camera while all 32 sampled markers remained
rendered. This run exposed 14.7–41.9 ms first-frame costs among the 10,000-marker
cases when thousands of definitions, z buckets, or animation-layer assignments
changed together. Treat those as configuration work: prepare large sets before
they become visible or spread application updates across frames. GPU p95 values
vary more than CPU medians because asynchronous whole-frame timestamps include
periodic renderer/device work; compare several runs before treating them as a
regression.
Version 2 and version 3 CPU results are not directly interchangeable because
version 3 uses longer rounds, separated timers, GPU timing, and later camera
positions.

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
GPU interaction demo includes a manual 100/1,000/10,000-target benchmark with
an excluded warm-up, three measured rounds, viewport-wide and center-dense
query workloads, median throughput, and separate camera-wide and one-percent
partial-movement index timings. It finishes with a 32/64/128 CSS-pixel cell-size
sweep at 10,000 markers.

One Chrome 150/Windows/DPR 1 interaction run produced these median results:

| Targets | Viewport queries/s | Center-dense queries/s | Full camera index | 1% incremental index |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 3.03 million | 3.77 million | 0.20 ms | 0.20 ms / 1 target |
| 1,000 | 3.08 million | 1.67 million | 0.60 ms | 0.10 ms / 10 targets |
| 10,000 | 568,000 | 168,000 | 6.00 ms | 0.20 ms / 100 targets |

At 10,000 markers, 32 px cells reached about 338,000 center-dense queries/s
with 49 average candidates, versus 179,000 and 136 candidates at 64 px, or
84,000 and 419 candidates at 128 px. The 32 px index used 426 cells and took
6.1 ms to build; 64 px used 119 cells and took 5.0 ms. Keep the balanced 64 px
default for moving scenes. Prefer 32 px for a mostly static, densely interactive
view with unusually frequent picks. Large 128 px cells trade a small build-time
saving for substantially slower dense queries.

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
