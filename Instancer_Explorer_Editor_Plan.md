# Instancer Explorer Editor Plan

## Goal

Provide a convenient Explorer-side instance editor for `@litools/instancer`.

The adapter makes instance sets visible in the Explorer tree. The editor should make instance workflows comfortable: inspect, filter, select, edit, hide/show, remove, and batch operate on stable app-level instances.

## Core Idea

Use the same Instancer Explorer registry for both:

- Scene tree adapter data.
- Dedicated Instancer editor pane/tool.

The adapter answers "what exists?" for Explorer. The editor answers "how do I work with these instances efficiently?"

## Why a Dedicated Editor

The generic Explorer property panel is useful for one selected entity at a time, but instancing workflows are usually tabular and batch-oriented.

Users often need to:

- Search thousands of instances.
- Compare labels, IDs, slots, visibility, and metadata.
- Toggle visibility quickly.
- Select one instance and edit transforms.
- Hide/show/remove many instances at once.
- Watch slots move while stable IDs remain constant.

A dedicated editor can do this much better than a generic property list.

## Registration Model

The editor should use the same explicit registration model as the adapter.

Example:

```ts
ctx.instancerExplorer.registerSet({
  id: "boomboxes",
  label: "BoomBoxes",
  set: boomboxes,
  kind: "hierarchy",
  getLabel: (id, meta) => meta?.label ?? `BoomBox ${Number(id)}`,
  getDetails: (id, meta) => meta,
  onSelect: (id) => {
    selected = id;
  },
  onHighlight: (id, active) => {
    // Optional app-specific highlight hook.
  },
  canRemove: true
});
```

Suggested type extension:

```ts
interface InstancerEditorSet<TMetadata = unknown> {
  id: string;
  label: string;
  set: BaseInstanceSet<TMetadata>;
  kind?: "thin" | "hierarchy" | "vat" | "custom";

  getLabel?: (
    id: InstanceId,
    metadata: TMetadata | undefined,
    slot: number | undefined
  ) => string;

  getDetails?: (
    id: InstanceId,
    metadata: TMetadata | undefined
  ) => unknown;

  serializeMetadata?: (
    metadata: TMetadata | undefined,
    id: InstanceId
  ) => unknown;

  onSelect?: (id: InstanceId | undefined) => void;
  onHighlight?: (id: InstanceId, active: boolean) => void;
  canRemove?: boolean;
}
```

## Editor Layout

Recommended first version:

```text
Instancer Editor
  Set selector
  Search / filters
  Instance table
  Selected instance inspector
  Bulk actions
```

Set selector:

- Dropdown or tabs for registered sets.
- Shows count and visible count.

Filters:

- Search by label.
- Search by stable ID.
- Search by metadata summary.
- Filter: all / visible / hidden.

Table columns:

- Selection checkbox.
- Label.
- Stable ID.
- Current slot.
- Visible toggle.
- Position summary.
- Metadata summary.

Inspector:

- Label.
- Stable ID.
- Current slot.
- Visible.
- Position vector editor.
- Metadata/details.
- Optional color editor if supported.
- Remove button when `canRemove` is true.

Bulk actions:

- Show selected.
- Hide selected.
- Remove selected when allowed.
- Clear selection.
- Refresh.

## Stable ID Rule

The editor must always use `InstanceId` as identity.

Slots are only diagnostic:

- Slots may move after removal.
- Slots may move after active-count visibility changes.
- Slots may move after compaction or rebuild.
- Hierarchy pools may rebuild.

Table row keys and selected state must use stable `InstanceId`, never slot.

## Minimum Viable Editor

First implementation should include:

- Set selector.
- Instance list/table.
- Search by label or ID.
- Visible filter.
- Single selected instance inspector.
- Editable `visible`.
- Editable `position`.
- Remove selected, guarded by `canRemove`.
- Refresh button.

This is enough to validate the workflow without overbuilding.

## Later Features

Good follow-ups:

- Multi-select.
- Bulk show/hide/remove.
- Color editor for `ColoredInstanceSet`.
- Scale editor.
- Rotation editor.
- Matrix viewer.
- Metadata column configuration.
- Custom columns from registration.
- Custom app actions per instance.
- Pick in canvas to select row.
- Row hover highlight via `onHighlight`.
- Export selected IDs.
- Snapshot selected/all instances.
- Duplicate/create instance if app supplies a factory callback.

## Editor Data Refresh

The editor should not cache slot positions.

Each refresh should read live data from:

- `set.entries()`
- `set.getVisible(id)`
- `set.getPosition(id)`
- `set.getMetadata(id)`
- `set.getSlot(id)`

If an instance was removed, it disappears on next refresh. If the selected ID no longer exists, clear selection.

## Selection Integration

The editor can coordinate with examples through callbacks:

```ts
onSelect?: (id: InstanceId | undefined) => void;
onHighlight?: (id: InstanceId, active: boolean) => void;
```

This keeps the editor generic while allowing examples to:

- Update local selected state.
- Boost scale or color.
- Move camera.
- Show labels.

The editor should not assume how selection is visualized.

## Picking Integration

Picking can come later.

Possible flow:

- Existing `PickingRegistry` maps mesh + thin instance slot to stable `InstanceId`.
- Instancer Explorer registry maps `BaseInstanceSet` object to registered set ID.
- Editor selects the matching row.

This should be optional because some examples use screen-space logical picking instead of raw GPU thin-instance picking.

## Explorer Integration Needed

The best Explorer-side feature would be custom panes/tools.

Desired Explorer API:

```ts
showLiteExplorer(context, {
  adapters: [instancerExplorer.adapter],
  panes: [
    instancerExplorer.editorPane
  ]
});
```

Alternative:

```ts
showLiteExplorer(context, {
  plugins: [
    createInstancerExplorerPlugin(instancerExplorer)
  ]
});
```

The pane should be optional. Apps may want only the adapter tree integration.

## Relationship to Adapter Plan

The adapter and editor should share one registry.

```text
InstancerExplorerRegistry
  registered sets
  label helpers
  metadata serializers
  selection/highlight callbacks
  adapter
  editor pane
```

Adapter responsibilities:

- Add `Instancer` branch to Explorer tree.
- Provide properties for set and instance entities.
- Support generic visibility and position edits.

Editor responsibilities:

- Provide table/list workflow.
- Provide search/filter/bulk operations.
- Provide app callback hooks.

## Non-Goals

- Do not replace the default Explorer adapter.
- Do not make slots row identity.
- Do not require every set to support remove, color, custom actions, or metadata editing.
- Do not make Explorer guess stable IDs from Babylon Lite internals.
- Do not build a full database-style grid in the first version.

