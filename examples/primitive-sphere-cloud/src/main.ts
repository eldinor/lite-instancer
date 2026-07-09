import { createSphere, onBeforeRender } from "@babylonjs/lite";
import { createInstanceSet, type InstanceId } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

interface SphereMeta {
  group: "inner" | "middle" | "outer";
  radius: number;
  speed: number;
  mass: number;
  phase: number;
}

const ctx = await createExample("Primitive Sphere Cloud");
const mesh = addMesh(ctx.scene, createSphere(ctx.engine, { diameter: 0.7, segments: 16 }), [0.7, 0.82, 1]);
const spheres = createInstanceSet<SphereMeta>(mesh, {
  capacity: 360,
  colors: true,
  engine: ctx.engine,
  visibleStrategy: "active-count"
});

ctx.registry.register(mesh, spheres);

const ids: InstanceId[] = [];
const groups: SphereMeta["group"][] = ["inner", "middle", "outer"];
const groupVisible = new Map<SphereMeta["group"], boolean>(groups.map((group) => [group, true]));

for (let i = 0; i < 300; i++) {
  const group = groups[i % groups.length] ?? "outer";
  const radius = group === "inner" ? 4 + Math.random() * 4 : group === "middle" ? 9 + Math.random() * 5 : 15 + Math.random() * 6;
  const id = spheres.create(makeMatrix(radius, 0, 0, 0.45 + Math.random() * 0.55), {
    group,
    radius,
    speed: 0.15 + Math.random() * 0.55,
    mass: 1 + Math.random() * 12,
    phase: Math.random() * Math.PI * 2
  });
  spheres.setColor(id, colorFromIndex(i));
  ids.push(id);
}

let selected: InstanceId | undefined;
let time = 0;

for (const group of groups) {
  ctx.panel.button(`toggle ${group}`, () => {
    const next = !groupVisible.get(group);
    groupVisible.set(group, next);
    spheres.batch((writer) => {
      for (const id of ids) {
        if (spheres.getMetadata(id)?.group === group) {
          writer.setVisible(id, next);
        }
      }
    });
    ctx.panel.set(`${group}`, next ? "shown" : "hidden");
    ctx.panel.set("visible", spheres.visibleCount);
  });
}

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked) return;
  selected = picked.id;
  spheres.setColor(selected, [1, 0.45, 0.25, 1]);
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  spheres.batch((writer) => {
    for (const id of ids) {
      if (!spheres.getVisible(id)) continue;
      const meta = spheres.getMetadata(id);
      if (!meta) continue;
      const angle = meta.phase + time * meta.speed;
      const wobble = Math.sin(time * 1.7 + meta.mass) * 1.4;
      writer.setTransform(id, makeMatrix(
        Math.cos(angle) * meta.radius,
        wobble,
        Math.sin(angle) * meta.radius,
        0.28 + meta.mass * 0.035
      ));
    }
  });

  const meta = selected ? spheres.getMetadata(selected) : undefined;
  ctx.panel.set("count", spheres.count);
  ctx.panel.set("visible", spheres.visibleCount);
  for (const group of groups) {
    ctx.panel.set(`${group}`, groupVisible.get(group) ? "shown" : "hidden");
  }
  ctx.panel.set("selected", selected ? Number(selected) : "-");
  ctx.panel.set("metadata", meta ? `${meta.group}, mass ${meta.mass.toFixed(1)}` : "-");
});

await runExample(ctx);
