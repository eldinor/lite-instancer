# @litools/instancer

Stable IDs, pooling, picking, visibility, metadata, and batch updates for Babylon Lite instances.

`@litools/instancer` helps Babylon Lite apps treat thin instances and hierarchy instances as app-level objects with stable numeric IDs. Use it when you need many repeated meshes, picking, hide/show, metadata, or fast transform updates without manually tracking thin instance slots.

Created by [BabylonPress](https://babylonpress.org/).

## Install

```sh
npm install @litools/instancer @babylonjs/lite
```

## Runtime

This package is ESM-only.

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

Use `createVatCharacterSet` when a character GLB has several skinned mesh parts. It creates one logical VAT character whose secondary meshes mirror the primary mesh's IDs, transforms, visibility, clip, phase, and FPS:

```ts
import { createVatCharacterSet } from "@litools/instancer";

const heroes = createVatCharacterSet(engine, characterRoot, animationGroups, {
  capacity: 300,
  visibleStrategy: "scale-zero"
});
```

Use `PickingRegistry` for normal thin-instance picking. Use `pickScreenSpaceInstanceFromPointer` when the visible mesh is deformed or animated and GPU picking does not line up with the final visual position.

Use the optional outline subpath to highlight stable IDs without retaining backing slots:

```ts
import { createInstanceOutliner } from "@litools/instancer/outline";

const outliner = createInstanceOutliner(engine, scene);
const outlines = outliner.attach(boxes, {
  geometry: boxData,
  thickness: 0.04,
  color: [0.3, 0.8, 1]
});

outlines.highlight(id);
// Call after changing a highlighted source transform.
outlines.refresh(id);
```

The outline renderer uses one compact thin-instance draw per attached host and stores only highlighted IDs. Use `createThinInstanceOutliner` for ordinary meshes or raw Babylon Lite thin-instance indices. A host with a live Babylon Lite skeleton automatically shares its joint/weight streams with the outline and mirrors current bone matrices each frame. Explicit source geometry is the supported contract; transparent hosts and mirrored winding remain documented limitations.

The original idea for this outline feature came from [increasinglyHuman/babylon-thin-instance-outline](https://github.com/increasinglyHuman/babylon-thin-instance-outline) for Babylon.js. This package implements the approach natively for Babylon Lite and adds its own stable-ID, compact-pool, and live-skeleton workflows.

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

Use metadata helpers to query or update app state attached to IDs:

```ts
const selected = boxes.filterByMetadata((metadata) => metadata.selected);

boxes.updateMetadata(id, (metadata) =>
  metadata ? { ...metadata, selected: true } : metadata
);
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

For VAT sets, matrix-only batches update transforms without rebuilding playback parameters. Batched visibility changes resync playback because visibility strategies can move backing slots.

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
  has: (id) => sharks.has(id),
  isVisible: (id) => sharks.getVisible(id),
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
sharks.setVisible(id, false);
sharks.update(deltaSeconds);
```

VAT sets expose common instance-set helpers directly, including transforms, visibility, metadata, colors, iteration, and batching. The underlying `sharks.set` remains available for advanced integrations that specifically need the `ColoredInstanceSet`; the shark examples use that underlying set for their shared transform path while using `createVatInstanceSet` for animation helpers.

## VAT Sockets and Attachments

Bake named animated sockets once, then bind a separate instanced weapon to each stable VAT character ID. The attachment controller reads the same clip, phase offset, FPS override, and clock as `VatInstanceSet`, so attachments remain on the rendered VAT frame.

```ts
import {
  bakeVatSocketAsset,
  createInstanceSet,
  createVatAttachmentController,
  createVatInstanceSet
} from "@litools/instancer";

const characters = createVatInstanceSet(engine, characterMesh, animations);
const sockets = bakeVatSocketAsset(engine, sourceAnimations, {
  clips: characters.clips,
  sockets: { sword: "RightHand" }
});
const swords = createInstanceSet(swordMesh, { engine, capacity: 100 });
const attachments = createVatAttachmentController({
  characters,
  attachments: swords,
  socketAsset: sockets,
  socket: "sword"
});

attachments.bind(characterId, swordId, { gripOffset });

// Every frame, after characters.update(deltaSeconds):
attachments.update();
```

`attachments` accepts the shared `BaseInstanceSet` contract, so the controller works with either a single mesh from `createInstanceSet()` or an entire attachment GLB from `createHierarchyInstanceSet()`.

For a full character GLB, a full weapon GLB, and a preset exported by the configurator, use `createVatAttachmentBinding()`. It preserves the attachment's authored root transform, applies the configured grip, and provides the hierarchy set plus controller as one lifecycle unit:

```ts
import { createVatAttachmentBinding, createVatCharacterSet } from "@litools/instancer";

const heroes = createVatCharacterSet(engine, characterRoot, animations, { capacity: 300 });
const sword = createVatAttachmentBinding({
  engine,
  character: heroes,
  attachmentRoot: swordRoot,
  socketAsset,
  preset
});

const heroId = heroes.create({ clip: "Idle" });
const swordId = sword.create();
sword.bind(heroId, swordId);

// Each frame, in this order:
heroes.update(deltaSeconds);
sword.update();
```

`VatAttachmentPreset` is a portable, side-effect-free JSON shape containing asset references, socket node index/name/key, and grip translation, Euler-degree rotation, and XYZ scale. Use `serializeVatAttachmentPreset()` to save it. Local uploads retain only a filename placeholder; binary GLB data and temporary blob URLs are never embedded. When replacing a preview or level, release its containers and wrappers with `disposeVatGlbAssets({ scene, containers, disposables })` after nothing active still shares them.

For explicit bundle boundaries, use `@litools/instancer/core`, `@litools/instancer/vat`, `@litools/instancer/animation`, and `@litools/instancer/vat-sockets`. The root import remains fully supported. `@litools/instancer/animation` exports the pure socket sampler without the Babylon Lite baker adapter.

`bakeVatSocketAsset` temporarily uses Babylon Lite's private animation-controller world-matrix buffer. This adapter is isolated and will be replaced when Lite exposes public VAT-frame socket capture.

## Cleanup

Dispose an instance set when it is no longer needed:

```ts
boxes.dispose();
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
- Ready Player VAT Sword Sync and Samba Girl VAT Sword Sync: attachment synchronization across single- and multi-part VAT characters.
- GLB VAT Socket Configurator: select an animated socket, tune an attachment GLB, and export a JSON preset plus TypeScript setup.
- Unarmed VAT Arena Crowd: three independent VAT groups with nine selected clips and density modes from 300 to 3,000 characters.
- Thin Instance Outline Gallery: primitives, imported GLB/glTF hierarchies, live skeletal outlines on the animated Vintage Desk Fan, stable-ID and raw-index selection, smoothing, and animated effects.

See the [examples guide](https://github.com/eldinor/lite-instancer/blob/main/About_Examples.md) for a fuller explanation of every example, and [extended examples](https://github.com/eldinor/lite-instancer/blob/main/About_Examples_Extended.md) for important code snippets from each one.

## Docs

The npm package includes this main README and the changelog; additional documentation remains available in the repository:

- [Full documentation](https://github.com/eldinor/lite-instancer/blob/main/docs/README.md)
- [Practical user guide](https://github.com/eldinor/lite-instancer/blob/main/User_Guide.md)
- [Examples guide](https://github.com/eldinor/lite-instancer/blob/main/About_Examples.md)
- [Extended examples and code snippets](https://github.com/eldinor/lite-instancer/blob/main/About_Examples_Extended.md)
- [Architecture and internal concepts](https://github.com/eldinor/lite-instancer/blob/main/How_It_Works.md)
- [Changelog](https://github.com/eldinor/lite-instancer/blob/main/CHANGELOG.md)

Generate TypeDoc API reference:

```sh
npm run docs
```

TypeDoc writes generated HTML to `docs/api`.
