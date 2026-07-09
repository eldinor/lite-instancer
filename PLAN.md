# Babylon Lite Instance Manager Plan

## Goal

Create a small TypeScript package that makes Babylon Lite thin instances and hierarchy instance pools easier to use in real applications.

The package should not replace Babylon Lite's built-in instancing APIs. It should wrap them with stable IDs, pooling, lifecycle helpers, picking support, and ergonomic batch updates.

Working package name:

```txt
@litools/instancer
```

## Babylon Lite Context

Current target package:

```txt
@babylonjs/lite@1.8.0
```

Use the latest stable versions when scaffolding and before each release. As of 2026-07-09, npm reports `@babylonjs/lite@1.8.0` as `latest`.

Planned package dependencies:

- `@babylonjs/lite`: peer dependency, latest stable
- `typescript`: dev dependency, latest stable
- `vitest`: dev dependency, latest stable
- `vite`: dev dependency for examples, latest stable
- `@webgpu/types`: optional/dev typing dependency, latest stable

Relevant Lite APIs:

```ts
addThinInstance
setThinInstanceMatrix
removeThinInstance
setThinInstanceCount
setThinInstances
setThinInstanceColor
setThinInstanceColors
enableThinInstanceGpuCulling

createHierarchyInstancePool
addHierarchyInstance
setHierarchyInstanceMatrix
removeHierarchyInstance
setHierarchyInstanceCount

loadGltf
addToScene
createDefaultCamera
createEngine
createSceneContext
registerScene
startEngine
```

Important behavior:

- Thin instances are efficient but expose raw numeric slots.
- Removal uses swap-remove, so public slot indexes can change.
- Hierarchy instance pools support full loaded model hierarchies by expanding one logical root transform into all descendant mesh thin-instance buffers.
- A helper package should preserve stable application-level identity while allowing Lite to keep its fast internal slot behavior.

## Core Design

Expose two primary managers:

```ts
createInstanceSet(mesh, options)
createHierarchyInstanceSet(rootNode, options)
```

`InstanceSet` manages one mesh through Lite thin instances.

`HierarchyInstanceSet` manages a multi-mesh hierarchy through Lite hierarchy instance pools.

Both managers should expose stable `InstanceId` handles:

```ts
type InstanceId = number & { readonly __brand: unique symbol };
```

`InstanceId` should be numeric at runtime. This keeps IDs fast, serializable, array-friendly, and easy to use with app metadata. The TypeScript type may be branded so slots, raw numbers, and stable instance IDs are harder to mix accidentally during development.

Internally each manager keeps:

```ts
idToSlot: Map<InstanceId, number>
slotToId: InstanceId[]
```

When Lite swap-removes an instance, the manager updates these mappings so user-facing IDs remain stable.

## MVP API

```ts
interface InstanceSet<TMetadata = unknown> {
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

For single-mesh instance sets only:

```ts
interface ColoredInstanceSet<TMetadata = unknown> extends InstanceSet<TMetadata> {
  setColor(id: InstanceId, color: InstanceColorInput): void;
  getColor(id: InstanceId, out?: Float32Array): Float32Array;
}
```

`HierarchyInstanceSet` should share the same public lifecycle, transform, visibility, metadata, batch, and picking identity behavior. Color APIs can be added later for hierarchy pools only if Babylon Lite exposes a clear per-child-mesh color strategy for hierarchy instances.

## Transform Input

Support matrix-first hot paths and ergonomic TRS helpers.

```ts
type InstanceTransformInput =
  | Mat4
  | {
      position?: Vec3Like;
      rotationQuaternion?: QuatLike;
      rotationEuler?: Vec3Like;
      scale?: Vec3Like | number;
    };
```

Implementation should build column-major Babylon Lite-compatible `Mat4` values.

## Options

```ts
interface InstanceSetOptions {
  capacity?: number;
  grow?: "none" | "double" | "exact";
  gpuCulling?: boolean;
  colors?: boolean;
  visibleStrategy?: "active-count" | "scale-zero";
}

interface HierarchyInstanceSetOptions {
  capacity?: number;
  grow?: "none" | "rebuild";
  gpuCulling?: boolean;
  visibleStrategy?: "active-count" | "scale-zero";
}
```

Default choices:

- `capacity`: `128`
- `grow`: `"double"` for `InstanceSet`
- `grow`: `"none"` for `HierarchyInstanceSet` by default, because Lite hierarchy pools are naturally fixed-capacity
- `gpuCulling`: `false`
- `colors`: `false`
- `visibleStrategy`: `"active-count"`

Hierarchy pool growth should be user-selectable:

- `"none"`: default. Fixed capacity, fastest and most predictable. Creating beyond capacity throws a clear error.
- `"rebuild"`: convenience mode. When capacity is exceeded, create a larger Lite hierarchy pool, copy active logical instance matrices into it, and preserve stable IDs.

Rebuild mode should document that it is more expensive than fixed capacity and may briefly recreate underlying thin-instance buffers. It is useful for editors, prototypes, and dynamic apps where exact capacity is not known up front.

Visibility should be user-selectable:

- `"active-count"`: default. Visible instances are partitioned into slots `[0, visibleCount)`, hidden instances are moved after that range, and Lite draws only the visible count. This is the best performance path for large sets, filters, layers, and group visibility.
- `"scale-zero"`: opt-in convenience/debug strategy. Hidden instances keep their current slots, but their matrices are written with zero scale. This is simpler and avoids internal slot movement, but hidden instances may still carry GPU, picking, culling, or bounds costs.

Both strategies must preserve stable `InstanceId` values. With `"active-count"`, the manager updates `idToSlot` and `slotToId` whenever visibility changes cause slot swaps.

## Picking Support

The package should make it easy to map a Babylon Lite pick result back to a stable ID.

Possible API:

```ts
registry.register(mesh, instanceSet);
registry.fromPick(pickResult);
registry.get(mesh, thinInstanceIndex);
```

Return shape:

```ts
interface InstancePick {
  set: InstanceSet;
  id: InstanceId;
  slot: number;
  mesh: Mesh;
}
```

This is a high-value feature because raw `thinInstanceIndex` values are implementation slots, not stable application IDs.

Animated/VAT/deformed meshes need a second picking mode. Babylon Lite's GPU picker can identify the raw thin instance slot, but the picker pass may use rest/source geometry rather than the final visually deformed surface. For these cases the package should expose logical screen-space picking:

```ts
const picked = pickScreenSpaceInstanceFromPointer({
  event,
  canvas,
  camera,
  ids,
  has: (id) => set.has(id),
  isVisible: (id) => set.getVisible(id),
  getWorldPosition: (id) => currentLogicalCenter(id),
  getScreenRadius: (id) => currentScreenRadius(id)
});
```

Use `PickingRegistry` for rigid/static mesh identity. Use screen-space logical picking when the app wants to select an animated or visually deformed logical object rather than the exact raw pick triangle.

## Batch Updates

Provide an explicit batch API for streaming updates:

```ts
instances.batch((writer) => {
  writer.setMatrix(idA, matrixA);
  writer.setMatrix(idB, matrixB);
  writer.setColor(idB, [1, 0, 0, 1]);
});
```

The default batch API should be safe and preserve manager invariants: stable IDs, dirty ranges, visibility partitioning, slot mappings, and metadata cleanup.

Also expose an advanced callback-based raw editing API for high-performance users:

```ts
instances.editRaw((raw) => {
  raw.writeMatrix(idA, matrixA);
  raw.writeColor(idB, [1, 0, 0, 1]);
});
```

Raw editing should not expose permanently mutable arrays. Access should be scoped to a callback so the manager can mark dirty ranges, flush once, and prevent stale mutations after the edit block.

Possible raw writer shape:

```ts
interface InstanceBatchWriter<TMetadata = unknown> {
  setMatrix(id: InstanceId, matrix: Mat4): void;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  setVisible(id: InstanceId, visible: boolean): void;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  setColor?(id: InstanceId, color: InstanceColorInput): void;
}

interface RawInstanceWriter {
  readonly matrices: Float32Array | Float64Array;
  readonly colors?: Float32Array;

  getSlot(id: InstanceId): number | undefined;
  writeMatrix(id: InstanceId, matrix: Mat4): void;
  writeColor(id: InstanceId, color: InstanceColorInput): void;
  markMatrixDirty(slot: number): void;
  markColorDirty(slot: number): void;
}
```

Batch API layers:

1. `setMatrix` / `setColor`: simple one-off updates.
2. `batch(writer => ...)`: safe many-instance updates.
3. `editRaw(raw => ...)`: advanced controlled direct buffer access.

## Metadata

Support optional typed app metadata inside the manager without turning the package into an ECS or reactive state framework.

```ts
const id = instances.create(transform, {
  kind: "enemy",
  hp: 100,
});

instances.getMetadata(id);
instances.setMetadata(id, value);
instances.deleteMetadata(id);
```

Metadata should be backed by a simple internal map keyed by stable `InstanceId`. It should be automatically cleaned up when an instance is removed or when the set is cleared.

This makes picking and examples immediately useful:

```ts
const picked = registry.fromPick(pickResult);
const metadata = picked ? picked.set.getMetadata(picked.id) : undefined;
```

Advanced apps can ignore manager metadata and keep their own external state:

```ts
const external = new Map<InstanceId, MyAppData>();
```

Keep manager metadata shallow and lightweight. Do not add deep observation, component systems, signals, or query engines to the core package.

## Package Structure

```txt
src/
  index.ts
  instance-id.ts
  instance-set.ts
  hierarchy-instance-set.ts
  transforms.ts
  colors.ts
  picking-registry.ts
  errors.ts
tests/
  instance-set.test.ts
  hierarchy-instance-set.test.ts
  transforms.test.ts
  picking-registry.test.ts
examples/
  basic-thin-instances/
  primitive-box-field/
  primitive-sphere-cloud/
  primitive-mixed-playground/
  visibility-layers/
  raw-batch-streaming/
  boombox-grid/
  boombox-picker/
  boombox-rebuild-growth/
  shark-school-shared-animation/
  shark-phase-buckets/
```

## Example Apps

Examples should be real app demonstrations, not tiny snippets. Each example should start a Babylon Lite scene, use the package as a consumer would, and make the benefit visible.

Examples should be launched from one root index page served by:

```txt
npm run dev
```

Do not add one npm dev script per example. The root index page should link to every runnable demo and every planned example README so the example set stays discoverable from a single place.

Browser smoke tests are not part of the current plan. Verification should stay focused on TypeScript checks, unit tests, package build, and manual example review while the examples are still changing quickly.

Example coverage checklist:

| Capability | Example that proves it |
| --- | --- |
| Stable numeric IDs | Basic Thin Instances, BoomBox Picker |
| Single-mesh primitive instancing | Primitive Box Field, Primitive Sphere Cloud |
| Multiple instance sets | Primitive Mixed Playground |
| Per-instance colors | Primitive Box Field |
| Metadata | Primitive Sphere Cloud, Shark School |
| Picking registry | Primitive Mixed Playground, BoomBox Picker, Shark School |
| Add/remove with swap-remove safety | Basic Thin Instances, BoomBox Picker |
| Visibility strategies | Visibility Layers |
| Safe batch updates | Primitive Box Field |
| Controlled raw buffer editing | Raw Batch Streaming |
| Hierarchy GLB instancing | BoomBox Grid |
| Hierarchy pool rebuild growth | BoomBox Rebuild Growth |
| Animated GLB V1 behavior | Shark School With Shared Animation |
| Animation phase variation | Shark Phase Buckets |

### 1. Basic Thin Instances

Purpose:

- Demonstrate `createInstanceSet` with a primitive mesh.
- Show stable IDs, transforms, colors, removal, and re-use.

Behavior:

- Create a grid of boxes or spheres.
- Animate a wave through the instances by updating transforms.
- Click an instance to recolor it.
- Press a UI button to remove random instances and prove IDs still resolve correctly after swap-remove.

### 2. Primitive Box Field

Purpose:

- Demonstrate the simplest high-count primitive use case.
- Show `createInstanceSet` with `createBox`.
- Stress test transform updates and color updates.

Behavior:

- Create a large field of box instances.
- Animate height, rotation, and color like an equalizer or terrain surface.
- Allow random add/remove operations.
- Click a box to pin it, recolor it, and show its stable ID.

Expected user-visible proof:

- Hundreds or thousands of boxes update smoothly.
- Removing boxes does not make pinned/selected boxes lose identity.
- Per-instance colors work clearly.

### 3. Primitive Sphere Cloud

Purpose:

- Demonstrate `createInstanceSet` with `createSphere`.
- Show non-grid placement and continuous movement.
- Show metadata-driven interaction.

Behavior:

- Create a cloud/orbit of sphere instances.
- Assign metadata such as mass, orbit radius, speed, and group.
- Animate each sphere around a center point.
- Toggle groups on and off.
- Click a sphere to show its metadata and stable ID.

Expected user-visible proof:

- Instances can be managed like application objects, not just render slots.
- Group visibility and selection remain stable as objects move.

### 4. Primitive Mixed Playground

Purpose:

- Demonstrate multiple `InstanceSet` managers in one scene.
- Show boxes, spheres, cylinders, and torus/other primitives managed side by side.
- Exercise the picking registry across multiple meshes.

Behavior:

- Create separate instance sets for boxes, spheres, cylinders, and another primitive if supported by the selected Lite build.
- Use a shared picking registry to resolve clicks across all primitive sets.
- Provide UI controls for spawn mode, delete mode, recolor mode, and transform mode.
- Spawn new primitive instances at clicked positions.

Expected user-visible proof:

- The registry can identify which manager owns a clicked primitive.
- App code can treat all primitive instance types through a common API.
- Independent capacities and removals do not corrupt IDs across managers.

### 5. Visibility Layers

Purpose:

- Demonstrate `visibleStrategy: "active-count"` and `visibleStrategy: "scale-zero"`.
- Show that hidden instances keep stable IDs and metadata.
- Make group/layer visibility behavior obvious.

Behavior:

- Create several colored primitive groups, such as red boxes, blue spheres, and green cylinders.
- Toggle each group on and off using the default `"active-count"` strategy.
- Provide a debug switch to run the same scene with `"scale-zero"`.
- Keep a selected hidden instance in app state, then show the group again and prove the same `InstanceId` is restored.

Expected user-visible proof:

- Hidden groups stop drawing.
- Selection and metadata survive hide/show.
- The debug panel shows `visibleCount` changing for `"active-count"`.

### 6. Raw Batch Streaming

Purpose:

- Demonstrate high-frequency updates through `batch` and `editRaw`.
- Show the difference between safe writer updates and controlled direct buffer edits.

Behavior:

- Create thousands of primitive instances.
- Animate them every frame from procedural data.
- Use `batch(writer => ...)` for a normal mode.
- Use `editRaw(raw => ...)` for a performance mode.
- Display update mode, instance count, and frame timing in a small external panel.

Expected user-visible proof:

- Large instance counts can be updated continuously.
- Raw editing is available without exposing permanently mutable arrays.
- Stable IDs and picking still work after streaming updates.

### 7. BoomBox Grid

Asset:

```txt
https://playground.babylonjs.com/scenes/BoomBox.glb
```

Purpose:

- Demonstrate `createHierarchyInstanceSet` with a loaded GLB hierarchy.
- Show that a multi-mesh model can be instanced as one logical object.

Behavior:

- Load the BoomBox once.
- Create a grid of BoomBox instances.
- Give each instance a stable ID label in app state.
- Animate transforms independently: bobbing, rotating, or selection scaling.
- Remove and add instances while preserving stable IDs.

Expected user-visible proof:

- The app should show dozens or hundreds of BoomBoxes.
- Clicking any BoomBox should select the logical instance, not a child mesh slot.
- Removing one BoomBox should not break selection for the others.

### 8. BoomBox Picker

Asset:

```txt
https://playground.babylonjs.com/scenes/BoomBox.glb
```

Purpose:

- Demonstrate the picking registry.
- Prove `mesh + thinInstanceIndex` maps back to a stable `InstanceId`.

Behavior:

- Click a BoomBox to highlight it.
- Show the selected instance ID in an external debug panel.
- Delete the selected instance.
- Click remaining instances and verify their IDs remain stable even though internal slots may have changed.

Expected user-visible proof:

- The selected logical ID stays consistent across updates.
- Deleting selected instances does not cause wrong objects to be highlighted.

### 9. BoomBox Rebuild Growth

Asset:

```txt
https://playground.babylonjs.com/scenes/BoomBox.glb
```

Purpose:

- Demonstrate hierarchy pool `grow: "rebuild"`.
- Prove capacity can grow while preserving stable logical IDs.

Behavior:

- Start with a deliberately small capacity, such as `8`.
- Spawn BoomBoxes past capacity.
- Rebuild the hierarchy pool to a larger capacity.
- Preserve transforms, metadata, visibility, and selected ID across the rebuild.

Expected user-visible proof:

- New BoomBoxes continue appearing after the original capacity is exceeded.
- Existing selected BoomBoxes keep the same stable IDs.
- A debug panel shows capacity increasing.

### 10. Shark School With Shared Animation

Asset:

```txt
https://assets.babylonjs.com/meshes/shark.glb
```

Purpose:

- Demonstrate how animated GLB content behaves in V1.
- Show many animated-looking logical instances without promising per-instance skeleton state.

V1 animation decision:

- Animated GLB instances use shared animation per pool.
- Every shark instance has its own world transform, path, speed, scale, visibility, metadata, and pick identity.
- The underlying shark animation timeline is shared by the prototype/pool.
- This is the default behavior because Lite hierarchy instances are transform instances; independent skeletal timelines per thin instance require a dedicated animation-texture or shader path.

Behavior:

- Load `shark.glb`.
- Start its swim animation on the source/prototype.
- Create a school of shark instances using `createHierarchyInstanceSet`.
- Move each shark on its own path while all sharks share the same swim cycle.
- Click a shark to select it and display its stable ID and app metadata.

Expected user-visible proof:

- The sharks move independently through the scene.
- The swim motion is synchronized within the pool.
- Picking resolves from a clicked shark mesh to the logical shark ID.

### 11. Shark Phase Buckets

Asset:

```txt
https://assets.babylonjs.com/meshes/shark.glb
```

Purpose:

- Demonstrate the recommended V1 workaround for visual animation variation.
- Avoid implying fully independent per-instance skeletal animation.

Behavior:

- Create several shark pools from the same loaded asset or cloned prototype hierarchy.
- Offset the animation clock per pool, for example 0%, 25%, 50%, and 75% through the swim cycle.
- Assign each shark instance to a phase bucket.
- Move every shark independently while each bucket has a different shared swim phase.

Expected user-visible proof:

- The school no longer looks perfectly synchronized.
- The package still maintains stable IDs across all buckets.
- Picking returns the logical shark instance regardless of which phase bucket owns it.

### Future Animated GLB Direction

True per-instance animation should be treated as a separate advanced feature:

- Bake skeletal animation to VAT or another animation texture format.
- Store per-instance animation time, clip index, speed, and phase in per-instance attributes or storage buffers.
- Drive animation in the material/shader path so each thin instance can sample a different frame.
- Expose an API such as `setAnimation(id, { clip, time, speed, phase })`.

This should not be required for the first useful version of `@litools/instancer`.

## Milestones

### 1. Package Scaffold

- Create TypeScript ESM package.
- Name package `@litools/instancer`.
- Add latest stable `@babylonjs/lite` as a peer dependency.
- Add latest stable build/test tooling.
- Export public types.

### 2. Transform Utilities

- Compose TRS to `Mat4`.
- Copy/read matrices safely.
- Add tests for matrix layout and default identity behavior.

### 3. InstanceSet MVP

- Create stable IDs.
- Add/remove/clear instances.
- Maintain `idToSlot` and `slotToId`.
- Update mappings after swap-remove.
- Support `setMatrix` and `getMatrix`.
- Support numeric runtime IDs with TypeScript branding.
- Add tests using mocked Lite mesh data where possible.

### 4. Color Support

- Optional per-instance color buffers.
- `setColor` and `getColor`.
- Dirty updates through Lite `setThinInstanceColor`.

### 5. Visibility And Metadata

- Implement `visibleStrategy: "active-count"`.
- Implement `visibleStrategy: "scale-zero"`.
- Track `visibleCount`.
- Preserve stable IDs through visibility slot swaps.
- Add optional typed metadata storage.
- Clean metadata on remove and clear.

### 6. Batch And Raw Editing

- Implement safe `batch(writer => ...)` updates.
- Implement controlled `editRaw(raw => ...)` updates.
- Mark matrix and color dirty ranges.
- Ensure raw buffers are only mutable within the callback.

### 7. HierarchyInstanceSet MVP

- Wrap `createHierarchyInstancePool`.
- Create/remove stable IDs.
- Maintain mappings after `removeHierarchyInstance`.
- Support fixed-capacity behavior with clear errors.
- Support `grow: "rebuild"` with preserved IDs, transforms, visibility, and metadata.

### 8. Picking Registry

- Register meshes and managers.
- Resolve `mesh + thinInstanceIndex` to stable `InstanceId`.
- Support hierarchy pools where multiple child meshes map to the same logical instance.

### 9. Examples

- Maintain one root examples index page with links to all runnable demos and planned example READMEs.
- Basic thin instances example.
- Primitive box field using Lite `createBox`.
- Primitive sphere cloud using Lite `createSphere`.
- Primitive mixed playground using multiple primitive instance sets and one picking registry.
- Visibility layers example showing `"active-count"` and `"scale-zero"`.
- Raw batch streaming example showing `batch` and `editRaw`.
- BoomBox hierarchy grid using `https://playground.babylonjs.com/scenes/BoomBox.glb`.
- BoomBox picking example that shows stable IDs surviving removal.
- BoomBox rebuild growth example showing `grow: "rebuild"` for hierarchy pools.
- Shark school example using `https://assets.babylonjs.com/meshes/shark.glb` with shared animation per pool.
- Shark phase bucket example that shows practical animation variation without per-instance skeleton timelines.
- Each example should expose the relevant state in a small external debug panel: count, visible count, capacity, selected ID, selected metadata, and update mode where useful.

### 10. Documentation

- README quick start.
- API reference.
- Performance notes.
- Babylon Lite compatibility notes.
- Animated GLB behavior notes: shared animation per pool in V1, phase buckets for variation, true per-instance animation as a future VAT/shader feature.

## First Implementation Target

Build the smallest useful package:

```ts
const trees = createHierarchyInstanceSet(treeRoot, {
  capacity: 10000,
  gpuCulling: true,
});

const id = trees.create({
  position: [10, 0, 4],
  rotationEuler: [0, Math.PI / 2, 0],
  scale: 1,
});

trees.setTransform(id, { position: [12, 0, 4] });
trees.remove(id);
```

The first version is successful when app code never needs to store raw `thinInstanceIndex` values directly.
