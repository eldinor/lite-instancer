import { createBox, onBeforeRender } from "@babylonjs/lite";
import { composeMat4, createInstanceSet, type InstanceId } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

const ctx = await createExample("Raw Batch Streaming");
const mesh = addMesh(ctx.scene, createBox(ctx.engine, 0.42), [0.75, 0.82, 0.92]);
const instances = createInstanceSet(mesh, {
  capacity: 2500,
  colors: true,
  engine: ctx.engine,
  visibleStrategy: "active-count"
});

ctx.registry.register(mesh, instances);

const ids: InstanceId[] = [];
const side = 45;

for (let z = 0; z < side; z++) {
  for (let x = 0; x < side; x++) {
    const id = instances.create(makeMatrix((x - side / 2) * 0.75, 0, (z - side / 2) * 0.75, 0.45));
    instances.setColor(id, colorFromIndex(z * side + x));
    ids.push(id);
  }
}

let mode: "batch" | "raw" = "batch";
let selected: InstanceId | undefined;
let time = 0;
let evenVisible = true;

ctx.panel.button("toggle mode", () => {
  mode = mode === "batch" ? "raw" : "batch";
  ctx.panel.set("mode", mode);
});

ctx.panel.button("hide half", () => {
  evenVisible = !evenVisible;
  instances.batch((writer) => {
    ids.forEach((id, index) => {
      if (index % 2 === 0) {
        writer.setVisible(id, evenVisible);
      }
    });
  });
  ctx.panel.set("even ids", evenVisible ? "shown" : "hidden");
  ctx.panel.set("visible", instances.visibleCount);
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked) return;
  selected = picked.id;
  instances.setColor(selected, [1, 0.9, 0.18, 1]);
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;

  if (mode === "batch") {
    instances.batch((writer) => {
      ids.forEach((id, index) => {
        if (!instances.getVisible(id)) return;
        const x = index % side;
        const z = Math.floor(index / side);
        const y = Math.sin(time * 4 + x * 0.35 + z * 0.25) * 1.2;
        writer.setTransform(id, makeMatrix((x - side / 2) * 0.75, y, (z - side / 2) * 0.75, 0.45, time));
      });
    });
  } else {
    instances.editRaw((raw) => {
      ids.forEach((id, index) => {
        if (!instances.getVisible(id)) return;
        const slot = raw.getSlot(id);
        if (slot === undefined) return;
        const x = index % side;
        const z = Math.floor(index / side);
        const y = Math.sin(time * 5 + x * 0.4 + z * 0.22) * 1.3;
        const matrix = composeMat4(makeMatrix((x - side / 2) * 0.75, y, (z - side / 2) * 0.75, 0.45, time * 1.4));
        raw.writeMatrix(id, matrix);
        raw.markMatrixDirty(slot);
      });
    });
  }

  ctx.panel.set("mode", mode);
  ctx.panel.set("count", instances.count);
  ctx.panel.set("visible", instances.visibleCount);
  ctx.panel.set("even ids", evenVisible ? "shown" : "hidden");
  ctx.panel.set("selected", selected ? Number(selected) : "-");
});

await runExample(ctx);
