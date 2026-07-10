# User Guide

This guide explains how to use the main `@litools/instancer` APIs in an app. The library is built around one idea: your app keeps stable `InstanceId` values, while the library manages the lower-level Babylon Lite slots that may move over time.

## Choosing the Right API

| Need | Use |
| --- | --- |
| Repeat one mesh many times | `createInstanceSet` |
| Repeat a loaded GLB or scene-node tree | `createHierarchyInstanceSet` |
| Repeat one skinned mesh with VAT animation | `createVatInstanceSet` |
| Resolve rigid thin-instance picks | `createPickingRegistry` |
| Pick animated or deformed visuals by logical centers | `pickScreenSpaceInstanceFromPointer` |

## Stable IDs and Slots

Every created instance gets an `InstanceId`.

```ts
const id = boxes.create(
  { position: [0, 0, 0], scale: 1 },
  { label: "box-0" }
);
```

Keep the ID in app state. Do not store the backing slot as permanent state. Slots can change after removal, visibility changes, growth, or hierarchy rebuilds.

When you need the current slot, ask the set:

```ts
const slot = boxes.getSlot(id);
```

When you receive a slot from a picker or another slot-indexed system, map it back to the stable ID:

```ts
const id = boxes.getIdForSlot(slot);
```

## Creating Single-Mesh Instances

Use `createInstanceSet` when one mesh should be drawn many times.

```ts
import { createInstanceSet } from "@litools/instancer";

const boxes = createInstanceSet<{ team: string }>(boxMesh, {
  capacity: 500,
  colors: true,
  visibleStrategy: "active-count"
});

const id = boxes.create(
  {
    position: [1, 0, 2],
    rotationEuler: [0, Math.PI / 4, 0],
    scale: 1.5
  },
  { team: "blue" }
);
```

The transform can be either a matrix or a small transform object:

```ts
boxes.setTransform(id, {
  position: [2, 0, 0],
  rotationQuaternion: [0, 0, 0, 1],
  scale: [1, 2, 1]
});
```

Use `setMatrix` when you already have a Babylon Lite `Mat4`:

```ts
boxes.setMatrix(id, matrix);
```

## Transform Convenience Helpers

Use position and scale helpers for common object-level edits.

Read an instance position:

```ts
const position = boxes.getPosition(id);
```

Write only the translation component:

```ts
boxes.setPosition(id, [2, 0, 1]);
```

Move relative to the current position:

```ts
boxes.translate(id, [0, 1, 0]);
```

Replace the matrix scale while keeping the current translation and basis orientation:

```ts
boxes.setScale(id, 1.5);
boxes.setScale(id, [1, 2, 1]);
```

When an ID may be stale, use the non-throwing variants:

```ts
boxes.trySetPosition(idFromUi, [0, 0, 0]);
boxes.tryTranslate(idFromUi, [0, 0.2, 0]);
boxes.trySetScale(idFromUi, 1);

const position = boxes.getPositionOrUndefined(idFromUi);
```

These helpers are available on single-mesh sets, hierarchy sets, and VAT sets:

```ts
sharks.translate(id, [0, 0, 1]);
```

## Creating Hierarchy Instances

Use `createHierarchyInstanceSet` when a whole scene-node tree should behave as one logical object. This is usually the right choice for loaded GLB assets.

```ts
import { createHierarchyInstanceSet } from "@litools/instancer";

const boomboxes = createHierarchyInstanceSet(rootNode, {
  capacity: 100,
  grow: "rebuild",
  visibleStrategy: "active-count"
});

const id = boomboxes.create(
  { position: [0, 0, 0], scale: 0.5 },
  { label: "boombox-0" }
);
```

The app-level API is intentionally similar to `InstanceSet`: IDs, slots, visibility, metadata, batching, and bulk helpers work the same way.

## Creating Many Instances

Use `createMany` when you already have a list of spawn data.

```ts
const ids = boxes.createMany(
  points.map((position, index) => ({
    transform: { position, scale: 1 },
    metadata: { label: `box-${index}` }
  }))
);
```

The returned IDs match input order.

## Iterating Instances

The set can be the source of truth for live IDs.

Use `ids` for all live IDs:

```ts
for (const id of boxes.ids()) {
  updateLogic(id);
}
```

Use `visibleIds` when hidden IDs should be skipped:

```ts
for (const id of boxes.visibleIds()) {
  drawOverlay(id);
}
```

Use `slots` when you need current slot mapping:

```ts
for (const { id, slot } of boxes.slots()) {
  syncSlotIndexedData(id, slot);
}
```

Use `entries` when metadata is part of the workflow:

```ts
for (const { id, metadata } of boxes.entries()) {
  if (metadata?.team === "blue") {
    boxes.setVisible(id, true);
  }
}
```

Use `forEach` for callback-style loops:

```ts
boxes.forEach((id, slot) => {
  console.log(Number(id), slot);
});
```

## Visibility Strategies

`"active-count"` keeps visible instances packed at the front of the backing buffer. This is efficient for rendering, but hiding, showing, and removing instances can swap slots.

```ts
const boxes = createInstanceSet(mesh, {
  visibleStrategy: "active-count"
});
```

`"scale-zero"` keeps IDs in the drawn range and hides instances by writing a zero-scale matrix. This keeps slot-indexed systems more stable, which is useful for VAT playback parameters and some external buffers.

```ts
const sharks = createInstanceSet(mesh, {
  visibleStrategy: "scale-zero"
});
```

Use `setVisible` for one ID:

```ts
boxes.setVisible(id, false);
```

Use `setVisibleMany` for many IDs:

```ts
boxes.setVisibleMany(selectedIds, false);
```

## Metadata

Metadata lets your app attach domain state to an ID.

```ts
const id = boxes.create({ position: [0, 0, 0] }, {
  team: "blue",
  selected: false
});

boxes.setMetadata(id, {
  team: "red",
  selected: true
});

const metadata = boxes.getMetadata(id);
boxes.deleteMetadata(id);
```

Metadata is not uploaded to the GPU. It is app-side state associated with the stable ID.

Use `findByMetadata` when you need the first matching ID:

```ts
const selected = boxes.findByMetadata((metadata) => metadata.selected);
```

Use `filterByMetadata` when you need every matching ID:

```ts
const blueTeam = boxes.filterByMetadata((metadata) => metadata.team === "blue");
boxes.setVisibleMany(blueTeam, true);
```

The predicate receives metadata, ID, and current slot:

```ts
const frontSlotBlue = boxes.findByMetadata(
  (metadata, id, slot) => metadata.team === "blue" && slot < boxes.visibleCount
);
```

Use `updateMetadata` for small reducer-style edits:

```ts
boxes.updateMetadata(id, (metadata) =>
  metadata ? { ...metadata, selected: !metadata.selected } : metadata
);
```

Return `undefined` from `updateMetadata` to delete metadata for that ID:

```ts
boxes.updateMetadata(id, () => undefined);
```

Use `tryUpdateMetadata` when the ID may be stale:

```ts
boxes.tryUpdateMetadata(idFromUi, (metadata) =>
  metadata ? { ...metadata, selected: false } : metadata
);
```

## Bulk Updates

Use `setTransforms` when many logical transforms change together.

```ts
boxes.setTransforms(ids.map((id, index) => ({
  id,
  transform: {
    position: nextPositions[index],
    scale: 1
  }
})));
```

Use `setMatrices` when your app already computes matrices:

```ts
boxes.setMatrices(ids.map((id, index) => ({
  id,
  matrix: matrices[index]
})));
```

Use `removeMany` when deleting a group:

```ts
const removedCount = boxes.removeMany(selectedIds);
```

## Batching

Use `batch` when you need a custom multi-step update. It flushes once after the callback.

```ts
boxes.batch((writer) => {
  for (const id of boxes.ids()) {
    writer.setTransform(id, nextTransform(id));
    writer.setMetadata(id, nextMetadata(id));
  }
});
```

For colored sets, the batch writer also exposes `setColor`.

```ts
boxes.batch((writer) => {
  writer.setColor?.(id, [1, 0, 0, 1]);
});
```

## Non-Throwing Helpers

Most direct setters throw when the ID is unknown. This is useful during development because stale IDs surface quickly.

When an ID may be stale, use the `try*` or `*OrUndefined` helpers.

```ts
if (!boxes.trySetTransform(idFromUi, { position: [0, 0, 0] })) {
  clearUiSelection(idFromUi);
}

const matrix = boxes.getMatrixOrUndefined(idFromNetwork);
const visible = boxes.getVisibleOrUndefined(idFromNetwork);
```

Available helpers:

- `trySetMatrix`
- `trySetTransform`
- `trySetPosition`
- `tryTranslate`
- `trySetScale`
- `trySetVisible`
- `trySetMetadata`
- `getMatrixOrUndefined`
- `getPositionOrUndefined`
- `getVisibleOrUndefined`

## Raw Editing

Use `editRaw` only for high-throughput paths where direct buffer access matters.

```ts
boxes.editRaw((raw) => {
  for (const id of boxes.ids()) {
    const slot = raw.getSlot(id);
    if (slot === undefined) {
      continue;
    }

    raw.matrices[slot * 16 + 12] += 0.1;
    raw.markMatrixDirty(slot);
  }
});
```

When writing raw matrix or color data yourself, mark the affected slot dirty. If you do not need direct buffers, prefer `batch`, `setTransforms`, or `setMatrices`.

## Colors

Pass `colors: true` to allocate the color buffer at creation time, or call `setColor` later to allocate it lazily.

```ts
const boxes = createInstanceSet(mesh, {
  capacity: 100,
  colors: true
});

boxes.setColor(id, [0.2, 0.6, 1, 1]);

const color = boxes.getColor(id);
```

`getColor` returns white when no color buffer exists.

## Picking Rigid Instances

Use `createPickingRegistry` for normal thin-instance picks.

```ts
import { createPickingRegistry } from "@litools/instancer";

const registry = createPickingRegistry();
registry.register(boxMesh, boxes);

const picked = registry.fromPick(scenePick);

if (picked) {
  select(picked.id);
}
```

For a hierarchy, register the meshes that can be returned by the picker:

```ts
registry.registerMany(childMeshes, boomboxes);
```

Use `belongsToHierarchyRoot` as a first filter when the picker returns child meshes from a loaded asset:

```ts
if (belongsToHierarchyRoot(scenePick.pickedMesh, glbRoot)) {
  selectNearestLogicalBoombox(scenePick.pickedPoint);
}
```

## Picking Animated or Deformed Instances

VAT and skinned meshes may not pick exactly where the final visual appears. In that case, pick projected logical centers.

```ts
const picked = pickScreenSpaceInstanceFromPointer({
  event,
  canvas,
  camera,
  ids: sharks.visibleIds(),
  has: (id) => sharks.has(id),
  isVisible: (id) => sharks.getVisible(id),
  getWorldPosition: (id) => sharkCenters.get(id),
  getScreenRadius: () => 32
});
```

This returns the nearest candidate inside its screen-space radius.

## VAT Animation

Use `createVatInstanceSet` for one skinned mesh with Babylon Lite animation groups.

```ts
import { createVatInstanceSet } from "@litools/instancer";

const sharks = createVatInstanceSet(engine, skinnedMesh, animationGroups, {
  capacity: 48,
  clip: "Swim"
});
```

Create animated instances:

```ts
const id = sharks.create({
  transform: { position: [0, 0, 0], scale: 1 },
  metadata: { label: "shark-0" },
  clip: "Swim",
  offset: 0.4,
  fps: 24
});
```

Use common instance helpers directly for transforms, visibility, metadata, colors, iteration, and bulk updates:

```ts
sharks.setTransform(id, { position: [1, 0, 0] });
sharks.setVisible(id, false);
sharks.setMetadata(id, { label: "hidden shark" });

for (const visibleId of sharks.visibleIds()) {
  updateSharkLabel(visibleId);
}
```

The underlying `sharks.set` is still exposed when an advanced integration specifically needs the `ColoredInstanceSet`.

Use the VAT wrapper for animation state:

```ts
sharks.play("Swim");
sharks.setClip(id, "Turn");
sharks.setPhaseOffset(id, 1.2);
sharks.setFps(id, 18);
sharks.update(deltaSeconds);
```

## Capacity and Growth

`capacity` controls initial allocation.

```ts
const boxes = createInstanceSet(mesh, {
  capacity: 1000,
  grow: "double"
});
```

Single-mesh sets support:

- `"double"`: grow by doubling when needed.
- `"exact"`: grow exactly to the required size.
- `"none"`: throw when capacity is exceeded.

Hierarchy sets support:

- `"none"`: fixed capacity for normal creation.
- `"rebuild"`: rebuild the hierarchy pool at a larger capacity when needed.

Use `reserve` when you know a larger capacity is coming:

```ts
boxes.reserve(5000);
```

## Disposal

Use `clear` to remove instances but keep allocated buffers:

```ts
boxes.clear();
```

Use `dispose` when the set is done and backing instance data should be detached:

```ts
boxes.dispose();
```

## Recommended Patterns

Keep `InstanceId` values in app state, and ask for slots only at the boundary where you need Babylon Lite or slot-indexed data.

Prefer `ids`, `visibleIds`, `slots`, and `entries` over maintaining duplicate arrays unless your app has a specific ordering separate from slot order.

Use direct setters when stale IDs are programmer errors. Use `try*` helpers when stale IDs are normal, such as UI selections, delayed network messages, or undo stacks.

Use `batch` or bulk helpers for multi-instance updates. Use `editRaw` only for hot paths where direct buffer access is worth the extra responsibility.
