# Babylon.js API Compatibility

This repository publishes two independent implementations with intentionally similar application APIs:

- `@litools/instancer` — Babylon Lite
- `@litools/instancer-babylonjs` — Babylon.js

Neither package imports runtime code from the other.

| Capability | Babylon.js status | Notes |
| --- | --- | --- |
| Stable `InstanceId` lifecycle | Identical | IDs survive slot swaps, visibility changes, and growth. |
| Single-mesh instance sets | Identical | Babylon.js uses dynamic native thin-instance buffers while preserving world-space API transforms under authored mesh parents. |
| Metadata and iteration | Identical | Same method names and logical behavior. |
| Visibility strategies | Identical | Supports `active-count` and `scale-zero`. |
| Colors and raw editing | Identical | Backed by Babylon.js thin-instance attributes. |
| Slot-aligned streams | Identical behavior | Each package owns its runtime implementation; shared contracts enforce slot lifecycle and dirty-range behavior. |
| Bulk lifecycle work | Identical behavior | Creation, removal, visibility, and coordinated character operations batch count and range updates. |
| Bounds policy | Babylon.js extension | Supports automatic scans, explicit manual refresh, and conservative fixed aggregate AABBs; fixed bounds should include VAT displacement. |
| Picking registry | Engine-adapted | Temporarily enables `thinInstanceEnablePicking`. |
| Screen-space picking | Engine-adapted | Uses the Babylon.js camera transformation matrix and can derive rendered centers from authored mesh transforms. |
| Rigid hierarchy sets | Engine-adapted | Synchronizes one logical slot layout while adapting GPU matrices independently for each authored child transform. |
| VAT instance sets | Engine-adapted | Uses `VertexAnimationBaker`, `BakedVertexAnimationManager`, persistent playback storage, and native partial range uploads. |
| VAT playback batching | Identical | Supports atomic playback updates, bulk updates, nested batching, and forced synchronization. |
| VAT character sets | Engine-adapted | Coordinates native VAT sets per skinned mesh and batches mirrored lifecycle/playback changes. |
| `gpuCulling` option | Unsupported | Babylon.js has no equivalent opt-in switch; passing `true` throws. |
| VAT socket sampling/controller | Engine-adapted | Portable socket assets can drive rigid Babylon.js attachment sets. |
| VAT socket baking and GLB binding | Engine-adapted | Captures Babylon.js `AnimationGroup` node transforms in model space and binds rigid GLB hierarchies through portable attachment presets. |
| Portable full VAT asset envelope | Engine-adapted | Shares versioned clips, basis, sockets, animated bounds, source metadata, validation, and integrity semantics while using a Babylon.js-specific `babylon-matrix-vat` payload, bounded offline baking, and a no-resampling runtime loader. |
| VAT preprocessing CLI | Next package update | Planned as a separate heavy-tooling surface for GLB bake, inspect, and validate workflows; it will not enter the runtime package. |
| Capability/control descriptors | Identical behavior | Reports Babylon.js backend/runtime paths and exposes the same frozen VAT control names and stable-ID value adapter as Lite, without an Explorer dependency. |
| Per-instance outlines | Planned | Babylon.js whole-mesh outline layers cannot isolate one thin instance. |

## Migration

For supported rigid workflows, change the import and retain the instance-set calls:

```ts
import { createInstanceSet } from "@litools/instancer-babylonjs";
```

Engine-owned objects remain engine-specific. Pass a Babylon.js `Mesh`, `Camera`, `AbstractEngine`, and Babylon.js pick result to the Babylon.js package.
