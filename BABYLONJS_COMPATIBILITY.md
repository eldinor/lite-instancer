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
| Picking registry | Engine-adapted | Temporarily enables `thinInstanceEnablePicking`. |
| Screen-space picking | Engine-adapted | Uses the Babylon.js camera transformation matrix and can derive rendered centers from authored mesh transforms. |
| Rigid hierarchy sets | Engine-adapted | Synchronizes one logical slot layout while adapting GPU matrices independently for each authored child transform. |
| VAT instance sets | Engine-adapted | Uses `VertexAnimationBaker` and `BakedVertexAnimationManager`. |
| VAT character sets | Engine-adapted | Coordinates one native VAT set per skinned mesh and exposes stable-ID, iteration, position, and metadata helpers directly. |
| `gpuCulling` option | Unsupported | Babylon.js has no equivalent opt-in switch; passing `true` throws. |
| VAT socket sampling/controller | Engine-adapted | Portable socket assets can drive rigid Babylon.js attachment sets. |
| VAT socket baking and GLB binding | Engine-adapted | Captures Babylon.js `AnimationGroup` node transforms in model space and binds rigid GLB hierarchies through portable attachment presets. |
| Per-instance outlines | Planned | Babylon.js whole-mesh outline layers cannot isolate one thin instance. |

## Migration

For supported rigid workflows, change the import and retain the instance-set calls:

```ts
import { createInstanceSet } from "@litools/instancer-babylonjs";
```

Engine-owned objects remain engine-specific. Pass a Babylon.js `Mesh`, `Camera`, `AbstractEngine`, and Babylon.js pick result to the Babylon.js package.
