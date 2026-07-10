import { createBox, onBeforeRender } from "@babylonjs/lite";
import { createInstanceSet, type InstanceId } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

interface TileMeta {
  label: string;
  row: number;
  col: number;
  phase: number;
  selected: boolean;
}

const ctx = await createExample("Basic Thin Instances");
const mesh = addMesh(ctx.scene, createBox(ctx.engine, 0.86), [0.7, 0.76, 0.84]);
const tiles = createInstanceSet<TileMeta>(mesh, {
  capacity: 64,
  colors: true,
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "active-count"
});

ctx.registry.register(mesh, tiles);

const ids: InstanceId[] = [];
const columns = 6;
const gap = 1.55;
let nextIndex = 0;
let selected: InstanceId | undefined;
let lastRemoved = "-";
let time = 0;

for (let index = 0; index < 24; index++) {
  ids.push(createTile(index));
}

ctx.panel.button("add one", () => {
  ids.push(createTile(nextIndex));
});

ctx.panel.button("remove selected", () => {
  const id = getSelectedId();
  if (!id) {
    return;
  }
  removeTile(id);
});

ctx.panel.button("remove random", () => {
  const active = ids.filter((id) => tiles.has(id));
  const id = active[Math.floor(Math.random() * active.length)];
  if (id) {
    removeTile(id);
  }
});

ctx.panel.button("recolor all", () => {
  for (const id of ids) {
    if (tiles.has(id)) {
      tiles.setColor(id, colorFromIndex(Number(id) + Math.random() * 1000));
    }
  }
});

ctx.panel.button("reset", () => {
  tiles.clear();
  ids.length = 0;
  selected = undefined;
  lastRemoved = "-";
  nextIndex = 0;
  for (let index = 0; index < 24; index++) {
    ids.push(createTile(index));
  }
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked || picked.set !== tiles || !tiles.has(picked.id)) {
    return;
  }
  setSelected(picked.id);
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  tiles.batch((writer) => {
    for (const id of ids) {
      const meta = tiles.getMetadata(id);
      if (!meta) {
        continue;
      }
      const scale = meta.selected ? 1.25 : 1;
      const y = Math.sin(time * 2.4 + meta.phase) * 0.22;
      writer.setTransform(id, makeMatrix(gridX(meta.col), y, gridZ(meta.row), scale, time * 0.35 + meta.phase));
    }
  });

  selected = getSelectedId();
  const meta = selected ? tiles.getMetadata(selected) : undefined;
  ctx.panel.set("count", tiles.count);
  ctx.panel.set("visible", tiles.visibleCount);
  ctx.panel.set("capacity", tiles.capacity);
  ctx.panel.set("next id", nextIndex + 1);
  ctx.panel.set("selected id", selected ? Number(selected) : "-");
  ctx.panel.set("selected slot", selected ? tiles.getSlot(selected) ?? "-" : "-");
  ctx.panel.set("metadata", meta ? meta.label : "-");
  ctx.panel.set("last removed", lastRemoved);
});

await runExample(ctx);

function createTile(index: number): InstanceId {
  const row = Math.floor(index / columns);
  const col = index % columns;
  const id = tiles.create(makeMatrix(gridX(col), 0, gridZ(row), 1), {
    label: `tile-${index}`,
    row,
    col,
    phase: row * 0.46 + col * 0.31,
    selected: false
  });
  tiles.setColor(id, colorFromIndex(index));
  nextIndex = Math.max(nextIndex, index + 1);
  return id;
}

function removeTile(id: InstanceId): void {
  const meta = tiles.getMetadata(id);
  lastRemoved = meta?.label ?? String(Number(id));
  tiles.remove(id);
  const index = ids.indexOf(id);
  if (index >= 0) {
    ids.splice(index, 1);
  }
  if (selected === id) {
    selected = undefined;
  }
}

function setSelected(id: InstanceId): void {
  if (selected && tiles.has(selected)) {
    const previous = tiles.getMetadata(selected);
    if (previous) {
      previous.selected = false;
      tiles.setMetadata(selected, previous);
      tiles.setColor(selected, colorFromIndex(previous.row * columns + previous.col));
    }
  }

  selected = id;
  const meta = tiles.getMetadata(id);
  if (meta) {
    meta.selected = true;
    tiles.setMetadata(id, meta);
    tiles.setColor(id, [1, 0.92, 0.18, 1]);
  }
}

function getSelectedId(): InstanceId | undefined {
  return selected && tiles.has(selected) ? selected : undefined;
}

function gridX(col: number): number {
  return (col - (columns - 1) / 2) * gap;
}

function gridZ(row: number): number {
  return (row - 1.5) * gap;
}
