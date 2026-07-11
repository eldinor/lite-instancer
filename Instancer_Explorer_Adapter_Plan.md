# Instancer Explorer Adapter Plan

## Goal

Expose `@litools/instancer` stable instance IDs inside Babylon Lite Explorer without replacing the Explorer default adapter.

The Explorer should keep showing its normal Babylon Lite scene tree. Instancer data should appear as an additional branch supplied by a custom adapter. The app must explicitly register instance sets because only the app-level instancer API knows stable `InstanceId` values. Babylon Lite thin-instance slots are not stable identity.

## Design Principles

- Keep the default Explorer adapter enabled.
- Keep passing the full `lite` namespace to Explorer.
- Add Instancer as an extra adapter, not as a replacement adapter.
- Register `BaseInstanceSet` objects explicitly from the app or example.
- Use stable `InstanceId` values for Explorer entity identity.
- Show current slots only as diagnostic properties.
- Do not infer app IDs from meshes, hierarchy pools, or thin-instance indices.
- Do not require all examples to opt in at once.

## Explorer Capability Needed

Babylon Lite Explorer needs additive custom adapters.

Preferred Explorer API:

```ts
showLiteExplorer(context, {
  adapters: [
    instancerExplorer.adapter
  ]
});
```

Expected behavior:

- Explorer internally uses its default adapter when `adapter` is omitted.
- `adapters` are appended after the default adapter.
- `getSceneTree()` concatenates root entities from default and custom adapters.
- Explorer tracks which adapter owns each entity ID.
- Property reads and writes route back to the owning adapter.
- Entity IDs must be unique across all adapters.

Fallback if Explorer only supports one adapter:

```ts
showLiteExplorer(context, {
  adapter: composeLiteSceneAdapters([
    createDefaultLiteSceneAdapter(),
    instancerExplorer.adapter
  ])
});
```

This should ideally live in Explorer, not in this package, so apps do not have to reimplement composition.

## Instancer Registration API

Add a small registry in this repo, likely under `examples/shared/` first. If it proves useful, later move it into `src/` and export it as package API.

Suggested shared example API:

```ts
ctx.instancerExplorer.registerSet({
  id: "boomboxes",
  label: "BoomBoxes",
  set: boomboxes,
  kind: "hierarchy",
  getLabel: (id, meta) => meta?.label ?? `BoomBox ${Number(id)}`
});
```

Suggested generic type:

```ts
interface InstancerExplorerSet<TMetadata = unknown> {
  id: string;
  label: string;
  set: BaseInstanceSet<TMetadata>;
  kind?: "thin" | "hierarchy" | "vat" | "custom";
  getLabel?: (
    id: InstanceId,
    metadata: TMetadata | undefined,
    slot: number | undefined
  ) => string;
  serializeMetadata?: (
    metadata: TMetadata | undefined,
    id: InstanceId
  ) => unknown;
}
```

Minimum required fields:

- `id`: stable string unique among registered sets.
- `label`: display name for the set.
- `set`: an object implementing `BaseInstanceSet<TMetadata>`.

Optional fields:

- `kind`: display/debug category.
- `getLabel`: creates useful labels for child instance rows.
- `serializeMetadata`: lets apps avoid exposing circular or noisy metadata.

## Example Context Integration

Extend `ExampleContext`:

```ts
interface ExampleContext {
  canvas: HTMLCanvasElement;
  engine: EngineContext;
  scene: SceneContext;
  picker: GpuPicker;
  registry: PickingRegistry;
  instancerExplorer: InstancerExplorerRegistry;
  panel: DebugPanel;
}
```

Create the registry in `createExample()`:

```ts
const instancerExplorer = createInstancerExplorerRegistry();
return { canvas, engine, scene, picker, registry, instancerExplorer, panel };
```

Pass the adapter in `runExample()`:

```ts
const explorer = showLiteExplorer(
  { engine: ctx.engine, scene: ctx.scene, canvas: ctx.canvas, lite: liteRuntime },
  {
    adapters: [ctx.instancerExplorer.adapter],
    mode: "overlay",
    layout: "single",
    theme: "dark",
    initiallyOpen: false,
    notificationsEnabled: false,
    features: { focusSelected: true, canvasPicking: false },
    title: "Lite Explorer"
  }
);
```

If no sets are registered, the adapter can either return no root entities or return an empty `Instancer` branch. Prefer returning no root entities to keep non-instancer examples clean.

## Entity Tree Shape

When at least one set is registered:

```text
Instancer
  BoomBoxes
    boombox-0-0
    boombox-0-1
  Boxes
    Box 1
    Box 2
```

Entity IDs must not include slots.

Recommended IDs:

```text
instancer:root
instancer:set:{setId}
instancer:set:{setId}:instance:{Number(instanceId)}
```

Rules:

- `setId` must be validated so it cannot contain `:` unless escaped.
- Instance entity IDs use `Number(id)`, not slot.
- During each `getSceneTree()`, read live IDs from `set.entries()`.
- If an ID was removed, it disappears on next Explorer refresh.

## Entity Capabilities

Root entity:

```ts
{
  editable: false,
  focusable: false,
  visibilityToggle: false,
  serializableSnapshot: true
}
```

Set entity:

```ts
{
  editable: false,
  focusable: false,
  visibilityToggle: false,
  serializableSnapshot: true
}
```

Instance entity:

```ts
{
  editable: true,
  focusable: false,
  visibilityToggle: true,
  serializableSnapshot: true
}
```

Focus can be added later if the app supplies a camera focus callback.

## Properties

Root properties:

- Adapter name
- Registered set count

Set properties:

- Set ID
- Label
- Kind
- Count
- Visible count
- Capacity

Instance properties:

- Stable ID
- Current slot
- Visible
- Position
- Metadata summary

Use readonly fields for identity/debug values:

```ts
{ kind: "readonly", path: "id", label: "Instance ID", value: String(Number(id)) }
{ kind: "readonly", path: "slot", label: "Current slot", value: String(slot ?? "-") }
```

Use editable fields for app-level operations:

```ts
{ kind: "boolean", path: "visible", label: "Visible", value: set.getVisible(id) }
{ kind: "vector3", path: "position", label: "Position", value: [x, y, z] }
```

## Property Writes

For instance entities:

```ts
setProperty(entity, "visible", value) {
  set.setVisible(id, Boolean(value));
  return ok();
}
```

```ts
setProperty(entity, "position", value) {
  if (!isVector3(value)) return fail("invalid", "Position must be a vector3.");
  set.setPosition(id, value);
  return ok();
}
```

Return `unsupported` for root/set property writes.

If the instance no longer exists, return `invalid` with a useful message.

## Visibility Toggle

`setEntityVisible(entity, visible)` should map to `set.setVisible(id, visible)` for instance entities.

This lets Explorer use its standard visibility command when an instance row is selected.

## Snapshots

Set snapshot:

```ts
{
  id,
  label,
  kind,
  count: set.count,
  visibleCount: set.visibleCount,
  capacity: set.capacity
}
```

Instance snapshot:

```ts
{
  id: Number(instanceId),
  slot,
  visible,
  position,
  metadata
}
```

Use `serializeMetadata` if provided. Otherwise use metadata as-is, but catch JSON/stringification failures in Explorer export paths if needed.

## Picking Integration

Do not require picking for the first version.

Later, adapter-level picking can use the existing `PickingRegistry`:

- `pickEntityId(x, y, context)` calls Babylon Lite picker.
- Resolve picked mesh and slot through `PickingRegistry`.
- Map the stable ID to `instancer:set:{setId}:instance:{id}`.

This requires knowing which registered set owns the resolved pick. Existing `PickingRegistry` stores only mesh-to-set, so the instancer Explorer registry may need a reverse map from `BaseInstanceSet` object to registered set ID.

## Example Opt-In

Start with examples that already have meaningful metadata labels:

- `boombox-grid`
- `boombox-picker`
- `primitive-box-field`
- `primitive-sphere-cloud`
- `basic-thin-instances`

Example:

```ts
ctx.instancerExplorer.registerSet({
  id: "tiles",
  label: "Tiles",
  set: tiles,
  kind: "thin",
  getLabel: (id, meta) => meta?.label ?? `Tile ${Number(id)}`
});
```

Keep opt-in local to each example so unusual examples can choose custom labels or skip registration.

## Tests

Add tests for the Instancer adapter/registry:

- No registered sets returns no root entities.
- Registered set returns `Instancer -> Set -> Instances`.
- Entity IDs use stable instance IDs, not slots.
- Removing an instance removes it from the next tree.
- Visibility property calls `setVisible`.
- Position property calls `setPosition`.
- Duplicate set IDs throw or return a clear failure.
- Metadata serialization uses `serializeMetadata` when provided.

If implemented inside examples only, tests can use a tiny fake `BaseInstanceSet`.

## Bundle Notes

This adapter plan does not remove `recast-navigation` from the examples bundle by itself.

The current recast chunk appears because the shared example harness passes the full `@babylonjs/lite` namespace to Explorer. We are intentionally keeping that to preserve future Explorer tool capabilities.

If bundle size becomes a release blocker later, solve it in Babylon Lite or Explorer with better lazy runtime boundaries rather than weakening the Explorer runtime object in these examples.

## Non-Goals

- Do not replace the default Explorer adapter.
- Do not stop passing the full Lite runtime namespace.
- Do not infer stable IDs from thin-instance slots.
- Do not make slot numbers persistent entity identity.
- Do not require every example to register sets immediately.
- Do not add camera focus or picking in the first version unless Explorer’s adapter composition makes it trivial.

