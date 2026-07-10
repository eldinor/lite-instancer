# @litools/instancer Documentation

`@litools/instancer` helps Babylon Lite apps treat thin instances and hierarchy instances as app-level objects with stable numeric IDs.

Use it when you need to create many repeated meshes, pick them, hide/show them, attach metadata, or update transforms in batches without manually tracking thin instance slots.

## Which API Should I Use?

Use `createInstanceSet` for one mesh:

```ts
const boxes = createInstanceSet(boxMesh, {
  capacity: 500,
  colors: true,
  visibleStrategy: "active-count"
});
```

Use `createHierarchyInstanceSet` for a loaded GLB hierarchy:

```ts
const boomboxes = createHierarchyInstanceSet(rootNode, {
  capacity: 100,
  grow: "rebuild"
});
```

Use `createVatInstanceSet` for a single skinned mesh with Babylon Lite VAT animation:

```ts
const sharks = createVatInstanceSet(engine, skinnedMesh, animationGroups, {
  capacity: 48
});
```

Use `PickingRegistry` for normal thin-instance picking, and `pickScreenSpaceInstanceFromPointer` when the visible mesh is deformed or animated and GPU picking does not line up with the final visual position.

For a practical walkthrough of the main functions and helpers, see `../User_Guide.md`.

## Stable IDs

The package returns numeric `InstanceId` values. Slots may change after remove, hide/show, growth, or rebuild operations. Keep IDs in your app state, and ask the set for the current slot only when you need to talk to lower-level Babylon Lite APIs.

```ts
const id = boxes.create({ position: [0, 0, 0] }, { team: "blue" });

boxes.setVisible(id, false);
boxes.setMetadata(id, { team: "red" });
```

## Iteration and Bulk Helpers

Use `ids`, `visibleIds`, `slots`, and `entries` to inspect live IDs in current slot order without keeping a duplicate ID array.

```ts
for (const id of boxes.visibleIds()) {
  updateOverlay(id, boxes.getMetadata(id));
}
```

Use `createMany`, `setTransforms`, `setMatrices`, `setVisibleMany`, and `removeMany` for common multi-instance work.

```ts
const ids = boxes.createMany(spawns.map((spawn) => ({
  transform: spawn.transform,
  metadata: spawn.data
})));

boxes.setVisibleMany(ids, false);
```

When an ID may be stale, use `trySetTransform`, `trySetVisible`, `trySetMetadata`, `getMatrixOrUndefined`, or `getVisibleOrUndefined`.

## Transform Helpers

Use `getPosition`, `setPosition`, `translate`, and `setScale` for common transform edits that do not need a full matrix.

```ts
boxes.setPosition(id, [2, 0, 1]);
boxes.translate(id, [0, 1, 0]);
boxes.setScale(id, [1, 2, 1]);
```

## Visibility Strategies

`"active-count"` keeps visible instances packed at the front of the buffer. It is fast for rendering, but hiding/showing instances can swap slots.

`"scale-zero"` keeps slots more stable by writing a zero-scale matrix for hidden instances. It is useful when another slot-indexed system must stay aligned, such as VAT playback parameters.

## Batch Updates

Use `batch` for ordinary app updates. The package flushes once after the callback.

```ts
boxes.batch((writer) => {
  for (const id of ids) {
    writer.setTransform(id, nextTransform(id));
  }
});
```

Use `editRaw` only when you need direct access to the matrix/color arrays. When writing raw data, mark dirty slots yourself.

## Picking

For rigid meshes, register the mesh and map Babylon Lite picks back to stable IDs:

```ts
const registry = createPickingRegistry();
registry.register(boxMesh, boxes);

const picked = registry.fromPick(scenePick);
```

For GLB hierarchies, use `belongsToHierarchyRoot(pickedMesh, root)` as a first filter. It confirms the picked child mesh belongs to the loaded asset before you resolve the final logical `InstanceId`.

```ts
if (belongsToHierarchyRoot(scenePick.pickedMesh, glbRoot)) {
  selectNearestLogicalInstance(scenePick.pickedPoint);
}
```

Hierarchy picking often needs this two-step approach. A loaded GLB has a source/prototype tree plus a hierarchy instance pool, and the GPU picker may report a child mesh, prototype hit, or slot that is not the final app object the user expects. Treat `belongsToHierarchyRoot` as a filter/diagnostic, then resolve the final `InstanceId` with the picked world point, nearest logical center, or screen-space logical picking.

For VAT, skinned, or otherwise deformed visuals, pick by projected logical centers:

```ts
const picked = pickScreenSpaceInstanceFromPointer({
  event,
  canvas,
  camera,
  ids,
  has: (id) => sharks.set.has(id),
  isVisible: (id) => sharks.set.getVisible(id),
  getWorldPosition: (id) => getCurrentCenter(id),
  getScreenRadius: () => 32
});
```

## VAT Animation

`createVatInstanceSet` bakes Babylon Lite animation groups into a VAT-backed instance set. It defaults to `gpuCulling: false` and `visibleStrategy: "scale-zero"` because animated vertices can move outside rest bounds and playback parameters are slot-based.

Use `play(clip)` to change the shared default clip. Use `setClip(id, clip)`, `setPhaseOffset(id, seconds)`, and `setFps(id, fps)` for per-instance variation.

```ts
const id = sharks.create({
  transform: { position: [0, 0, 0], scale: 1 },
  metadata: { label: "shark-0" },
  clip: "Swim",
  offset: 0.4
});

sharks.setClip(id, "Turn");
sharks.setPhaseOffset(id, 1.2);
sharks.update(deltaSeconds);
```

## Examples

Run one dev server:

```sh
npm run dev
```

Then open the root examples page. The most useful demos are:

- Primitive Box Field: basic IDs, colors, transforms, and selection.
- Primitive Mixed Playground: boxes, spheres, and cylinders managed by separate sets with shared picking.
- BoomBox Grid: GLB hierarchy instancing with picking and removal.
- Shark School Shared Animation: synchronized VAT animation.
- Shark Phase Buckets: per-instance VAT phase/fps variation.
- Shark Clip Mixer: per-instance VAT clip assignment.

## API Reference

Run:

```sh
npm run docs
```

TypeDoc writes the generated reference to `docs/api`.
