# @litools/instancer-babylonjs

Stable IDs, pooling, picking, visibility, metadata, and batch updates for Babylon.js thin instances.

```sh
npm install @litools/instancer-babylonjs @babylonjs/core
```

```ts
import { createInstanceSet } from "@litools/instancer-babylonjs";

const boxes = createInstanceSet(boxMesh, {
  capacity: 500,
  colors: true,
  visibleStrategy: "active-count"
});

const id = boxes.create({ position: [0, 1, 0] }, { selected: false });
boxes.setVisible(id, false);
```

Transforms passed to the public API are world-space transforms. Imported GLB
root scale/rotation and authored mesh parents are preserved automatically in
the Babylon.js GPU matrices.

For logical picking against an imported or VAT mesh, derive the same rendered
center used by the adapter:

```ts
import { getInstanceSetWorldCenter } from "@litools/instancer-babylonjs";

const center = getInstanceSetWorldCenter(boxes, id);
```

The public API intentionally follows `@litools/instancer` for Babylon Lite. The Babylon.js package currently includes rigid single-mesh and hierarchy sets, picking, native VAT instance/character sets, portable VAT socket sampling, and stable-ID attachment control.

Matrix, color, and VAT playback changes are collected by slot and uploaded through Babylon.js native partial-buffer updates. Bulk creation/removal and nested batches coalesce adjacent ranges. VAT users can update multiple playback fields atomically:

```ts
vat.batchPlayback(() => {
  vat.setPlayback(firstId, { clip: "Run", offset: 0.25, fps: 30 });
  vat.setPlayback(secondId, { offset: 0.5 });
});
```

Bounds maintenance defaults to `"auto"`. For applications that already own conservative bounds, avoid Babylon.js population scans with fixed mesh-local aggregate bounds:

```ts
const crowd = createInstanceSet(mesh, {
  capacity: 1500,
  boundsMode: "fixed",
  fixedBounds: {
    minimum: [-50, -5, -50],
    maximum: [50, 20, 50]
  }
});
```

Use `boundsMode: "manual"` and call `crowd.refreshBounds()` after coordinated changes when bounds are dynamic but do not need to be recalculated after every batch. VAT and character sets expose the same method. Fixed bounds must conservatively cover the complete rendered population, including animation displacement.

## Offline VAT assets

Bake once during preprocessing, store the deterministic JSON manifest and binary payload, then create runtime instances without replaying animation frames:

```ts
import {
  bakeBabylonVatAsset,
  createVatInstanceSetFromAsset,
  decodeBabylonVatAsset,
  encodeBabylonVatAsset
} from "@litools/instancer-babylonjs/vat";

// Preprocessing step after loading the source GLB in Babylon.js:
const asset = bakeBabylonVatAsset(skinnedMesh, animationGroups, {
  bounds: animatedBounds,
  sockets: socketAsset,
  source: { name: "hero.glb", hash: sourceHash }
});
const { manifest, payload } = encodeBabylonVatAsset(asset);

// Runtime step after loading the matching mesh:
const decoded = decodeBabylonVatAsset(manifestText, payloadBuffer);
const modelBounds = decoded.bounds?.model;
const crowd = createVatInstanceSetFromAsset(engine, skinnedMesh, decoded, {
  capacity: 1000,
  ...(modelBounds ? {
    boundsMode: "fixed",
    fixedBounds: { minimum: modelBounds.min, maximum: modelBounds.max }
  } : {})
});
```

The envelope keeps clips, coordinate basis, sockets, animated bounds, source metadata, and integrity validation portable. Its `babylon-matrix-vat` binary layout is deliberately Babylon.js-specific and is not interchangeable with the Lite `lite-matrix-rgba32float` payload. Default preprocessing limits reject excessive model, bone, animation, frame, and atlas sizes; pass explicit `limits` only for trusted larger inputs.

## Capabilities and control descriptors

Inspect supported paths through public Babylon.js engine capabilities:

```ts
import { inspectInstancerCapabilities } from "@litools/instancer-babylonjs";

const capabilities = inspectInstancerCapabilities(engine);
// capabilities.partialVatUploads === true
// capabilities.supportedVatEncodings === ["babylon-matrix-vat"]
```

VAT control descriptors use the same names and behavior as Lite. They are frozen metadata with no editor dependency, global registration, renderer work, or state writes:

```ts
import {
  createVatInstanceControlAdapter,
  defineVatInstanceControls
} from "@litools/instancer-babylonjs/vat";

const controls = defineVatInstanceControls(vat, {
  equipment: ["Sword", "Shield"],
  sockets: ["RightHand", "LeftHand"]
});

const values = createVatInstanceControlAdapter(vat);
values.set(instanceId, "visible", false);
values.set(instanceId, "speed", 24);
```

The package intentionally does not provide or register a Babylon.js Explorer adapter. Applications can consume the descriptors in their own UI or tooling.

```ts
import { createHierarchyInstanceSet } from "@litools/instancer-babylonjs";
import { createVatInstanceSet } from "@litools/instancer-babylonjs/vat";
```

See the repository's `BABYLONJS_COMPATIBILITY.md` for exact parity and planned engine-specific work.

## Examples

Open the examples gallery, which links every Babylon.js example from one page:

```sh
npm run dev
```

Run only the rigid single-mesh example with live stable-ID, slot-compaction, visibility, and growth diagnostics:

```sh
npm run dev:basic
```

Run the separate rigid-hierarchy example, where picking any child mesh resolves to one hierarchy-level ID:

```sh
npm run dev:hierarchy
```

Run the Babylon.js-native VAT example with per-instance phase/FPS controls and logical screen-space picking:

```sh
npm run dev:vat
```

Run the multi-part VAT character example using the same local `Unarmed.glb` asset as the Lite instancer arena:

```sh
npm run dev:vat-character
```

Run the Samba Girl VAT socket example with the Lite examples' fantasy sword:

```sh
npm run dev:vat-attachments
```

## Manual benchmark

From the repository root, run the standalone release check and open the URL printed by Vite:

```sh
npm run dev:babylonjs:benchmark
```

The page is separate from the examples gallery. It performs short 100, 500, 1,000, and 1,500 population passes, compares automatic and fixed bounds, reports bounds-refresh CPU time, locks camera input while measuring, checks lifecycle behavior, and produces a copyable JSON report. It does not require Playwright.

## Manual VAT asset smoke check

Run the standalone bake/codec/runtime comparison page:

```sh
npm run dev:babylonjs:vat-asset-smoke
```

The page renders runtime-baked and encoded/decoded paths side by side, validates deterministic payloads, clips, sockets, animated bounds, no-resampling loading, colors, active-count visibility, growth, removal, playback parity, and disposal, and provides a copyable report. Use `?backend=webgpu` to request WebGPU; WebGL is the default. The check is intentionally small and does not require Playwright.
