# @litools/instancer

Stable IDs, pooling, picking, visibility, metadata, and batch updates for Babylon Lite instances.

`@litools/instancer` helps Babylon Lite apps treat thin instances and hierarchy instances as app-level objects with stable numeric IDs. Use it when you need many repeated meshes, picking, hide/show, metadata, or fast transform updates without manually tracking thin instance slots.

## Install

```sh
npm install @litools/instancer @babylonjs/lite
```

## Which API Should I Use?

Use `createInstanceSet` for one mesh:

```ts
import { createInstanceSet } from "@litools/instancer";

const boxes = createInstanceSet(boxMesh, {
  capacity: 500,
  colors: true,
  visibleStrategy: "active-count"
});
```

Use `createHierarchyInstanceSet` for a loaded GLB or scene-node hierarchy:

```ts
import { createHierarchyInstanceSet } from "@litools/instancer";

const boomboxes = createHierarchyInstanceSet(rootNode, {
  capacity: 100,
  grow: "rebuild"
});
```

Use `createVatInstanceSet` for a single skinned mesh with Babylon Lite VAT animation:

```ts
import { createVatInstanceSet } from "@litools/instancer";

const sharks = createVatInstanceSet(engine, skinnedMesh, animationGroups, {
  capacity: 48
});
```

Use `PickingRegistry` for normal thin-instance picking. Use `pickScreenSpaceInstanceFromPointer` when the visible mesh is deformed or animated and GPU picking does not line up with the final visual position.

## Stable IDs

The package returns numeric `InstanceId` values. Slots may change after remove, hide/show, growth, or rebuild operations. Keep IDs in your app state, and ask the set for the current slot only when you need to talk to lower-level Babylon Lite APIs.

```ts
const id = boxes.create(
  { position: [0, 0, 0], scale: 1 },
  { team: "blue" }
);

boxes.setVisible(id, false);
boxes.setMetadata(id, { team: "red" });
```

## Iteration and Bulk Helpers

Use `ids`, `visibleIds`, `slots`, and `entries` when you want the set to be the source of truth for live IDs:

```ts
for (const id of boxes.visibleIds()) {
  updateLabel(id, boxes.getMetadata(id));
}

for (const { id, slot } of boxes.slots()) {
  syncExternalSlotData(id, slot);
}
```

Use `createMany`, `setTransforms`, `setMatrices`, `setVisibleMany`, and `removeMany` for common multi-instance operations:

```ts
const ids = boxes.createMany(points.map((position) => ({
  transform: { position, scale: 1 },
  metadata: { selected: false }
})));

boxes.setTransforms(ids.map((id, index) => ({
  id,
  transform: { position: nextPositions[index] }
})));

boxes.setVisibleMany(ids, false);
```

For stale IDs from UI or network state, use non-throwing helpers such as `trySetTransform`, `trySetVisible`, `trySetMetadata`, `getMatrixOrUndefined`, and `getVisibleOrUndefined`.

## Transform Helpers

Use position and scale helpers when you do not need to build a full matrix yourself:

```ts
boxes.setPosition(id, [2, 0, 1]);
boxes.translate(id, [0, 1, 0]);
boxes.setScale(id, 1.5);

const position = boxes.getPosition(id);
```

## Visibility

`"active-count"` keeps visible instances packed at the front of the buffer. It is fast for rendering, but hiding/showing/removing instances can swap slots.

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
import { belongsToHierarchyRoot, createPickingRegistry } from "@litools/instancer";

const registry = createPickingRegistry();
registry.register(boxMesh, boxes);

const picked = registry.fromPick(scenePick);
```

For GLB hierarchies, first check that the picked child mesh belongs to the loaded root, then resolve the final app-level ID:

```ts
if (belongsToHierarchyRoot(scenePick.pickedMesh, glbRoot)) {
  selectNearestLogicalInstance(scenePick.pickedPoint);
}
```

Hierarchy picking often needs this two-step approach. A loaded GLB has a source/prototype tree plus a hierarchy instance pool, and the GPU picker may report a child mesh, prototype hit, or slot that is not the final app object the user expects. Treat `belongsToHierarchyRoot` as a filter/diagnostic, then resolve the final `InstanceId` with the picked world point, nearest logical center, or screen-space logical picking.

For VAT, skinned, or otherwise deformed visuals, pick by projected logical centers:

```ts
import { pickScreenSpaceInstanceFromPointer } from "@litools/instancer";

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

Then open the root examples page. Useful demos:

- Basic Thin Instances: stable IDs, transforms, colors, removal, and adding new instances.
- Primitive Box Field: many boxes, colors, batch transforms, and selection.
- Primitive Mixed Playground: boxes, spheres, and cylinders managed by separate sets with shared picking.
- BoomBox Picker: GLB hierarchy picking and stable ID deletion after slot swaps.
- BoomBox Grid: GLB hierarchy instance grid with picking and removal.
- Shark School Shared Animation: synchronized VAT animation.
- Shark Phase Buckets: per-instance VAT phase/fps variation.
- Shark Clip Mixer: per-instance VAT clip assignment.

See `About_Examples.md` for a fuller explanation of every runnable example, and `About_Examples_Extended.md` for important code snippets from each one.

## Docs

The longer guide lives in `docs/README.md`.

For a practical usage walkthrough, see `User_Guide.md`.

For release notes, see `CHANGELOG.md`.

For architecture and internal concepts, see `How_It_Works.md`.

Generate TypeDoc API reference:

```sh
npm run docs
```

TypeDoc writes generated HTML to `docs/api`.
