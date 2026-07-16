# About Examples

This project includes examples that show the main ways to use `@litools/instancer` with Babylon Lite.

For API-focused code snippets and usage notes, see `About_Examples_Extended.md`.

For the package concepts used by these examples, see `How_It_Works.md`.

Run the examples with one dev server:

```sh
npm run dev
```

Then open the examples index at:

```text
http://localhost:5173/
```

## Basic Thin Instances

Path: `/examples/basic-thin-instances/`

Shows the smallest useful `InstanceSet` workflow with one primitive mesh. It demonstrates stable numeric IDs, per-instance transforms, colors, removal, and adding new instances after the set is already running.

Use this example first when checking the core API shape.

## Primitive Box Field

Path: `/examples/primitive-box-field/`

Shows many box instances updated as a field. It focuses on batched transform updates, per-instance colors, picking, and selection with a simple primitive mesh.

This is the most direct example for ordinary rigid thin instances.

## Primitive Sphere Cloud

Path: `/examples/primitive-sphere-cloud/`

Shows sphere instances driven by metadata. The example uses metadata to organize motion and group behavior, including visibility toggles.

Use it when you want to see app-level data attached to instance IDs.

## Primitive Mixed Playground

Path: `/examples/primitive-mixed-playground/`

Shows boxes, spheres, and cylinders managed by separate `InstanceSet`s in one scene. One picking flow resolves clicks across all sets, while each primitive type keeps its own capacity, visibility, metadata, stable IDs, and colors.

It also has a strategy switch for comparing `active-count` and `scale-zero` visibility.

## Visibility Layers

Path: `/examples/visibility-layers/`

Shows the two visibility strategies:

- `active-count` packs visible instances at the front of the GPU buffer.
- `scale-zero` keeps slots more stable by writing zero-scale matrices.

This example is useful for understanding why slots can move while stable IDs remain correct.

## Raw Batch Streaming

Path: `/examples/raw-batch-streaming/`

Shows high-frequency updates with `batch` and controlled `editRaw` access. It is for cases where ordinary per-ID setters are clear enough, but you also want to see the lower-level fast path for matrix and color buffers.

Use this when performance and buffer-writing patterns matter.

## BoomBox Grid

Path: `/examples/boombox-grid/`

Loads the BoomBox GLB and creates a grid of logical BoomBox instances from a hierarchy. Each BoomBox is treated as one app object even though the source asset contains child meshes.

It demonstrates hierarchy instancing, picking, add/remove controls, and stable IDs for loaded GLB content.

## BoomBox Picker

Path: `/examples/boombox-picker/`

Focuses on GLB hierarchy picking. It resolves a clicked child mesh and thin-instance index back to the correct stable logical BoomBox ID, then removes the selected object.

This example exists because hierarchy picking is more subtle than primitive picking.

## BoomBox Rebuild Growth

Path: `/examples/boombox-rebuild-growth/`

Shows `grow: "rebuild"` for hierarchy pools. When capacity is exceeded, the hierarchy pool is rebuilt while app-level IDs, metadata, transforms, visibility, and selection survive.

It also demonstrates a practical hybrid picking strategy for hierarchy instances.

## Shark School Shared Animation

Path: `/examples/shark-school-shared-animation/`

Loads the animated shark GLB and shows many VAT-backed instances sharing one animation phase. The instances still behave like app objects with stable IDs, visibility, selection, picking, and batched transforms.

Use this as the simplest animated GLB example.

## Shark Phase Buckets

Path: `/examples/shark-phase-buckets/`

Shows per-instance animation variation on top of one VAT-backed shark mesh. Each instance can have different phase and fps offsets, so the group does not look synchronized.

Use this example when many animated instances should feel more natural without separate animated meshes.

## Shark Clip Mixer

Path: `/examples/shark-clip-mixer/`

Shows per-instance VAT clip assignment. Selected instances can switch animation clips while the school continues to animate, move, and support picking.

This is the most complete animated example and demonstrates clip, phase, fps, visibility, and selection together.

## Ready Player VAT Sword Sync

Path: `/examples/xbot-vat-sword-sync/`

Shows a VAT character with a rigid sword synchronized to an animated right-hand socket. It is the compact reference for the attachment-controller update order: update the character VAT playback first, then update the attachment controller.

## Samba Girl VAT Sword Sync

Path: `/examples/samba-girl-vat-sword-sync/`

Shows the same socket workflow on the multi-part HVGirl GLB. It is useful for checking that synchronized secondary VAT meshes and glTF-to-Lite transform handling remain correct.

## GLB VAT Socket Configurator

Path: `/examples/glb-vat-socket-configurator/`

Loads Ready Player or Samba Girl, or a local character GLB, alongside the curated Fantasy Sword or a local attachment GLB. It lists sockets animated in every clip, previews one or five characters with phase/FPS variation, exposes numeric grip translation/rotation/scale controls, and exports a portable `VatAttachmentPreset` JSON plus matching TypeScript setup.

## Unarmed VAT Arena Crowd

Path: `/examples/unarmed-vat-arena/`

Builds a 3,000-capacity local-GLB arena from three independently baked VAT groups of up to 1,000 fighters each. It deliberately bakes only nine named clips from `Unarmed.glb`, offers density modes from 300 through 3,000, and uses `scale-zero` visibility so instance/animation slots remain aligned.

## Shared Example Code

Path: `/examples/shared/`

This folder is not an example. It contains shared setup for the examples: scene creation, camera, lights, the debug panel, picking helpers, materials, and common styles.
