import { createBox, onBeforeRender } from "@babylonjs/lite";
import { createInstanceSet, type InstanceId } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

interface BoxMeta {
  row: number;
  col: number;
  pinned: boolean;
}

const ctx = await createExample("Primitive Box Field");
const mesh = addMesh(ctx.scene, createBox(ctx.engine, 0.82), [0.72, 0.78, 0.88]);
const boxes = createInstanceSet<BoxMeta>(mesh, {
  capacity: 900,
  colors: true,
  engine: ctx.engine,
  gpuCulling: true
});

ctx.registry.register(mesh, boxes);

const ids: InstanceId[] = [];
const size = 26;
const gap = 1.12;

for (let row = 0; row < size; row++) {
  for (let col = 0; col < size; col++) {
    const x = (col - size / 2) * gap;
    const z = (row - size / 2) * gap;
    const id = boxes.create(makeMatrix(x, 0, z, 0.65), { row, col, pinned: false });
    boxes.setColor(id, colorFromIndex(row * size + col));
    ids.push(id);
  }
}

let selected: InstanceId | undefined;
let time = 0;

ctx.panel.button("remove random", () => {
  for (let i = 0; i < 16 && ids.length > 0; i++) {
    const index = Math.floor(Math.random() * ids.length);
    const id = ids[index];
    if (!id) continue;
    boxes.remove(id);
    ids.splice(index, 1);
    if (selected === id) selected = undefined;
  }
});

ctx.panel.button("recolor all", () => {
  ids.forEach((id, index) => boxes.setColor(id, colorFromIndex(index + Math.random() * 1000)));
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked) return;
  selected = picked.id;
  const meta = boxes.getMetadata(selected);
  if (meta) {
    meta.pinned = !meta.pinned;
    boxes.setMetadata(selected, meta);
  }
  boxes.setColor(selected, [1, 0.95, 0.2, 1]);
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  boxes.batch((writer) => {
    ids.forEach((id, index) => {
      const meta = boxes.getMetadata(id);
      if (!meta || meta.pinned) return;
      const x = (meta.col - size / 2) * gap;
      const z = (meta.row - size / 2) * gap;
      const h = Math.sin(time * 2 + meta.row * 0.34 + meta.col * 0.21) * 0.9 + 1.35;
      writer.setTransform(id, makeMatrix(x, h * 0.3, z, [0.65, h, 0.65], time + index * 0.01));
    });
  });

  ctx.panel.set("count", boxes.count);
  ctx.panel.set("visible", boxes.visibleCount);
  ctx.panel.set("capacity", boxes.capacity);
  ctx.panel.set("selected", selected ? Number(selected) : "-");
});

await runExample(ctx);
