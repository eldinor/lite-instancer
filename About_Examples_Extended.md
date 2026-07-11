# About Examples Extended

This document explains how each example uses the public `@litools/instancer` API. Each section highlights the API calls worth copying, then explains when that pattern is useful in an app.

Run all examples from one dev server:

```sh
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Shared Setup

Most examples start with the shared helper:

```ts
const ctx = await createExample("Example Name");
const mesh = addMesh(ctx.scene, createBox(ctx.engine, 0.86), [0.7, 0.76, 0.84]);
```

`ctx` is just a convenient bundle of everything each demo needs, so every example does not repeat engine/scene/panel/picking setup.
`createExample` creates the canvas, engine, scene, camera, GPU picker, debug panel, and `PickingRegistry`. `runExample(ctx)` registers the scene, attaches the Lite Explorer button, and starts the engine.

Picking for ordinary thin instances is also centralized:

```ts
const picked = await pickInstance(ctx, event);
```

That helper runs Babylon Lite GPU picking and asks `PickingRegistry` to convert `mesh + thinInstanceIndex` back into an app-level `InstanceId`.

## Basic Thin Instances

API setup:

```ts
const tiles = createInstanceSet<TileMeta>(mesh, {
  capacity: 64,
  colors: true,
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "active-count",
});

ctx.registry.register(mesh, tiles);
```

The example shows the default API model: one mesh, one `InstanceSet`, stable numeric IDs, and a registry for picking.

Metadata pattern:

```ts
const id = tiles.create(makeMatrix(gridX(col), 0, gridZ(row), 1), {
  label: `tile-${index}`,
  row,
  col,
  phase,
  selected: false,
});
```

The ID is the permanent app handle. The slot can move, but metadata stays attached to the ID.

The frame update uses `batch`:

```ts
tiles.batch((writer) => {
  for (const id of ids) {
    const meta = tiles.getMetadata(id);
    if (!meta) continue;
    writer.setTransform(id, makeMatrix(x, y, z, scale, yaw));
  }
});
```

This demonstrates the normal high-level update path: many ID-based updates, one flush.

## Primitive Box Field

API setup:

```ts
const boxes = createInstanceSet<BoxMeta>(mesh, {
  capacity: 900,
  colors: true,
  engine: ctx.engine,
  gpuCulling: true,
});
```

This is a high-count primitive example. It creates a dense grid and stores each box's row, column, and pinned state:

```ts
const id = boxes.create(makeMatrix(x, 0, z, 0.65), {
  row,
  col,
  pinned: false,
});
```

The key interaction is picking and toggling metadata:

```ts
const picked = await pickInstance(ctx, event);
selected = picked.id;

const meta = boxes.getMetadata(selected);
if (meta) {
  meta.pinned = !meta.pinned;
  boxes.setMetadata(selected, meta);
}
```

Pinned boxes stop moving in the render loop. This shows how metadata can drive behavior without external lookup tables.

## Primitive Sphere Cloud

API setup:

```ts
const spheres = createInstanceSet<SphereMeta>(mesh, {
  capacity: 360,
  colors: true,
  engine: ctx.engine,
  visibleStrategy: "active-count",
});
```

Each sphere receives metadata that defines its behavior:

```ts
const id = spheres.create(makeMatrix(radius, 0, 0, scale), {
  group,
  radius,
  speed,
  mass,
  phase,
});
```

Group visibility is handled by IDs, not slots:

```ts
spheres.batch((writer) => {
  for (const id of ids) {
    if (spheres.getMetadata(id)?.group === group) {
      writer.setVisible(id, next);
    }
  }
});
```

This is the pattern to use when your app wants semantic groups like teams, layers, or categories.

## Primitive Mixed Playground

API setup:

```ts
let strategy: VisibilityStrategy = initialStrategy === "scale-zero" ? "scale-zero" : "active-count";

const layers = [
  {
    kind: "box",
    set: createInstanceSet(boxMesh, { capacity: 32, colors: true, engine: ctx.engine, visibleStrategy: strategy }),
    ids: [],
  },
  {
    kind: "sphere",
    set: createInstanceSet(sphereMesh, { capacity: 48, colors: true, engine: ctx.engine, visibleStrategy: strategy }),
    ids: [],
  },
];
```

The example has several independent `InstanceSet`s at once. The registry maps each pickable mesh to the set that owns its IDs:

```ts
ctx.registry.register(boxMesh, boxes).register(sphereMesh, spheres).register(cylinderMesh, cylinders);
```

Picking finds the owning layer:

```ts
const picked = await pickInstance(ctx, event);
const layer = layers.find((item) => item.set === picked.set);
```

Color metadata pattern:

```ts
layer.set.setMetadata(id, { ...meta, colorSeed });
layer.set.setColor(id, colorFromIndex(colorSeed));
```

This keeps recoloring stable even when visibility or removal causes slot swaps.

## Visibility Layers

Visibility strategy setup:

```ts
const initialStrategy = new URLSearchParams(window.location.search).get("strategy");
let strategy: VisibilityStrategy = initialStrategy === "scale-zero" ? "scale-zero" : "active-count";
```

The example rebuilds its sets with the selected strategy:

```ts
const boxes = createInstanceSet(boxMesh, {
  capacity: 120,
  colors: true,
  engine: ctx.engine,
  visibleStrategy: strategyToUse,
});
```

The switch button reloads the page with the other strategy:

```ts
ctx.panel.button("switch strategy", () => {
  const next = strategy === "active-count" ? "scale-zero" : "active-count";
  window.location.search = `?strategy=${next}`;
});
```

This example exists to show the tradeoff:

- `active-count` renders only visible packed instances, but slots move.
- `scale-zero` keeps slot positions more stable, but hidden instances still occupy draw slots.

## Raw Batch Streaming

Normal batch path:

```ts
instances.batch((writer) => {
  ids.forEach((id, index) => {
    if (!instances.getVisible(id)) return;
    writer.setTransform(id, makeMatrix(x, y, z, 0.45, time));
  });
});
```

Raw path:

```ts
instances.editRaw((raw) => {
  ids.forEach((id, index) => {
    const slot = raw.getSlot(id);
    if (slot === undefined) return;

    raw.writeMatrix(id, matrix);
    raw.markMatrixDirty(slot);
  });
});
```

`editRaw` is for advanced update loops that need direct buffer-style access. The example still resolves slots from stable IDs so it remains safe after visibility changes.

## BoomBox Grid

GLB loading setup:

```ts
const container = await loadGltf(ctx.engine, BOOMBOX_URL);
addToScene(ctx.scene, container);

const root = container.entities[0];
const sourceMeshes = collectMeshes(root);
const sourceRootMatrix = new Float32Array(root.worldMatrix) as Mat4;
```

Hierarchy instance set:

```ts
const boomboxes = createHierarchyInstanceSet<BoomBoxMeta>(root, {
  capacity: 96,
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "scale-zero",
});
```

Matrix pattern:

```ts
function makeBoomBoxMatrix(x: number, y: number, z: number, scale: number, yaw: number): Mat4 {
  return multiplyMat4(composeMat4(makeMatrix(x, y, z, scale, yaw)), sourceRootMatrix);
}
```

The example picks by world point and resolves to the nearest logical BoomBox:

```ts
return findNearestVisibleBoomBox(pick.pickedPoint[0], pick.pickedPoint[2]);
```

This is often more reliable for hierarchy assets than selecting only from the thin-instance index reported by a child mesh hit.

## BoomBox Picker

This example focuses on the API flow for hierarchy picking.

First it verifies that the picked mesh belongs to the loaded GLB root:

```ts
const belongsToRoot = belongsToHierarchyRoot(pickedMesh, hierarchyRoot);
if (!pick.hit || !pick.pickedPoint || !belongsToRoot) {
  return undefined;
}
```

Then it records what the registry says:

```ts
const registryPick = ctx.registry.fromPick({
  mesh: pickedMesh,
  thinInstanceIndex: pick.thinInstanceIndex,
  hasThinInstance: pick.thinInstanceIndex >= 0,
});
```

Finally it selects the logical object by picked world point:

```ts
const logicalId = findNearestVisibleBoomBox(pick.pickedPoint[0], pick.pickedPoint[2]);
```

The example shows that hierarchy picking can need both a root check and an app-level ID resolution step.

## BoomBox Rebuild Growth

API setup:

```ts
const boomboxes = createHierarchyInstanceSet<BoomBoxMeta>(root, {
  capacity: 4,
  grow: "rebuild",
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "active-count",
});
```

The small initial capacity forces growth. After growth, the example re-registers the rebuilt pool meshes:

```ts
function syncPoolRegistration(): void {
  if (boomboxes.capacity === previousCapacity) return;
  previousCapacity = boomboxes.capacity;
  rebuildCount++;
  registerPoolMeshes();
}
```

The picking strategy is hybrid:

```ts
if (pick.hit && pick.pickedPoint) {
  const pickedByPoint = findNearestBoomBox(x, y, z);
  if (pickedByPoint) return pickedByPoint.id;
}

return pickBoomBoxByScreen(event);
```

The screen fallback uses projected logical centers:

```ts
pickScreenSpaceInstanceFromPointer({
  event,
  canvas: ctx.canvas,
  camera,
  ids,
  has: (id) => boomboxes.has(id),
  isVisible: (id) => boomboxes.getVisible(id),
  getWorldPosition: getCurrentLogicalPosition,
});
```

This demonstrates how to keep picking useful after hierarchy pool rebuilds.

## Shark School Shared Animation

VAT setup:

```ts
const vatSet = createVatInstanceSet<SharkMeta>(ctx.engine, skinnedMeshes[0], animationGroups, {
  capacity: 48,
  engine: ctx.engine,
  visibleStrategy: "scale-zero",
});
```

The app uses the VAT-backed `InstanceSet` when possible:

```ts
const sharks = vatInstanceMesh ? vatSet.set : createHierarchyInstanceSet(root, fallbackOptions);
```

Animation advances once per frame:

```ts
if (!paused) {
  time += deltaMs * 0.001;
  vatSet?.update(deltaMs * 0.001);
}
```

Picking uses screen-space logical centers because animated vertices can be visually displaced from rest geometry:

```ts
pickScreenSpaceInstanceFromPointer({
  event,
  canvas: ctx.canvas,
  camera,
  ids,
  getWorldPosition: (id) => [movement.x, movement.y, movement.z],
  getScreenRadius: (id) => Math.max(24, 44 * meta.scale),
});
```

## Shark Phase Buckets

This example adds per-instance animation phase and fps variation.

The key function is:

```ts
function applyVatPhaseBuckets(): void {
  const clip = vatSet.getActiveClip();
  const durationSeconds = clip.frameCount / clip.fps;

  for (let index = 0; index < ids.length; index++) {
    const phase = fractional(index * 0.61803398875 + phaseSeed * 0.31);
    vatSet.setPhaseOffset(id, phase * durationSeconds);
    vatSet.setFps(id, clip.fps * speedFactor);
  }
}
```

The API idea: one baked animation clip can look less synchronized when each instance uses a different time offset and fps.

## Shark Clip Mixer

This is the most complete VAT example. It gives each instance a clip name in metadata:

```ts
const meta = {
  label: `shark-${index}`,
  lane,
  clip,
  baseX,
  baseZ,
  speed,
  phase,
  depth,
  scale,
};
```

Creation passes the clip into `vatSet.create`:

```ts
const id = vatSet.create({
  transform,
  metadata: meta,
  clip,
});
```

Changing one instance's clip updates both app metadata and VAT playback:

```ts
function setSharkClip(id: InstanceId, clip: string): void {
  const meta = sharks.getMetadata(id);
  if (!meta) return;

  meta.clip = clip;
  vatSet?.setClip(id, clip);
}
```

Changing a lane applies the same clip to many IDs:

```ts
for (const id of ids) {
  const item = sharks.getMetadata(id);
  if (item?.lane === meta.lane) {
    setSharkClip(id, nextClip);
  }
}
```

This example combines stable IDs, metadata, per-instance animation clips, phase offsets, fps variation, visibility, and screen-space picking.

## What To Copy First

For a normal app with one repeated mesh, start from `Basic Thin Instances`.

For several primitive types in one scene, copy the multi-set pattern from `Primitive Mixed Playground`.

For loaded GLB hierarchies, copy the setup from `BoomBox Grid`, then copy the picking flow from `BoomBox Picker`.

For animated skinned GLB instances, copy the VAT setup from `Shark School Shared Animation`, then add phase or clip control from the two later shark examples.
