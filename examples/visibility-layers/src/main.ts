import { createBox, createCylinder, createSphere, onBeforeRender } from "@babylonjs/lite";
import { createInstanceSet, type InstanceId, type VisibilityStrategy } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

interface LayerMeta {
  layer: "boxes" | "spheres" | "cylinders";
}

const ctx = await createExample("Visibility Layers");
const initialStrategy = new URLSearchParams(window.location.search).get("strategy");
let strategy: VisibilityStrategy = initialStrategy === "scale-zero" ? "scale-zero" : "active-count";
let selected: InstanceId | undefined;
let time = 0;

function build(strategyToUse: VisibilityStrategy) {
  const boxMesh = addMesh(ctx.scene, createBox(ctx.engine, 0.78), [0.95, 0.25, 0.28]);
  const sphereMesh = addMesh(ctx.scene, createSphere(ctx.engine, { diameter: 0.8, segments: 12 }), [0.25, 0.55, 0.95]);
  const cylinderMesh = addMesh(ctx.scene, createCylinder(ctx.engine, { height: 0.9, diameter: 0.7 }), [0.28, 0.8, 0.48]);
  const boxes = createInstanceSet<LayerMeta>(boxMesh, { capacity: 120, colors: true, engine: ctx.engine, visibleStrategy: strategyToUse });
  const spheres = createInstanceSet<LayerMeta>(sphereMesh, { capacity: 120, colors: true, engine: ctx.engine, visibleStrategy: strategyToUse });
  const cylinders = createInstanceSet<LayerMeta>(cylinderMesh, { capacity: 120, colors: true, engine: ctx.engine, visibleStrategy: strategyToUse });

  ctx.registry.register(boxMesh, boxes).register(sphereMesh, spheres).register(cylinderMesh, cylinders);

  const all: Array<{ name: LayerMeta["layer"]; set: typeof boxes; ids: InstanceId[] }> = [
    { name: "boxes", set: boxes, ids: [] },
    { name: "spheres", set: spheres, ids: [] },
    { name: "cylinders", set: cylinders, ids: [] }
  ];

  all.forEach((entry, groupIndex) => {
    for (let i = 0; i < 72; i++) {
      const ring = 5 + groupIndex * 4;
      const angle = (i / 72) * Math.PI * 2;
      const id = entry.set.create(makeMatrix(Math.cos(angle) * ring, groupIndex * 1.4, Math.sin(angle) * ring, 0.7), { layer: entry.name });
      entry.set.setColor(id, colorFromIndex(i + groupIndex * 100));
      entry.ids.push(id);
    }
  });

  return all;
}

const layers = build(strategy);
const layerVisible = new Map(layers.map((layer) => [layer.name, true]));

for (const layer of layers) {
  ctx.panel.button(`toggle ${layer.name}`, () => {
    const next = !layerVisible.get(layer.name);
    layerVisible.set(layer.name, next);
    layer.set.batch((writer) => {
      layer.ids.forEach((id) => writer.setVisible(id, next));
    });
    ctx.panel.set(layer.name, next ? "shown" : "hidden");
    ctx.panel.set("visible", layers.reduce((sum, item) => sum + item.set.visibleCount, 0));
  });
}

ctx.panel.button("switch strategy", () => {
  const next = strategy === "active-count" ? "scale-zero" : "active-count";
  window.location.search = `?strategy=${next}`;
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked) return;
  selected = picked.id;
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  for (const layer of layers) {
    layer.ids.forEach((id, index) => {
      if (!layer.set.getVisible(id)) return;
      const base = layer.set.getMetadata(id)?.layer === "boxes" ? 5 : layer.set.getMetadata(id)?.layer === "spheres" ? 9 : 13;
      const angle = (index / layer.ids.length) * Math.PI * 2 + time * 0.12;
      layer.set.setTransform(id, makeMatrix(Math.cos(angle) * base, Math.sin(time + index) * 0.35, Math.sin(angle) * base, 0.7, time * 0.3));
    });
  }

  ctx.panel.set("strategy", strategy);
  ctx.panel.set("count", layers.reduce((sum, layer) => sum + layer.set.count, 0));
  ctx.panel.set("visible", layers.reduce((sum, layer) => sum + layer.set.visibleCount, 0));
  for (const layer of layers) {
    ctx.panel.set(layer.name, layerVisible.get(layer.name) ? "shown" : "hidden");
  }
  ctx.panel.set("selected", selected ? Number(selected) : "-");
});

await runExample(ctx);
