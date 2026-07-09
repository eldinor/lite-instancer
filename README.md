# @litools/instancer

Stable IDs, pooling, picking, visibility, metadata, and batch updates for Babylon Lite thin instances and hierarchy instance pools.

See [PLAN.md](./PLAN.md) for the working product plan and examples.

Run examples with one dev server:

```sh
npm run dev
```

Then open the root index page and choose a demo from the links.

```ts
import { createHierarchyInstanceSet } from "@litools/instancer";

const boomboxes = createHierarchyInstanceSet(root, {
  capacity: 128,
  grow: "rebuild",
  visibleStrategy: "active-count"
});

const id = boomboxes.create({
  position: [0, 0, 0],
  scale: 1
}, {
  label: "hero"
});

boomboxes.setVisible(id, false);
boomboxes.setVisible(id, true);
```

For rigid thin instances, use `PickingRegistry` to map Babylon Lite `mesh + thinInstanceIndex`
back to a stable `InstanceId`. For animated, VAT, or visually deformed instances where GPU
picking may use rest geometry, use screen-space logical picking:

```ts
import { pickScreenSpaceInstanceFromPointer } from "@litools/instancer";

const picked = pickScreenSpaceInstanceFromPointer({
  event,
  canvas,
  camera,
  ids,
  has: (id) => sharks.has(id),
  isVisible: (id) => sharks.getVisible(id),
  getWorldPosition: (id) => getCurrentSharkCenter(id),
  getScreenRadius: () => 32
});

if (picked) {
  select(picked.id);
}
```
