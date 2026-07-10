import { createBox, createCylinder, createSphere, onBeforeRender } from "@babylonjs/lite";
import { createInstanceSet, type ColoredInstanceSet, type InstanceId, type VisibilityStrategy } from "../../../src/index.js";
import { addMesh, colorFromIndex, createExample, makeMatrix, pickInstance, runExample } from "../../shared/app.js";

type PrimitiveKind = "box" | "sphere" | "cylinder";

interface PrimitiveMeta {
  kind: PrimitiveKind;
  label: string;
  orbit: number;
  phase: number;
  speed: number;
  size: number;
  colorSeed: number;
}

interface PrimitiveLayer {
  kind: PrimitiveKind;
  set: ColoredInstanceSet<PrimitiveMeta>;
  ids: InstanceId[];
  visible: boolean;
  offset: number;
}

const ctx = await createExample("Primitive Mixed Playground");
const initialStrategy = new URLSearchParams(window.location.search).get("strategy");
let strategy: VisibilityStrategy = initialStrategy === "scale-zero" ? "scale-zero" : "active-count";

const boxMesh = addMesh(ctx.scene, createBox(ctx.engine, 0.84), [0.92, 0.28, 0.3]);
const sphereMesh = addMesh(ctx.scene, createSphere(ctx.engine, { diameter: 0.86, segments: 16 }), [0.22, 0.52, 0.95]);
const cylinderMesh = addMesh(ctx.scene, createCylinder(ctx.engine, { height: 0.95, diameter: 0.72 }), [0.28, 0.82, 0.5]);

const layers: PrimitiveLayer[] = [
  {
    kind: "box",
    set: createInstanceSet<PrimitiveMeta>(boxMesh, { capacity: 32, colors: true, engine: ctx.engine, visibleStrategy: strategy }),
    ids: [],
    visible: true,
    offset: -5.5
  },
  {
    kind: "sphere",
    set: createInstanceSet<PrimitiveMeta>(sphereMesh, { capacity: 48, colors: true, engine: ctx.engine, visibleStrategy: strategy }),
    ids: [],
    visible: true,
    offset: 0
  },
  {
    kind: "cylinder",
    set: createInstanceSet<PrimitiveMeta>(cylinderMesh, { capacity: 40, colors: true, engine: ctx.engine, visibleStrategy: strategy }),
    ids: [],
    visible: true,
    offset: 5.5
  }
];

ctx.registry.register(boxMesh, layers[0]!.set).register(sphereMesh, layers[1]!.set).register(cylinderMesh, layers[2]!.set);

let selected: { kind: PrimitiveKind; id: InstanceId } | undefined;
let spawnIndex = 0;
let colorRevision = 0;
let lastAction = "-";
let time = 0;

for (const layer of layers) {
  for (let index = 0; index < 14; index++) {
    spawn(layer.kind);
  }
}

for (const layer of layers) {
  ctx.panel.button(`spawn ${layer.kind}`, () => {
    const id = spawn(layer.kind);
    selected = { kind: layer.kind, id };
    lastAction = `spawned ${layer.kind}`;
  });

  ctx.panel.button(`toggle ${layer.kind}`, () => {
    layer.visible = !layer.visible;
    layer.set.batch((writer) => {
      for (const id of layer.ids) {
        if (layer.set.has(id)) {
          writer.setVisible(id, layer.visible);
        }
      }
    });
    if (selected?.kind === layer.kind && selected.id && !layer.visible) {
      selected = undefined;
    }
    lastAction = `${layer.kind} ${layer.visible ? "shown" : "hidden"}`;
  });
}

ctx.panel.button("remove selected", () => {
  const item = getSelected();
  if (!item) {
    return;
  }
  item.layer.set.remove(item.id);
  removeId(item.layer, item.id);
  lastAction = `removed ${item.meta.label}`;
  selected = undefined;
});

ctx.panel.button("recolor selected", () => {
  const item = getSelected();
  if (!item) {
    return;
  }
  setColorSeed(item.layer, item.id, nextColorSeed(item.layer.kind));
  lastAction = `recolored ${item.meta.label}`;
});

ctx.panel.button("recolor all", () => {
  colorRevision++;
  for (const layer of layers) {
    layer.ids.forEach((id, index) => {
      if (layer.set.has(id)) {
        setColorSeed(layer, id, colorOffset(layer.kind) + colorRevision * 37 + index);
      }
    });
  }
  lastAction = "recolored all";
});

ctx.panel.button("switch strategy", () => {
  const next = strategy === "active-count" ? "scale-zero" : "active-count";
  window.location.search = `?strategy=${next}`;
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickInstance(ctx, event);
  if (!picked) {
    return;
  }
  const layer = layers.find((item) => item.set === picked.set);
  if (!layer || !layer.set.has(picked.id)) {
    return;
  }
  selected = { kind: layer.kind, id: picked.id };
  const meta = layer.set.getMetadata(picked.id);
  if (meta) {
    lastAction = `picked ${meta.label}`;
  }
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  for (const layer of layers) {
    layer.set.batch((writer) => {
      for (const id of layer.ids) {
        if (!layer.set.has(id) || !layer.set.getVisible(id)) {
          continue;
        }
        const meta = layer.set.getMetadata(id);
        if (!meta) {
          continue;
        }
        const angle = meta.phase + time * meta.speed;
        const selectedBoost = selected?.kind === layer.kind && selected.id === id ? 1.28 : 1;
        writer.setTransform(
          id,
          makeMatrix(
            layer.offset + Math.cos(angle) * meta.orbit,
            Math.sin(time * 1.7 + meta.phase) * 0.7,
            Math.sin(angle) * meta.orbit,
            meta.size * selectedBoost,
            time * 0.45 + meta.phase
          )
        );
      }
    });
  }

  const item = getSelected();
  ctx.panel.set("strategy", strategy);
  ctx.panel.set("sets", layers.length);
  ctx.panel.set("count", layers.reduce((sum, layer) => sum + layer.set.count, 0));
  ctx.panel.set("visible", layers.reduce((sum, layer) => sum + layer.set.visibleCount, 0));
  ctx.panel.set("selected id", item ? Number(item.id) : "-");
  ctx.panel.set("selected set", item ? item.layer.kind : "-");
  ctx.panel.set("selected slot", item ? item.layer.set.getSlot(item.id) ?? "-" : "-");
  ctx.panel.set("metadata", item ? item.meta.label : "-");
  ctx.panel.set("last action", lastAction);
  for (const layer of layers) {
    ctx.panel.set(`${layer.kind}s`, `${layer.visible ? "shown" : "hidden"} ${layer.set.count}/${layer.set.capacity}`);
  }
});

await runExample(ctx);

function spawn(kind: PrimitiveKind): InstanceId {
  const layer = getLayer(kind);
  const index = spawnIndex++;
  const meta: PrimitiveMeta = {
    kind,
    label: `${kind}-${index}`,
    orbit: 1.5 + (index % 5) * 0.42,
    phase: index * 0.74,
    speed: 0.2 + (index % 7) * 0.045,
    size: 0.58 + (index % 4) * 0.08,
    colorSeed: index + colorOffset(kind)
  };
  const id = layer.set.create(makeMatrix(layer.offset + meta.orbit, 0, 0, meta.size), meta);
  applyColor(layer, id);
  layer.set.setVisible(id, layer.visible);
  layer.ids.push(id);
  return id;
}

function applyColor(layer: PrimitiveLayer, id: InstanceId): void {
  const meta = layer.set.getMetadata(id);
  if (meta) {
    layer.set.setColor(id, colorFromIndex(meta.colorSeed));
  }
}

function setColorSeed(layer: PrimitiveLayer, id: InstanceId, colorSeed: number): void {
  const meta = layer.set.getMetadata(id);
  if (!meta) {
    return;
  }
  layer.set.setMetadata(id, { ...meta, colorSeed });
  layer.set.setColor(id, colorFromIndex(colorSeed));
}

function nextColorSeed(kind: PrimitiveKind): number {
  colorRevision++;
  return colorOffset(kind) + colorRevision * 37 + spawnIndex;
}

function colorOffset(kind: PrimitiveKind): number {
  switch (kind) {
    case "box":
      return 0;
    case "sphere":
      return 100;
    case "cylinder":
      return 200;
  }
}

function getLayer(kind: PrimitiveKind): PrimitiveLayer {
  const layer = layers.find((item) => item.kind === kind);
  if (!layer) {
    throw new Error(`Unknown primitive layer ${kind}`);
  }
  return layer;
}

function getSelected():
  | { layer: PrimitiveLayer; id: InstanceId; meta: PrimitiveMeta }
  | undefined {
  if (!selected) {
    return undefined;
  }
  const layer = getLayer(selected.kind);
  if (!layer.set.has(selected.id)) {
    return undefined;
  }
  const meta = layer.set.getMetadata(selected.id);
  return meta ? { layer, id: selected.id, meta } : undefined;
}

function removeId(layer: PrimitiveLayer, id: InstanceId): void {
  const index = layer.ids.indexOf(id);
  if (index >= 0) {
    layer.ids.splice(index, 1);
  }
}
