# Instancer Spacer Plan

## Goal

Add a tree-shakable "spacer" utility layer for `@litools/instancer`.

Spacer utilities should create and update stable-ID instances in predictable layouts such as linear rows, grids, matrices, radial rings, and later object-surface distributions. This should bring the practical spirit of `bp-cloner` layout tools to this package without cloning Babylon meshes or owning scene nodes.

The spacer owns layout logic. The existing instance sets own rendering, stable IDs, visibility, metadata, batching, and picking.

At package level, Spacer should make the library story feel like:

> Create stable app-level instances, then arrange them with Spacer.

It should not become a full mesh cloner system.

## Core Principle

Spacer must be transform-first and set-agnostic.

It should work with anything implementing `BaseInstanceSet<TMetadata>`:

- `InstanceSet`
- `HierarchyInstanceSet`
- VAT-backed sets if they implement the same surface
- future custom instance sets

Spacer should not import or depend on concrete Babylon Lite mesh APIs beyond shared types such as `Mat4` if truly needed.

## Relationship To `bp-cloner`

`bp-cloner` owns clone objects, parent nodes, Babylon scene nodes, instances, and conversion to thin instances.

Spacer should not copy that ownership model.

This package already has the right ownership split:

- `InstanceSet` / `HierarchyInstanceSet` own stable IDs and efficient instance storage.
- Spacer computes transforms and applies them to those sets.
- Examples/apps own metadata, labels, selection, and domain behavior.
- Explorer integration, if used, should be optional and separate.

So Spacer is inspired by the distribution features of `bp-cloner`, not a port of its scene-object model.

## Notes From `bp-cloner`

`bp-cloner` does not expose aggregate cloner bounds as a primary feature.

Relevant behavior:

- `MatrixCloner` centers clone origins by formula from `mcount` and `size`.
- `LinearCloner` computes clone positions by interpolation, growth, and offset.
- `RadialCloner` computes clone positions with `sin`/`cos`, radius, angle range, plane, and offset.
- `ObjectCloner` places clones at template mesh facet positions via `getFacetLocalPositions()` and uses normals separately.
- `Cloner.toMatrix()` exports per-clone matrices, which could be used by an app to calculate bounds externally.
- No cloner class appears to calculate or expose `{ min, max, center, size }` bounds.

For this package, Spacer can later improve on that by making origin/layout bounds explicit and content bounds optional. Bounds are useful, but they are not required for the first Spacer version.

## Tree-Shaking Requirements

Design for deep tree-shaking from the start.

Rules:

- Do not put all spacer logic in one large module.
- Do not make `src/index.ts` eagerly import heavy optional helpers unless they are tiny and pure.
- Keep each layout in its own file.
- Keep effectors in separate files.
- Keep controller/stateful helpers separate from pure functions.
- Avoid namespace imports from `@babylonjs/lite`.
- Avoid importing Explorer, examples, DOM, or rendering helpers.
- Prefer plain arrays and existing transform helpers.
- Make all modules side-effect free.

Suggested file structure:

```text
src/spacer/
  types.ts
  apply.ts
  linear.ts
  grid.ts
  matrix.ts
  radial.ts
  random-effector.ts
  controller.ts
  babylon-bounds.ts      later / optional
  index.ts
```

Exports:

```ts
// src/spacer/index.ts
export * from "./types.js";
export * from "./apply.js";
export * from "./linear.js";
export * from "./grid.js";
export * from "./matrix.js";
export * from "./radial.js";
```

Optional heavier exports:

```ts
export * from "./random-effector.js";
export * from "./controller.js";
```

### Tree-Shaking Contract

Treat this as a package contract:

- `@litools/instancer` must not import Explorer integration.
- `@litools/instancer` should not force apps to pay for optional Spacer extras.
- `@litools/instancer/spacer` must not import Explorer.
- `@litools/instancer/spacer` must not import Babylon-specific bounds helpers.
- `@litools/instancer/spacer/effectors` must only load when explicitly imported.
- `@litools/instancer/spacer/controller` must only load when explicitly imported.
- `@litools/instancer/spacer/babylon` must only load when explicitly imported.
- Each layout module should be independently importable.

Good imports:

```ts
import { createInstanceSet } from "@litools/instancer";
import { applySpacer, spaceGrid } from "@litools/instancer/spacer";
import { randomOffset } from "@litools/instancer/spacer/effectors";
```

Bad outcome to avoid:

```ts
import { spaceGrid } from "@litools/instancer";
```

and the bundle accidentally includes Explorer adapters, all effectors, controller code, or Babylon-specific helper modules.

### Package Exports

The main entry can continue to expose the stable-ID instance APIs:

```text
@litools/instancer
  createInstanceSet
  createHierarchyInstanceSet
  PickingRegistry
  transforms
```

Spacer should be available as a subpath:

```text
@litools/instancer/spacer
  spaceLinear
  spaceGrid
  spaceMatrix
  spaceRadial
  applySpacer
```

Optional extras should use separate subpaths:

```text
@litools/instancer/spacer/effectors
@litools/instancer/spacer/controller
@litools/instancer/spacer/babylon    later / optional
@litools/instancer/explorer          future Explorer integration
```

Suggested `package.json` direction:

```json
{
  "exports": {
    ".": "...",
    "./spacer": {
      "types": "./dist/spacer/index.d.ts",
      "import": "./dist/spacer/index.js"
    },
    "./spacer/effectors": {
      "types": "./dist/spacer/effectors/index.d.ts",
      "import": "./dist/spacer/effectors/index.js"
    },
    "./spacer/controller": {
      "types": "./dist/spacer/controller.d.ts",
      "import": "./dist/spacer/controller.js"
    },
    "./spacer/babylon": {
      "types": "./dist/spacer/babylon.d.ts",
      "import": "./dist/spacer/babylon.js"
    }
  }
}
```

Do not add optional subpaths until the matching modules exist.

## Naming

Use "spacer" as the user-facing word.

Recommended names:

- `spaceLinear`
- `spaceGrid`
- `spaceMatrix`
- `spaceRadial`
- `applySpacer`
- `createSpacerController`

Avoid "cloner" because this package does not clone meshes. It creates app-level instances and writes transforms.

## Package-Level Usage

Simple package-level story:

```ts
import { createInstanceSet } from "@litools/instancer";
import { applySpacer, spaceGrid } from "@litools/instancer/spacer";

const boxes = createInstanceSet(mesh, { capacity: 100 });

const ids = applySpacer(
  boxes,
  spaceGrid({
    rows: 10,
    columns: 10,
    gap: [2, 2],
    axis: "xz",
    center: true
  }),
  {
    metadata: ({ extra }) => ({
      label: `box-${extra.row}-${extra.col}`,
      row: extra.row,
      col: extra.col
    })
  }
);
```

Re-layout without losing stable IDs:

```ts
applySpacer(
  boxes,
  spaceRadial({
    count: ids.length,
    radius: 12,
    align: true
  }),
  { ids }
);
```

This demonstrates the key value: stable app identity survives layout changes.

## API Layers

Use two layers.

### 1. Pure Layout Functions

Pure functions produce transform plans. They do not mutate instance sets.

Example:

```ts
const items = spaceGrid({
  columns: 8,
  rows: 8,
  gap: [24, 24],
  center: true
});
```

Each item contains:

```ts
interface SpacerItem<TExtra = unknown> {
  index: number;
  transform: InstanceTransformInput;
  extra?: TExtra;
}
```

For grids, `extra` can contain row/column coordinates:

```ts
{
  row: number;
  col: number;
}
```

Benefits:

- Easy to test.
- No set dependency.
- Tiny and tree-shakable.
- Useful for apps that want to apply layouts themselves.

### 2. Apply Helpers

Apply helpers write a layout into a `BaseInstanceSet`.

Example:

```ts
const ids = applySpacer(set, spaceGrid(options), {
  metadata: (item) => ({
    label: `item-${item.extra.row}-${item.extra.col}`
  })
});
```

Responsibilities:

- Create missing instances.
- Update existing instances.
- Optionally hide or remove extra old instances.
- Preserve stable IDs where possible.
- Batch writes through `set.batch()`.

## Initial Public API Proposal

### `spaceGrid`

```ts
const layout = spaceGrid({
  rows: 8,
  columns: 8,
  gap: [24, 24],
  axis: "xz",
  center: true,
  scale: 1,
  rotationEuler: [0, 0, 0]
});
```

Options:

```ts
interface GridSpacerOptions {
  rows: number;
  columns: number;
  gap?: number | readonly [number, number];
  axis?: "xy" | "xz" | "yz";
  center?: boolean;
  origin?: Vec3Like;
  scale?: number | Vec3Like;
  rotationEuler?: Vec3Like;
}
```

### `spaceMatrix`

```ts
const layout = spaceMatrix({
  count: [5, 5, 5],
  gap: [2, 2, 2],
  center: true
});
```

Options:

```ts
interface MatrixSpacerOptions {
  count: readonly [number, number, number];
  gap?: number | Vec3Like;
  center?: boolean;
  origin?: Vec3Like;
  scale?: number | Vec3Like;
  rotationEuler?: Vec3Like;
}
```

### `spaceLinear`

```ts
const layout = spaceLinear({
  count: 20,
  step: [0, 2, 0],
  center: false,
  growth: 1
});
```

Options:

```ts
interface LinearSpacerOptions {
  count: number;
  step?: Vec3Like;
  center?: boolean;
  origin?: Vec3Like;
  growth?: number;
  scale?: number | Vec3Like;
  rotationEuler?: Vec3Like;
}
```

### `spaceRadial`

```ts
const layout = spaceRadial({
  count: 64,
  radius: 12,
  startAngle: 0,
  endAngle: 360,
  axis: "y",
  align: true
});
```

Options:

```ts
interface RadialSpacerOptions {
  count: number;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  offsetAngle?: number;
  axis?: "x" | "y" | "z";
  align?: boolean;
  origin?: Vec3Like;
  scale?: number | Vec3Like;
}
```

Use degrees for public angles, matching `bp-cloner` style and common user expectation.

## Apply API Proposal

```ts
const ids = applySpacer(set, layout, {
  ids,
  metadata: (item, existingId) => ({
    label: `box-${item.index}`
  }),
  overflow: "hide"
});
```

Types:

```ts
interface ApplySpacerOptions<TMetadata, TExtra = unknown> {
  ids?: InstanceId[];
  metadata?: (
    item: SpacerItem<TExtra>,
    existingId: InstanceId | undefined
  ) => TMetadata;
  overflow?: "keep" | "hide" | "remove";
}
```

Behavior:

- If `ids[index]` exists and still belongs to the set, update that ID.
- If no ID exists for an item, create one.
- Return the full current ID array in layout order.
- If there are extra IDs beyond the new layout:
  - `"keep"` leaves them unchanged.
  - `"hide"` sets them invisible.
  - `"remove"` removes them.

Default overflow: `"keep"` for safety.

## Bounds Later

Bounds are a lower-priority follow-up. Do not block the first Spacer implementation on bounds.

When added, Spacer should keep bounds split into two concepts.

### Origin Bounds

Origin bounds are calculated from generated instance positions.

They can be calculated because Spacer already knows every item transform.

```ts
const layout = spaceGrid({
  rows: 8,
  columns: 8,
  gap: [24, 24],
  axis: "xz",
  center: true
});

layout.originBounds;
```

Shape:

```ts
interface SpacerBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}
```

Implementation:

- Iterate all layout items.
- Read the transform position.
- Merge min/max.
- Derive center and size.

Use iteration for all layouts, including matrix and radial. Analytic bounds are possible for simple cases, but iteration is simpler and works with effectors.

### Content Bounds

Content bounds include the visual size of the instanced source.

These should be optional because core Spacer should not know about Babylon Lite mesh internals.

Example:

```ts
const layout = spaceGrid({
  rows: 8,
  columns: 8,
  gap: [24, 24],
  sourceBounds: {
    min: [-1, -1, -1],
    max: [1, 1, 1]
  }
});

layout.contentBounds;
```

Behavior:

- If `sourceBounds` is omitted, `contentBounds` can equal `originBounds` or be `undefined`.
- Prefer `undefined` for clarity.
- If `sourceBounds` is provided, transform the 8 AABB corners by each item transform and merge them.
- This correctly handles scale, rotation, and non-uniform scale.

Source bounds type:

```ts
interface SpacerSourceBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}
```

### Bounds Options

Add optional bounds inputs to layout options:

```ts
interface SpacerBoundsOptions {
  sourceBounds?: SpacerSourceBounds;
}
```

Each layout options type can include:

```ts
sourceBounds?: SpacerSourceBounds;
```

Keep this plain-data only.

### Babylon Bounds Helpers

Babylon-specific bounds calculation should live outside core Spacer modules.

Suggested optional file:

```text
src/spacer/babylon-bounds.ts
```

Potential exports:

```ts
export function computeMeshSourceBounds(mesh: Mesh): SpacerSourceBounds;
export function computeHierarchySourceBounds(root: SceneNode): SpacerSourceBounds;
```

Import path should be separate if possible:

```ts
import { computeHierarchySourceBounds } from "@litools/instancer/spacer/babylon";
```

Meaning of `@litools/instancer/spacer/babylon`:

- A future optional subpath for Babylon-specific helper utilities.
- It can inspect Babylon Lite meshes or scene-node hierarchies.
- It should return plain bounds data for core Spacer to consume.
- It is not part of the first Spacer implementation.

Reason:

- Keeps `spaceGrid`, `spaceLinear`, etc. pure and tree-shakable.
- Avoids pulling Babylon mesh traversal into apps that only want layout transforms.
- Makes manual source bounds easy for users who already know asset size.

### Bounds And Apply

`applySpacer` should not need bounds to function.

Bounds belong to the layout result, not the instance set.

Possible return shape:

```ts
interface SpacerLayout<TExtra = unknown> {
  items: readonly SpacerItem<TExtra>[];
  originBounds: SpacerBounds;
  contentBounds?: SpacerBounds;
}
```

Then:

```ts
const layout = spaceRadial({ count: 64, radius: 12 });
const ids = applySpacer(set, layout);
console.log(layout.originBounds);
```

### Empty Bounds

For empty layouts:

- `items` is `[]`.
- `originBounds` should be `undefined` or a documented empty value.

Prefer:

```ts
originBounds?: SpacerBounds;
contentBounds?: SpacerBounds;
```

This avoids fake infinities or zero-size bounds that can be mistaken for real data.

## Stateful Controller

A controller is useful for animated or editable layouts.

Example:

```ts
const spacer = createSpacerController(boomboxes, {
  layout: () => spaceGrid({
    rows,
    columns,
    gap,
    center: true
  }),
  metadata: (item) => ({
    label: `boombox-${item.extra.row}-${item.extra.col}`,
    row: item.extra.row,
    col: item.extra.col
  }),
  overflow: "hide"
});

spacer.apply();
spacer.setOptions({ gap: 30 });
spacer.dispose({ removeInstances: true });
```

Controller responsibilities:

- Store the ID array.
- Reapply layouts while preserving IDs.
- Offer `ids`, `count`, and `set` accessors.
- Dispose by hiding or removing managed IDs.

Keep this in `controller.ts` so apps using only pure layout functions do not pay for it.

## Effectors

Effectors should be optional and pure.

Initial effectors:

- `randomOffset`
- `randomRotation`
- `randomScale`
- `sineWave`

Proposed shape:

```ts
type SpacerEffector<TExtra = unknown> = (
  item: SpacerItem<TExtra>
) => SpacerItem<TExtra>;
```

Pipeline:

```ts
const layout = withSpacerEffectors(
  spaceGrid(options),
  randomOffset({ seed: 123, amount: [1, 0, 1] }),
  sineWave({ axis: "y", amplitude: 2, phase: time })
);
```

Keep effectors separate from core layout files.

## Metadata

Spacer should make metadata easy but not required.

Example:

```ts
applySpacer(boxes, spaceGrid({ rows: 10, columns: 10 }), {
  metadata: ({ extra }) => ({
    label: `box-${extra.row}-${extra.col}`,
    row: extra.row,
    col: extra.col
  })
});
```

Do not force a metadata schema. Apps own metadata.

## Color Support

Color should be optional and duck-typed.

If a set supports `setColor`, allow:

```ts
applySpacer(coloredSet, layout, {
  color: (item) => colorFromIndex(item.index)
});
```

Do not import `ColoredInstanceSet` into the core apply path unless it remains type-only.

Use a runtime guard:

```ts
if ("setColor" in set && typeof set.setColor === "function") {
  set.setColor(id, color);
}
```

## Transform Composition

Prefer returning `InstanceTransformInput` objects, not precomposed matrices, for readability and small output:

```ts
{
  position: [x, y, z],
  rotationEuler: [rx, ry, rz],
  scale
}
```

Let existing set APIs compose matrices.

Only add matrix-specific paths later if performance demands it.

## Examples To Convert First

Good candidates:

- `primitive-box-field`
- `primitive-sphere-cloud`
- `basic-thin-instances`
- `boombox-grid`

These currently contain repeated manual layout loops. Spacer should reduce boilerplate and make examples easier to scan.

## Documentation Examples

Show the mental model clearly:

```ts
const ids = applySpacer(
  boxes,
  spaceGrid({ rows: 10, columns: 10, gap: [2, 2], axis: "xz", center: true }),
  {
    metadata: ({ extra }) => ({ label: `box-${extra.row}-${extra.col}` })
  }
);
```

Then:

```ts
applySpacer(
  boxes,
  spaceRadial({ count: ids.length, radius: 16, align: true }),
  { ids }
);
```

This demonstrates that stable IDs can move through layouts without losing app identity.

## Tests

Add focused tests for pure layout functions:

- `spaceLinear` count and positions.
- `spaceGrid` row/column extras and centering.
- `spaceMatrix` x/y/z indexing and centering.
- `spaceRadial` positions, degrees, axis, and align.
- Later bounds tests:
  - `originBounds` for linear/grid/matrix/radial.
  - Empty layouts return no bounds.
  - `contentBounds` expands by supplied source bounds.
  - `contentBounds` handles scale and rotation by transforming AABB corners.

Add apply tests with a fake `BaseInstanceSet`:

- Creates missing IDs.
- Reuses supplied IDs.
- Batches updates.
- Overflow keep/hide/remove behavior.
- Metadata callback receives item and existing ID.
- Removed IDs do not get reused accidentally.

Add tree-shaking-oriented checks if practical:

- Importing `spaceGrid` should not import radial/effectors/controller.
- Build output should not include Explorer or example code.
- Importing core `@litools/instancer` should not import Spacer optional subpaths.
- Importing `@litools/instancer/spacer` should not import `@litools/instancer/spacer/babylon`.

## Non-Goals

- Do not clone meshes.
- Do not own Babylon scene nodes.
- Do not replace `InstanceSet` or `HierarchyInstanceSet`.
- Do not add Explorer dependencies.
- Do not make effectors mandatory.
- Do not build a full bp-cloner port.
- Do not add object-surface placement in the first version.
- Do not make first-version Spacer depend on bounds.
- Do not make `@litools/instancer/spacer/babylon` part of the initial implementation.

## Implementation Order

1. Add spacer types.
2. Implement pure `spaceLinear`.
3. Implement pure `spaceGrid`.
4. Implement `applySpacer`.
5. Add tests with fake sets.
6. Convert one simple example.
7. Implement `spaceMatrix`.
8. Implement `spaceRadial`.
9. Add optional controller.
10. Add optional effectors.
11. Later: implement shared origin bounds calculation.
12. Later: implement optional source/content bounds calculation.
13. Later: add optional Babylon bounds helpers.
