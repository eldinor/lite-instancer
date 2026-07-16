# Instancer: Treating Babylon Lite Instances Like Real Application Objects

Rendering hundreds or thousands of repeated 3D objects is one of the places where thin instances shine. A forest of trees, a field of crates, a fleet of ships, or a crowd of animated creatures can all share mesh data and still render efficiently.

The GPU-friendly representation is not always application-friendly, though. Thin instances are stored in buffer slots. Those slots are great for rendering, but they are a fragile thing to put in application state: removing or hiding an instance can move another instance into its slot, and a rebuilt hierarchy can recreate the underlying buffers entirely.

[`@litools/instancer`](https://instancer.babylonpress.org/) is a small layer for Babylon Lite that closes that gap. It lets an application work with stable instance IDs while it manages the changing render slots underneath.

## The important distinction: IDs are stable, slots are not

The central idea is simple:

> Keep `InstanceId` values in your application. Let Instancer handle slot indices.

Creating an object returns a numeric ID:

```ts
const id = boxes.create({ position: [0, 0, 0], scale: 1 }, { team: "blue" });
```

That ID remains the identity of the object even if the renderer reorganizes its buffers. You can move it, hide it, attach metadata, or remove it without having to update every reference held by UI, selection, networking, or game logic.

When low-level code really needs the current buffer slot, ask for it at that moment:

```ts
const slot = boxes.getSlot(id);
```

## Start with one mesh

For the most common case — drawing one mesh many times — use `createInstanceSet`.

```ts
import { createInstanceSet } from "@litools/instancer";

const boxes = createInstanceSet<{ selected: boolean }>(boxMesh, {
  capacity: 500,
  colors: true,
  visibleStrategy: "active-count",
});

const id = boxes.create({ position: [2, 0, 1], scale: 1 }, { selected: false });

boxes.setPosition(id, [4, 0, 1]);
boxes.setColor(id, [0.2, 0.7, 1, 1]);
boxes.updateMetadata(id, (metadata) => (metadata ? { ...metadata, selected: true } : metadata));
```

The code reads as if `id` referred to an ordinary object, while the implementation still uses compact thin-instance data. Instancer also provides matrix-level methods when an application already has a Babylon Lite `Mat4`, plus convenience helpers for positions, translations, and scale.

## Choose a visibility strategy deliberately

Visibility is one reason slots cannot be treated as permanent IDs. Instancer offers two useful strategies:

- `"active-count"` keeps visible instances packed at the front of the buffer. It is efficient for rendering, but show, hide, and remove operations may move slots.
- `"scale-zero"` keeps slot positions more stable by writing zero-scale transforms for hidden objects. This is useful when another slot-indexed data set must stay aligned with the instances.

For normal rigid repeated meshes, `"active-count"` is a strong default. For a system with companion slot-based data—such as animation playback parameters—`"scale-zero"` is often the safer choice.

## Batch work without losing the object model

Real scenes rarely update one object at a time. Instancer exposes bulk helpers such as `createMany`, `setTransforms`, `setMatrices`, `setVisibleMany`, and `removeMany`, as well as a `batch` API that defers flushing until the work is complete.

```ts
boxes.batch((writer) => {
  for (const id of movingIds) {
    writer.setTransform(id, {
      position: nextPositionFor(id),
      scale: 1,
    });
  }
});
```

The benefit is not just fewer uploads. It keeps the application working in IDs and transforms instead of leaking buffer bookkeeping into every update loop.

For UI state, remote messages, or delayed events, the non-throwing `try*` helpers are particularly useful:

```ts
boxes.trySetVisible(idFromAnOldSelection, false);
boxes.trySetPosition(idFromNetwork, [0, 1, 0]);
```

They make stale IDs a normal, manageable condition rather than an exception path scattered through the app.

## Loaded models can be one logical object

Many assets are not a single mesh. A loaded GLB might contain multiple child meshes, nested transforms, and materials, but an application still wants to select, move, and remove it as one thing.

`createHierarchyInstanceSet` applies the same stable-ID model to a scene-node hierarchy:

```ts
import { createHierarchyInstanceSet } from "@litools/instancer";

const boomboxes = createHierarchyInstanceSet(glbRoot, {
  capacity: 100,
  grow: "rebuild",
});

const id = boomboxes.create({ position: [0, 0, 0], scale: 1 });
boomboxes.translate(id, [3, 0, 0]);
```

This is valuable because it keeps the distinction between source/prototype meshes and logical instances out of the rest of the application.

## Picking resolves back to a stable ID

Picking has the same identity problem. Babylon Lite can report a picked mesh and thin-instance slot, but an application usually wants to know which logical object was selected.

For rigid thin instances, register the set with a picking registry:

```ts
import { createPickingRegistry } from "@litools/instancer";

const registry = createPickingRegistry();
registry.register(boxMesh, boxes);

const picked = registry.fromPick(scenePick);
```

`picked` can then be treated as an application-level result rather than a renderer-specific slot lookup. For hierarchy assets, use the pick as a filter and resolve the appropriate logical instance. For VAT, skinned, or otherwise deformed visuals, Instancer also provides screen-space logical picking based on projected instance centers.

## Animated crowds with VAT

`createVatInstanceSet` is designed for repeated skinned meshes whose animation has been baked into vertex animation textures. The set exposes the familiar transforms, visibility, metadata, iteration, and batching methods directly, while adding animation controls such as per-instance clips, phase offsets, and playback rate.

```ts
import { createVatInstanceSet } from "@litools/instancer";

const sharks = createVatInstanceSet(engine, skinnedMesh, animationGroups, {
  capacity: 48,
});

const id = sharks.create({
  transform: { position: [0, 0, 0], scale: 1 },
  clip: "Swim",
  offset: 0.4,
});

sharks.setPhaseOffset(id, 1.2);
sharks.update(deltaSeconds);
```

VAT sets default to `"scale-zero"` visibility because animation data is slot-based and animated vertices may extend beyond their rest bounds.

## A useful boundary for large scenes

Instancer is not trying to replace Babylon Lite’s instance rendering. It keeps the fast path intact and adds an application-facing layer where it matters: identity, metadata, picking, visibility, pooling, and coordinated updates.

Use it when repeated meshes need to behave like durable objects in the rest of your system. The result is less slot bookkeeping, fewer invalid references after removals or rebuilds, and code that describes scene behavior in the same terms as the product itself.

Install it with:

```sh
npm install @litools/instancer
```

For API details and working examples, see the [README](./README.md) and [User Guide](./User_Guide.md).
