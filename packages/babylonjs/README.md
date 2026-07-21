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
