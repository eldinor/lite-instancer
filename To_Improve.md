# To Improve

Findings from a quick API review of `@litools/instancer`.

Current test status after the API pass: `npm test` passed with 6 test files and 26 tests.

Note: Git reports this directory as dubious ownership for normal commands, so repo checks use a one-shot `safe.directory` option.

## Highest-Value API Improvements

### 1. Add a Shared Base Instance Interface

`InstanceSet` and `HierarchyInstanceSet` expose very similar app-level behavior: stable IDs, slot lookup, metadata, visibility, batching, raw editing, reserve, clear, and dispose.

Consider adding a shared interface such as:

```ts
export interface BaseInstanceSet<TMetadata = unknown> {
  readonly count: number;
  readonly capacity: number;
  readonly visibleCount: number;

  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId;
  remove(id: InstanceId): boolean;
  clear(): void;

  has(id: InstanceId): boolean;
  getSlot(id: InstanceId): number | undefined;
  getIdForSlot(slot: number): InstanceId | undefined;

  setMatrix(id: InstanceId, matrix: Mat4): void;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  getVisible(id: InstanceId): boolean;
  setVisible(id: InstanceId, visible: boolean): void;

  getMetadata(id: InstanceId): TMetadata | undefined;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  deleteMetadata(id: InstanceId): boolean;

  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void;
  editRaw(callback: (raw: RawInstanceWriter) => void): void;

  reserve(capacity: number): void;
  dispose(): void;
}
```

This would make user utilities easier to write across single meshes and hierarchy pools.

### 2. Add Iteration Helpers

Right now users need to keep external ID arrays or loop over slots manually. That works, but it creates repeated boilerplate for picking, updates, visibility filters, UI selection, and serialization.

Useful additions:

```ts
ids(): Iterable<InstanceId>;
visibleIds(): Iterable<InstanceId>;
slots(): Iterable<{ id: InstanceId; slot: number }>;
entries(): Iterable<{ id: InstanceId; slot: number; metadata?: TMetadata }>;
forEach(callback: (id: InstanceId, slot: number) => void): void;
```

These should probably exist on both `InstanceSet` and `HierarchyInstanceSet`.

### 3. Add Bulk Operations

The existing `batch` API is good, but common user operations could be made more ergonomic and less error-prone.

Possible functions:

```ts
createMany(items: Iterable<{ transform?: InstanceTransformInput; metadata?: TMetadata }>): InstanceId[];
removeMany(ids: Iterable<InstanceId>): number;
setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void;
setTransforms(items: Iterable<{ id: InstanceId; transform: InstanceTransformInput }>): void;
setMatrices(items: Iterable<{ id: InstanceId; matrix: Mat4 }>): void;
```

These could internally use `batch` and reduce accidental per-instance flushing.

### 4. Clarify Throwing vs Non-Throwing API Behavior

Current behavior is mixed:

- `remove(id)` returns `false` for unknown IDs.
- `setMatrix`, `getMatrix`, `setVisible`, and `setMetadata` throw for unknown IDs.
- VAT methods sometimes return `false` and sometimes no-op for unknown IDs.

Consider adding explicit non-throwing alternatives:

```ts
trySetMatrix(id: InstanceId, matrix: Mat4): boolean;
trySetTransform(id: InstanceId, transform: InstanceTransformInput): boolean;
trySetVisible(id: InstanceId, visible: boolean): boolean;
getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined;
```

That would make stale-ID handling cleaner for apps with UI state, network state, or deferred operations.

### 5. Make VAT API Feel More Consistent

Status: implemented with direct wrappers for common instance-set operations while keeping `.set` available.

`VatInstanceSet` now exposes common instance operations directly:

```ts
has(id: InstanceId): boolean;
setTransform(id: InstanceId, transform: InstanceTransformInput): void;
setVisible(id: InstanceId, visible: boolean): void;
getMetadata(id: InstanceId): TMetadata | undefined;
setMetadata(id: InstanceId, metadata: TMetadata): void;
setColor(id: InstanceId, color: InstanceColorInput): void;
```

Typical usage now looks like:

```ts
vat.setTransform(id, transform);
vat.setVisible(id, false);
vat.setMetadata(id, metadata);
vat.setColor(id, color);
vat.setClip(id, clip);
```

The underlying `.set` remains available for advanced integrations that specifically need the `ColoredInstanceSet`.

## Possible New Functions

### Transform Convenience

Status: implemented for position reads/writes, translation, and scale updates.

The transform utilities are already useful, but users will likely want object-level helpers that avoid manual matrix composition.

Possible additions:

```ts
getPosition(id: InstanceId, out?: Float32Array): Float32Array;
setPosition(id: InstanceId, position: Vec3Like): void;
translate(id: InstanceId, delta: Vec3Like): void;
setScale(id: InstanceId, scale: Vec3Like | number): void;
setRotationEuler(id: InstanceId, rotation: Vec3Like): void;
setRotationQuaternion(id: InstanceId, rotation: QuatLike): void;
```

These would make the library feel more like logical object management and less like direct buffer management.

### Metadata Queries

Status: implemented for query, filter, update, and non-throwing update helpers.

Metadata is already supported; query helpers would make it more useful.

```ts
findByMetadata(predicate: (metadata: TMetadata, id: InstanceId) => boolean): InstanceId | undefined;
filterByMetadata(predicate: (metadata: TMetadata, id: InstanceId) => boolean): InstanceId[];
updateMetadata(id: InstanceId, updater: (current: TMetadata | undefined) => TMetadata | undefined): void;
```

### Serialization and Restore

Stable IDs and metadata invite save/load workflows.

Possible additions:

```ts
toSnapshot(): InstanceSetSnapshot<TMetadata>;
restore(snapshot: InstanceSetSnapshot<TMetadata>): void;
cloneInto(target: BaseInstanceSet<TMetadata>): void;
```

This would be especially useful for editors, procedural generation tools, and examples.

### Picking Helpers

The picking registry and screen-space picker are good primitives. Higher-level helpers could reduce app boilerplate.

```ts
registerHierarchy(root: SceneNode, set: HierarchyInstanceSet<unknown>): this;
pickNearestByWorldPoint(options): InstancePick | undefined;
pickNearestByScreenPoint(options): InstancePick | undefined;
```

For hierarchies, a helper that collects child meshes from a root and registers them would be particularly nice.

### Manager-Level API

If the library grows beyond individual sets, consider an optional manager object:

```ts
const manager = createInstanceManager();
const boxes = manager.createSet(mesh, options);
const boomboxes = manager.createHierarchySet(root, options);

manager.pick(scenePick);
manager.clearAll();
manager.dispose();
```

This should remain optional. The current direct factory APIs are simple and should stay available.

## Internal Performance Notes

### Hierarchy Syncing

`HierarchyInstanceSet` currently syncs all visible slots in `#syncVisiblePool()`.

That is simple and reliable, but for large hierarchy pools it could become expensive when only a few slots changed.

Potential improvement:

- Track dirty matrix slots during `setMatrix`, `setTransform`, visibility swaps, and raw edits.
- During `batch`, flush only dirty visible slots.
- Keep full sync for rebuilds, clear, and capacity changes.

### Slot Iteration Source of Truth

If iteration helpers are added, prefer exposing them from `#slotToId` rather than requiring users to maintain duplicate ID arrays. This makes active-count swaps, removals, and growth easier to reason about.

## Documentation Improvements

Status: implemented in `README.md`, `docs/README.md`, and `User_Guide.md`.

Add a small API decision table:

| Need | Use |
| --- | --- |
| One repeated mesh | `createInstanceSet` |
| GLB or scene-node hierarchy | `createHierarchyInstanceSet` |
| Skinned/VAT animation | `createVatInstanceSet` |
| Rigid GPU picking | `createPickingRegistry` |
| Deformed/logical picking | `pickScreenSpaceInstanceFromPointer` |

Add examples for:

- Iterating IDs without external arrays.
- Bulk updates with `batch`.
- Handling stale IDs with `try*` APIs.
- VAT animation controls and direct wrapper helpers.
- When to use the underlying VAT `.set` for advanced `ColoredInstanceSet` integrations.

## Suggested Priority

Completed:

- Shared base interface.
- Iteration helpers.
- Bulk operations.
- Non-throwing `try*` methods.
- Transform convenience helpers.
- Metadata query/update helpers.
- VAT API consistency pass.
- User guide, README, docs README, and changelog updates.

Still worth considering:

1. Dirty-slot tracking for hierarchy sync.
2. Snapshot/restore helpers.
3. Higher-level picking helpers such as hierarchy registration or nearest-point picking.
4. Optional manager-level API for apps that coordinate several sets.
