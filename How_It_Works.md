# How It Works

`@litools/instancer` is a small layer over Babylon Lite thin instances. Its main job is to let an app think in terms of stable objects while Babylon Lite thinks in terms of GPU buffer slots.

The package is built around one rule:

> Your app keeps stable numeric `InstanceId` values. The package manages the moving slot indices.

## Public Pieces

The public entry point exports these modules:

```ts
export * from "./types.js";
export * from "./transforms.js";
export * from "./instance-set.js";
export * from "./hierarchy-instance-set.js";
export * from "./picking-registry.js";
export * from "./screen-space-picking.js";
export * from "./vat-instance-set.js";
export * from "./errors.js";
```

The most important APIs are:

- `createInstanceSet`: one mesh, many thin instances.
- `createHierarchyInstanceSet`: one scene-node or GLB hierarchy, many logical instances.
- `createVatInstanceSet`: one skinned mesh with baked VAT animation, many animated instances.
- `PickingRegistry`: maps Babylon Lite thin-instance picks back to stable IDs.
- `pickScreenSpaceInstanceFromPointer`: logical picking for deformed or animated visuals.

## ID vs Slot

Babylon Lite renders thin instances from arrays. Each visible instance has a slot index in those arrays.

Slots are fast, but not stable:

- removing an instance can swap another instance into its slot
- hiding with `active-count` can move slots
- hierarchy pool rebuilds can recreate backing meshes and buffers

So the package creates stable IDs:

```ts
const id = boxes.create({ position: [0, 0, 0], scale: 1 });
```

Internally, each manager keeps two mappings:

```ts
#idToSlot = new Map<InstanceId, number>();
#slotToId: InstanceId[] = [];
```

When slots move, these maps are updated. Your app keeps the ID and only asks for a slot when it needs low-level Babylon Lite details:

```ts
const slot = boxes.getSlot(id);
```

## InstanceSet

`InstanceSet` manages thin instances for one Babylon Lite mesh.

Creation allocates matrix and optional color buffers:

```ts
this.#matrices = new Float32Array(this.#capacity * 16);
setThinInstances(this.mesh, this.#matrices, this.#capacity);
setThinInstanceCount(this.mesh, 0);

if (options.colors) {
  this.#colors = new Float32Array(this.#capacity * 4);
  setThinInstanceColors(this.mesh, this.#colors);
}
```

Creating an instance:

```ts
const id = toInstanceId(this.#nextId++);
const matrix = composeMat4(transform);
const slot = this.#count++;

this.#slotToId[slot] = id;
this.#idToSlot.set(id, slot);
this.#writeMatrixAt(slot, matrix);
```

So one instance has:

- a stable ID
- a current slot
- a matrix
- optional color
- optional metadata
- a visibility state

## Metadata

Metadata is app-owned data stored beside the ID:

```ts
const id = boxes.create(transform, {
  label: "box-12",
  team: "blue"
});
```

The package does not interpret metadata. It just keeps it attached to the ID:

```ts
boxes.getMetadata(id);
boxes.setMetadata(id, nextMetadata);
boxes.deleteMetadata(id);
```

This is useful because slots can move, but metadata stays with the logical object.

## Visibility

There are two visibility strategies.

### active-count

`active-count` keeps visible instances packed at the start of the buffer.

When hiding an ID:

```ts
this.#visibleCount--;
this.#swapSlots(slot, this.#visibleCount);
setThinInstanceCount(this.mesh, this.#visibleCount);
```

This is efficient for rendering because Babylon Lite draws only visible slots.

Tradeoff: slots move.

### scale-zero

`scale-zero` keeps the instance in its slot but writes a zero-scale matrix when hidden.

```ts
this.#hiddenMatrices.set(id, original);
this.#writeMatrixAt(slot, writeZeroScale(original));
```

This is useful when another slot-indexed system must stay aligned, such as VAT playback parameters.

Tradeoff: hidden instances still occupy draw slots.

## Removal

Removal keeps buffers packed.

For `active-count`, visible removal may do two swaps:

1. swap the removed visible slot with the last visible slot
2. swap the removed slot area with the last live slot

For other cases, it swaps with the last live slot.

The key is that `#swapSlots` swaps matrices, colors, and ID mappings together:

```ts
this.#swapMatrix(a, b);
this.#swapColor(a, b);
this.#slotToId[a] = bId;
this.#slotToId[b] = aId;
this.#idToSlot.set(aId, b);
this.#idToSlot.set(bId, a);
```

That is why the app can safely keep IDs even when slots change.

## Batch Updates

`batch` is the normal way to update many instances.

```ts
boxes.batch((writer) => {
  for (const id of ids) {
    writer.setTransform(id, nextTransform(id));
  }
});
```

During the callback, updates are collected. At the end, the set flushes thin-instance changes and invalidates render bundles once.

Use `batch` for most app code.

## Raw Updates

`editRaw` exposes the backing matrix and color arrays for advanced update loops:

```ts
instances.editRaw((raw) => {
  const slot = raw.getSlot(id);
  if (slot === undefined) return;

  raw.writeMatrix(id, matrix);
  raw.markMatrixDirty(slot);
});
```

The important safety rule is still the same: use IDs as the source of truth, then ask for the current slot.

Use `editRaw` only when a hot path needs direct buffer-style control.

## Growth

Single-mesh `InstanceSet` can grow with:

- `none`: throw when capacity is exceeded
- `double`: grow by doubling capacity
- `exact`: grow exactly to the required capacity

When capacity grows, the package allocates new buffers, copies live matrix/color data, and reconnects them to the mesh.

Hierarchy pools are different because Babylon Lite hierarchy pools are created as a fixed pool. For those, growth is either:

- `none`
- `rebuild`

With `rebuild`, the package creates a larger hierarchy pool and replays existing live transforms and mappings into it.

## HierarchyInstanceSet

`HierarchyInstanceSet` repeats a full scene-node tree, usually a loaded GLB root.

It wraps Babylon Lite's hierarchy pool:

```ts
this.#pool = createHierarchyInstancePool(this.root, this.#capacity);
setHierarchyInstanceCount(this.#pool, 0);
```

The app still gets one ID per logical object:

```ts
const id = boomboxes.create(transform, {
  label: "boombox-3-4"
});
```

Even if the source GLB has many child meshes, the manager treats each created hierarchy instance as one logical app object.

## Picking

Babylon Lite picking returns mesh and thin-instance slot information. The package maps that back to stable IDs with `PickingRegistry`.

Registration:

```ts
const registry = new PickingRegistry();
registry.register(mesh, boxes);
```

Resolution:

```ts
const picked = registry.fromPick({
  mesh: pickedMesh,
  thinInstanceIndex,
  hasThinInstance: true
});
```

Internally:

```ts
const set = this.#meshToSet.get(mesh);
const id = set.getIdForSlot(thinInstanceIndex);
```

For one rigid mesh, this is usually enough.

For GLB hierarchies, picking can be more subtle because the hit may land on a child mesh or prototype-related mesh. In those cases, use:

```ts
belongsToHierarchyRoot(pickedMesh, glbRoot);
```

Then resolve the final app ID with the picked world point or nearest logical center.

## Screen-Space Picking

Animated or deformed meshes can be visually somewhere else than their rest-geometry pick result.

For those cases, `pickScreenSpaceInstanceFromPointer` projects logical positions into screen space and chooses the closest one:

```ts
pickScreenSpaceInstanceFromPointer({
  event,
  canvas,
  camera,
  ids,
  has: (id) => sharks.has(id),
  isVisible: (id) => sharks.getVisible(id),
  getWorldPosition: (id) => getCurrentCenter(id),
  getScreenRadius: (id) => 32
});
```

This is why the VAT shark examples pick by logical centers rather than GPU triangle hits.

## VAT Instance Set

`createVatInstanceSet` is for many animated instances of one skinned mesh.

It:

1. bakes Babylon Lite animation groups into VAT data
2. attaches VAT playback to the mesh
3. creates an underlying `InstanceSet`
4. stores per-instance playback settings

Creation:

```ts
const baked = bakeVat(engine, mesh, animationGroups);
const handle = attachVat(engine, mesh, baked, initialClip);
const set = createInstanceSet(mesh, {
  gpuCulling: options.gpuCulling ?? false,
  visibleStrategy: options.visibleStrategy ?? "scale-zero"
});
```

The helper exposes the underlying set:

```ts
vatSet.set.setVisible(id, false);
vatSet.set.setMetadata(id, metadata);
```

And animation controls:

```ts
vatSet.play("Swim");
vatSet.setClip(id, "Turn");
vatSet.setPhaseOffset(id, 1.2);
vatSet.setFps(id, 24);
vatSet.update(deltaSeconds);
```

`scale-zero` is the default visibility strategy because VAT playback data is slot-based. Keeping slots stable avoids unnecessary surprises.

GPU culling defaults to false because animated vertices can move outside the rest mesh bounds.

## Transform Inputs

Most APIs accept either a Babylon Lite `Mat4` or a small transform object:

```ts
boxes.create({
  position: [0, 0, 0],
  rotationEuler: [0, Math.PI / 2, 0],
  scale: 1
});
```

Internally, transform objects are converted with `composeMat4`.

For loaded GLB roots, examples often multiply the placement matrix by the source root matrix:

```ts
multiplyMat4(composeMat4(makeMatrix(x, y, z, scale, yaw)), sourceRootMatrix);
```

That preserves the imported asset's authored root transform.

## Render Bundle Invalidation

Babylon Lite may cache render bundles. When instance buffers, colors, counts, or pool data change, the package asks Babylon Lite to refresh render state.

During `batch`, invalidations are delayed and flushed once.

This keeps common app loops simple:

```ts
set many transforms
flush once
render normally
```

## Mental Model

Think of the package as three layers:

```text
Your app
  stable IDs, metadata, selection, gameplay/application state

@litools/instancer
  ID-to-slot mapping, visibility, pooling, picking conversion, batching

Babylon Lite
  meshes, hierarchy pools, thin-instance buffers, GPU rendering, VAT playback
```

The package does not try to own your app state. It owns the fragile parts that are easy to get wrong: slot movement, buffer updates, visibility packing, and pick-to-ID mapping.

## Practical Rules

Keep `InstanceId` values in your app state.

Do not store slots as permanent identifiers.

Use metadata for app-level labels, groups, lanes, colors, and behavior state.

Use `batch` for ordinary per-frame updates.

Use `editRaw` only when you need direct buffer access.

Use `active-count` when render efficiency matters most.

Use `scale-zero` when slot stability matters more.

For hierarchy picking, treat GPU picks as a signal, then resolve to the logical object.

For VAT or skinned visuals, prefer screen-space logical picking.
