# Shado Findings for Lite Instancer

Research date: 2026-07-21  
Reviewed package: [`@knervous/shado` 1.0.5](https://www.npmjs.com/package/@knervous/shado)

## Executive Summary

The useful lesson from Shado is not to replace Lite Instancer with Shado. It is to make slot-aligned instance data a first-class abstraction, then build VAT, custom attributes, culling, and tooling on top of it.

Shado is a broad Babylon.js toolkit combining:

- Declarative packed GPU structures shared between TypeScript, GLSL/WGSL, storage buffers or data textures, and optional AssemblyScript.
- Dirty-page tracking and partial GPU uploads.
- Dual-quaternion VAT preprocessing and runtime worker baking.
- Per-instance shader customization through named hooks.
- Frustum culling and compact visible-index lists.
- Described or published properties for inspectors and generated UI.
- Packed AoS/SoA formats for network snapshots and WASM/GPU consumption.

The package is a useful architectural reference, but it should not currently become a Lite Instancer runtime dependency. It targets full `@babylonjs/core` 9.x, overlaps much of Lite Instancer's scope, and its newly scoped package was published only on July 20–21, 2026.

Relevant upstream references:

- [Shado package on npm](https://www.npmjs.com/package/@knervous/shado)
- [Shado repository directory](https://github.com/knervous/eqrequiem/tree/main/shader-object)
- [Shado source tree](https://github.com/knervous/eqrequiem/tree/main/shader-object/src)
- [Packed network-layout design](https://github.com/knervous/eqrequiem/blob/main/shader-object/AOS-NET-DESIGN.md)

## Best Opportunities for Lite Instancer

| Shado idea | Lite Instancer opportunity | Priority |
| --- | --- | --- |
| Schema-driven packed fields | Add a lightweight `InstanceStream` or custom-attribute API whose values automatically follow slot swaps, removal, visibility packing, and growth | Highest |
| Dirty ranges/pages | Update only changed VAT playback or custom-data slots instead of reconstructing every instance parameter | Highest |
| Offline and worker VAT baking | Add prebaked portable VAT artifacts, worker-assisted packing, and optional half-float/DQ formats | High |
| Published property descriptors | Generate Explorer controls for clips, speed, tint, equipment, visibility, and similar properties without exposing packed internals | Medium |
| Conservative VAT culling | Add per-clip or whole-animation bounds, followed later by visible-index compaction if Babylon Lite supports it | Medium |
| Stable shader insertion hooks | Allow custom per-instance visual fields without requiring consumers to rewrite generated VAT or outline shaders | Medium |

## 1. Slot-Aligned Instance Streams

Lite Instancer's strongest feature is its stable-ID contract. Applications retain an `InstanceId` while the library manages changing renderer slots through `InstanceSlotStore`.

Shado suggests generalizing the data that follows those slots. A stream API might look like:

```ts
const heat = set.createStream("heat", {
  components: 1,
  default: [0]
});

heat.set(id, [0.8]);
```

Every registered stream would automatically respond to:

- Slot swaps.
- Removal compaction.
- Active-count visibility packing.
- Capacity growth.
- Batch boundaries.
- Raw dirty-slot edits.

This could generalize several currently separate concerns:

- Instance matrices.
- Per-instance colors.
- VAT playback parameters.
- Selection and highlighting flags.
- Equipment or material variant indices.
- Future application-defined shader data.

The implementation should remain substantially lighter than Shado's general schema system. Lite Instancer does not need decorators, class overlays, runtime code generation, or a universal CPU/GPU ABI to gain the slot-alignment benefit.

## 2. Dirty VAT Playback Uploads

The clearest immediate inefficiency is VAT playback synchronization. Logical state is kept in a stable-ID `Map`, but synchronization allocates a new `count * 4` `Float32Array` and reconstructs every slot before calling `handle.setInstances()`.

A Shado-inspired implementation would:

1. Keep the stable-ID `Map` as canonical state.
2. Maintain one capacity-sized slot buffer.
3. Rewrite only slots affected by clip, phase, or FPS changes.
4. Rewrite both affected slots after a slot swap.
5. Accumulate dirty ranges during a batch.
6. Upload only dirty ranges when Babylon Lite exposes an appropriate partial-update boundary.

Even if Babylon Lite currently requires a full upload, retaining and incrementally updating the CPU buffer would remove repeated allocation and full parameter reconstruction. Partial GPU upload support could then be added without changing the public API.

This direction fits the dirty-slot machinery that Lite Instancer already uses for ordinary and hierarchy instance updates.

## 3. VAT Artifact and Baking Pipeline

Shado's most compelling concrete feature is its VAT build pipeline:

- Offline model packing and manifests.
- Headless worker baking.
- Transferable buffers rather than cloned scene data.
- Dual-quaternion packing.
- Automatic scalar, SIMD128, and relaxed-SIMD WASM kernel selection.
- Half-float output where acceptable.
- Scale detection and rejection of unsupported anisotropic rigs.

Lite Instancer can adopt this incrementally:

1. Define a versioned, engine-neutral `LiteVatAsset` serialization format.
2. Include clips, texture data, socket tracks, animated bounds, precision, coordinate basis, and source metadata.
3. Add offline load and save support before attempting full worker baking.
4. Move numeric packing and float conversion into a worker.
5. Move skeleton sampling off-thread only if Babylon Lite gains a suitable headless animation runtime.
6. Include socket tracks in the same artifact so runtime consumers do not need private animation-controller state.

A possible high-level shape is:

```ts
interface LiteVatAsset {
  version: 1;
  basis: "gltf-rh-model-world";
  precision: "float16" | "float32";
  encoding: "matrix" | "dual-quaternion";
  clips: Record<string, LiteVatClip>;
  texture: LiteVatTextureData;
  sockets?: LiteVatSocketAsset;
  bounds?: LiteVatBounds;
  source?: LiteVatSourceMetadata;
}
```

The exact shape should be driven by Babylon Lite's public VAT contracts and tested against existing single-mesh, multi-part character, and attachment examples.

## 4. VAT Culling

Lite Instancer currently disables GPU culling for VAT by default because animated vertices can escape the rest-pose bounds. That is the correct safe default.

Shado demonstrates a possible path forward:

- Bake conservative bounds for each clip or the entire animation atlas.
- Transform those bounds by each instance transform.
- Cull against conservative animated bounds rather than rest-pose geometry.
- Optionally build a compact visible-index list instead of moving logical state.

This should remain a later optimization. It depends on suitable Babylon Lite renderer support and should be justified by profiling realistic crowd scenes. The first useful deliverable is animated bounds in the proposed VAT artifact, even if CPU or GPU culling does not consume them immediately.

## 5. Published Controls and Explorer Integration

Shado can place a friendly, validated facade over packed numeric fields. For example, a numeric armor index can be presented to tools as named choices such as `armorless`, `leather`, `chain`, and `plate`.

Lite Instancer could use a smaller descriptor system for its Explorer/editor integrations:

```ts
const controls = defineInstanceControls({
  clip: {
    type: "enum",
    values: clips.map((clip) => clip.name)
  },
  speed: {
    type: "number",
    min: 0,
    max: 3,
    step: 0.05
  },
  visible: {
    type: "boolean"
  }
});
```

Descriptors could carry labels, descriptions, groups, ranges, enum values, and optional socket associations. They should adapt existing instance-set methods rather than make packed fields the application's source of truth.

This would be especially helpful for `babylon-lite-explorer` integration and the existing Instancer Explorer plans.

## 6. Stable Shader Extension Hooks

Shado exposes named shader insertion points rather than asking subclasses or applications to search and replace generated shader source. The important lesson is the stability of the extension boundary, not Shado's particular shader generator.

Potential Lite Instancer hooks could cover:

- Per-instance vertex declarations.
- Per-instance setup after slot data is available.
- Post-position vertex changes.
- Fragment declarations.
- Final surface-color adjustment.

This could support heat/tint effects, selection flags, equipment variants, dissolve effects, and outline-related customization. It should only be introduced where Babylon Lite provides a stable material or shader extension contract; Lite Instancer should avoid becoming a general material framework.

## 7. Packed Network and WASM Layouts

Shado's network-layout work is technically interesting: fixed schemas can emit AoS views for commands and SoA planes for snapshots, backed by `ArrayBuffer`, `SharedArrayBuffer`, or WASM memory. The same payload can then be consumed without constructing a JavaScript object per record.

This is not an immediate Lite Instancer responsibility. It may become relevant for:

- Snapshot and restore APIs.
- Networked crowd state.
- Worker simulation feeding render streams.
- ECS or simulation bridges.

Lite Instancer should first expose stable stream and snapshot boundaries. A separate integration package could later map an external packed snapshot into those streams.

## What Not to Adopt

Do not add `@knervous/shado` as a Lite Instancer runtime dependency at this stage:

- It targets full `@babylonjs/core` 9.x rather than `@babylonjs/lite`.
- Its root API overlaps instancing, VAT, picking, materials, preprocessing, and rendering.
- Its decorator and class-overlay model is heavier than Lite Instancer's factory-and-interface style.
- Runtime AssemblyScript compilation is too specialized for the default package.
- The scoped package is extremely new and its public documentation still contains traces of the former package name.
- Lite Instancer's stable application-level IDs should remain the primary contract; packed actor positions or GPU indices must not leak into application state.

Optional build-time tools or isolated algorithms could still be evaluated independently, subject to license review, tests, and compatibility with Babylon Lite.

## Recommended Roadmap

### Phase 1: Playback-stream prototype

- Introduce an internal capacity-sized VAT playback buffer.
- Track dirty playback slots.
- Update slot data incrementally across clip, phase, FPS, visibility, removal, and slot-swap operations.
- Benchmark allocations, CPU time, and upload volume in Massive Avatar Arena.

### Phase 2: General slot-aligned stream abstraction

- Extract the proven playback mechanism into an internal `SlotAlignedStream`.
- Add slot-store notifications or a backend callback collection for swaps and growth.
- Validate it with color and playback streams before considering a public API.

### Phase 3: Portable VAT artifacts

- Specify and version `LiteVatAsset`.
- Serialize VAT texture data, clips, sockets, basis information, precision, and animated bounds.
- Add validation, round-trip tests, and compatibility fixtures.
- Add an offline preprocessing command or standalone package.

### Phase 4: Worker packing

- Transfer sampled matrices to a worker.
- Implement matrix/DQ packing and float16 conversion off-thread.
- Evaluate WASM only after measuring the TypeScript worker implementation.

### Phase 5: Tooling and rendering extensions

- Add optional published-control descriptors for Explorer integrations.
- Explore stable custom-shader hooks.
- Prototype conservative VAT culling only after animated bounds and profiling are available.

## Suggested First Experiment

Implement a small internal `SlotAlignedStream` used only for VAT playback parameters. Measure it in Massive Avatar Arena against the current implementation using:

- Allocations per clip, phase, and FPS change.
- CPU time for single-instance and batched changes.
- Bytes prepared and uploaded.
- Correctness after visibility changes, removal, growth, and slot swaps.
- Behavior across single-mesh and multi-part VAT character sets.

If the experiment materially reduces allocation or synchronization cost without complicating the stable-ID API, promote it into a reusable custom-stream design. After that, a versioned prebaked VAT artifact is likely to deliver the largest startup, portability, and tooling improvement.

---

# Babylon.js Instancer Assessment

The separate `@litools/instancer-babylonjs` implementation is a substantially better target for Shado-inspired work than the Babylon Lite implementation. Both projects use Babylon.js 9.x, and the Babylon.js adapter already has the native mechanisms required for partial updates of custom thin-instance buffers.

The recommended approach is still to borrow focused designs rather than depend on Shado's runtime. Shado and the Babylon.js instancer both want to own instancing, VAT, picking, rendering, and parts of the material pipeline, so a wholesale integration would create unclear ownership and a large overlapping API surface.

## Strongest Immediate Improvement

The Babylon.js adapter already coalesces dirty matrix and color slots and uploads the resulting ranges through `thinInstancePartialBufferUpdate()`.

VAT currently takes a less efficient path:

- It allocates a new `count * 4` array on every playback synchronization.
- It reconstructs playback values for every live slot.
- It rebinds the complete `bakedVertexAnimationSettingsInstanced` buffer through `thinInstanceSetBuffer()`.

Babylon's partial-update API accepts an arbitrary buffer-kind string, so the VAT attribute can use the same dirty-range strategy as matrices and colors:

```ts
mesh.thinInstancePartialBufferUpdate(
  "bakedVertexAnimationSettingsInstanced",
  dirtyCount,
  firstDirtySlot
);
```

The current private matrix/color machinery can be generalized into an internal slot-aligned stream:

```ts
const playback = streams.create(
  "bakedVertexAnimationSettingsInstanced",
  4
);
```

Expected behavior:

- `setClip`, `setPhaseOffset`, and `setFps` dirty one slot.
- A slot swap dirties both affected slots.
- Batched operations coalesce adjacent dirty ranges.
- Creation and capacity growth establish or rebind the underlying buffer.
- Removal updates only moved slots and the draw count.
- Changing the shared clip dirties instances that do not have an explicit clip override.

This is relatively low risk because the required update path is already proven by the adapter's matrix and color buffers.

## VAT Preprocessing Is the Largest Product Opportunity

The current Babylon.js VAT baker advances every animation frame by rendering the live scene. This is synchronous, can be expensive for large animation libraries, and temporarily manipulates animation state in the consumer's scene.

Shado's headless worker pipeline is more directly applicable here than it is to Babylon Lite. Full Babylon.js provides `NullEngine`, GLB loaders, skeleton evaluation, and native VAT utilities that can run in a dedicated worker.

Recommended progression:

1. Define a portable `BabylonVatAsset`.
2. Add `createVatInstanceSetFromAsset()` alongside the current live-baking factory.
3. Provide an offline command that loads a GLB, samples its animations, and emits the artifact.
4. Add an optional browser worker for user-supplied GLBs.
5. Retain live-scene baking as a compatibility fallback.

The first artifact version should preserve Babylon's native matrix VAT encoding:

```ts
interface BabylonVatAsset {
  version: 1;
  encoding: "babylon-matrix-vat";
  clips: Record<string, VatClip>;
  frameData: Float32Array;
  boneCount: number;
  sockets?: VatSocketAsset;
  bounds?: VatAnimatedBounds;
}
```

Shado's dual-quaternion and float16 encodings should remain later experiments. They require custom shader ownership and would no longer be a straightforward integration with Babylon's native `BakedVertexAnimationManager`.

## Possible Build-Time Shado Interoperability

The Babylon version ranges are compatible:

- `@litools/instancer-babylonjs` uses `@babylonjs/core` `^9.17.0`.
- Shado 1.0.5 uses `@babylonjs/core` `^9.5.0`.

A build-time experiment could therefore use selected Shado preprocessing or worker functionality without making Shado part of the public runtime API. Its generated artifacts are designed primarily for Shado's own actor containers and DQ/VAT shaders, however, so direct artifact compatibility should not be assumed.

A safer boundary would be:

```text
Shado or custom build tool
        ↓
neutral sampled animation matrices
        ↓
Litools Babylon VAT encoder
        ↓
BabylonVatAsset
```

This keeps Shado's decorators, actor schema, packed arena, and shader material outside the Instancer contract.

## Shader Hooks and Per-Instance Outlines

Shado's named shader hooks are a good architectural idea, but the Babylon.js adapter currently preserves the mesh's native material pipeline. Taking ownership of the material would make the instancer responsible for PBR compatibility, shadows, depth passes, WebGL/WebGPU variants, and application-defined materials.

Shader extensions should therefore remain optional and separate from the core stable-ID and pooling package.

Babylon.js 9.17 contains `ThinSelectionOutlineLayer`, but its public selection model operates on meshes or mesh groups rather than a stable individual thin-instance ID. Two stronger approaches for this package are:

- Port the Lite implementation's compact duplicate-outline pool to Babylon.js.
- Add an optional selection-ID attribute and dedicated outline pass.

The compact outline pool is likely the safer first implementation. It preserves arbitrary host materials and naturally copies only selected stable IDs into a small secondary draw.

## Culling

The current compatibility document correctly marks GPU culling as unsupported by the Babylon.js adapter.

Shado's solution relies on its own packed actor container, compact visible-index list, and custom rendering path. Importing that approach would effectively replace native Babylon thin instances rather than extend them.

Near-term culling work should instead focus on:

- Baking conservative animated bounds into VAT artifacts.
- Optional CPU frustum or distance filtering for relatively static visibility sets.
- Avoiding per-frame active-count slot shuffling.
- Revisiting GPU visible-index indirection only if Babylon.js exposes a suitable native contract.

## Cross-Package Design

The proposed stream abstraction should be shared conceptually across both packages while allowing different upload implementations:

```text
Stable IDs and slot lifecycle
          ↓
SlotAlignedStream<T>
     ↙              ↘
Babylon Lite       Babylon.js
full upload        partial ranges
when required      immediately
```

The packages can remain independent at runtime while maintaining matching interfaces and cross-engine contract tests. Good first stream consumers are:

1. Babylon.js VAT playback.
2. Babylon.js colors, migrated from the specialized implementation after the abstraction proves itself.
3. Babylon Lite VAT playback.
4. Optional application-defined per-instance attributes.

## Babylon.js Recommended Priority

1. Implement partial VAT playback updates in the Babylon.js adapter.
2. Define `BabylonVatAsset` and add `createVatInstanceSetFromAsset()`.
3. Add offline and headless-worker VAT baking.
4. Port the compact per-instance outline pool.
5. Add optional Explorer property descriptors.
6. Consider custom shader hooks and alternative DQ encoding only after profiling demonstrates a need.
