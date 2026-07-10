import { addToScene, loadGltf, onBeforeRender, pickAsync, type Mat4, type SceneNode } from "@babylonjs/lite";
import {
  belongsToHierarchyRoot,
  composeMat4,
  createHierarchyInstanceSet,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId
} from "../../../src/index.js";
import { collectMeshes, createExample, makeMatrix, runExample } from "../../shared/app.js";

const BOOMBOX_URL = "https://playground.babylonjs.com/scenes/BoomBox.glb";

interface BoomBoxMeta {
  label: string;
  index: number;
  phase: number;
  ring: number;
}

const ctx = await createExample("BoomBox Rebuild Growth");
ctx.panel.set("asset", "loading");

const container = await loadGltf(ctx.engine, BOOMBOX_URL);
const exampleCamera = ctx.scene.camera;
addToScene(ctx.scene, container);
if (exampleCamera) {
  ctx.scene.camera = exampleCamera;
}

const root = container.entities[0];
if (!root || !isSceneNode(root)) {
  throw new Error("BoomBox GLB did not provide a root scene node");
}
const hierarchyRoot = root;

const sourceMeshes = collectMeshes(root);
makeMaterialsDoubleSided(sourceMeshes);
const sourceRootMatrix = new Float32Array(root.worldMatrix) as Mat4;

const boomboxes = createHierarchyInstanceSet<BoomBoxMeta>(root, {
  capacity: 4,
  grow: "rebuild",
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "active-count"
});

registerPoolMeshes();

const ids: InstanceId[] = [];
const modelScale = 235;
let selected: InstanceId | undefined;
let previousCapacity = boomboxes.capacity;
let rebuildCount = 0;
let nextIndex = 0;
let lastRootMatch = "-";
let lastPickDistance = "-";
let lastPickSource = "-";
let time = 0;

addBatch(4);
selected = ids[0];

ctx.panel.button("add 1", () => {
  addBatch(1);
});

ctx.panel.button("add 8", () => {
  addBatch(8);
});

ctx.panel.button("select oldest", () => {
  selected = ids.find((id) => boomboxes.has(id));
});

ctx.panel.button("select newest", () => {
  selected = findNewestId();
});

ctx.panel.button("remove selected", () => {
  const id = getSelectedId();
  if (!id) {
    return;
  }
  boomboxes.remove(id);
  selected = undefined;
});

ctx.panel.button("reset", () => {
  boomboxes.clear();
  ids.length = 0;
  selected = undefined;
  previousCapacity = boomboxes.capacity;
  rebuildCount = 0;
  nextIndex = 0;
  lastRootMatch = "-";
  lastPickDistance = "-";
  lastPickSource = "-";
  addBatch(4);
  selected = ids[0];
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickBoomBox(event);
  if (picked) {
    selected = picked;
  }
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  boomboxes.batch((writer) => {
    for (const id of ids) {
      if (!boomboxes.has(id)) {
        continue;
      }
      const meta = boomboxes.getMetadata(id);
      if (!meta) {
        continue;
      }
      const position = getCurrentPosition(meta);
      const selectedBoost = selected === id ? 1.32 : 1;
      writer.setMatrix(id, makeBoomBoxMatrix(position.x, position.y, position.z, modelScale * selectedBoost, time * 0.25 + meta.phase));
    }
  });

  selected = getSelectedId();
  const meta = selected ? boomboxes.getMetadata(selected) : undefined;
  ctx.panel.set("asset", "BoomBox.glb");
  ctx.panel.set("count", boomboxes.count);
  ctx.panel.set("visible", boomboxes.visibleCount);
  ctx.panel.set("capacity", boomboxes.capacity);
  ctx.panel.set("rebuilds", rebuildCount);
  ctx.panel.set("source meshes", sourceMeshes.length);
  ctx.panel.set("selected id", selected ? Number(selected) : "-");
  ctx.panel.set("selected slot", selected ? boomboxes.getSlot(selected) ?? "-" : "-");
  ctx.panel.set("pick mode", "hybrid");
  ctx.panel.set("pick source", lastPickSource);
  ctx.panel.set("root match", lastRootMatch);
  ctx.panel.set("pick distance", lastPickDistance);
  ctx.panel.set("metadata", meta ? meta.label : "-");
});

await runExample(ctx);

function addBatch(count: number): void {
  for (let i = 0; i < count; i++) {
    ids.push(createBoomBox(nextIndex++));
  }
  syncPoolRegistration();
}

function createBoomBox(index: number): InstanceId {
  const position = getPosition(index);
  return boomboxes.create(makeBoomBoxMatrix(position.x, 0, position.z, modelScale, index * 0.17), {
    label: `boombox-${index}`,
    index,
    phase: index * 0.37,
    ring: position.ring
  });
}

function syncPoolRegistration(): void {
  if (boomboxes.capacity === previousCapacity) {
    return;
  }
  previousCapacity = boomboxes.capacity;
  rebuildCount++;
  registerPoolMeshes();
}

function registerPoolMeshes(): void {
  ctx.registry.registerMany(boomboxes.pool.meshes, boomboxes);
}

async function pickBoomBox(event: PointerEvent): Promise<InstanceId | undefined> {
  const rect = ctx.canvas.getBoundingClientRect();
  const pick = await pickAsync(ctx.picker, event.clientX - rect.left, event.clientY - rect.top);
  const pickedMesh = pick.pickedMesh && "material" in pick.pickedMesh ? pick.pickedMesh : null;
  const registryPick = ctx.registry.fromPick({
    mesh: pickedMesh,
    thinInstanceIndex: pick.thinInstanceIndex,
    hasThinInstance: pick.thinInstanceIndex >= 0
  });
  const belongsToRoot =
    belongsToHierarchyRoot(pickedMesh, hierarchyRoot) ||
    sourceMeshes.includes(pickedMesh as never) ||
    registryPick?.set === boomboxes;
  lastRootMatch = belongsToRoot ? "yes" : "no";
  if (pick.hit && pick.pickedPoint) {
    const pickedByPoint = findNearestBoomBox(pick.pickedPoint[0], pick.pickedPoint[1], pick.pickedPoint[2]);
    if (pickedByPoint) {
      lastPickDistance = pickedByPoint.distance.toFixed(1);
      lastPickSource = "picked point";
      return pickedByPoint.id;
    }
  }

  const pickedByScreen = pickBoomBoxByScreen(event);
  lastPickSource = pickedByScreen ? "screen fallback" : "-";
  lastPickDistance = pickedByScreen ? "screen" : "-";
  return pickedByScreen;
}

function findNearestBoomBox(x: number, y: number, z: number): { id: InstanceId; distance: number } | undefined {
  let nearest: { id: InstanceId; distance: number } | undefined;
  for (const id of ids) {
    if (!boomboxes.has(id) || !boomboxes.getVisible(id)) {
      continue;
    }
    const meta = boomboxes.getMetadata(id);
    if (!meta) {
      continue;
    }
    const position = getCurrentPosition(meta);
    const dx = x - position.x;
    const dy = (y - position.y) * 0.35;
    const dz = z - position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!nearest || distance < nearest.distance) {
      nearest = { id, distance };
    }
  }
  return nearest;
}

function pickBoomBoxByScreen(event: PointerEvent): InstanceId | undefined {
  const camera = ctx.scene.camera;
  if (!camera) {
    return undefined;
  }
  return pickScreenSpaceInstanceFromPointer({
    event,
    canvas: ctx.canvas,
    camera,
    ids,
    has: (id) => boomboxes.has(id),
    isVisible: (id) => boomboxes.getVisible(id),
    getWorldPosition: (id) => {
      const meta = boomboxes.getMetadata(id);
      if (!meta) {
        return undefined;
      }
      const position = getCurrentPosition(meta);
      return [position.x, position.y, position.z];
    },
    getScreenRadius: (id) => {
      const meta = boomboxes.getMetadata(id);
      return meta ? Math.max(44, 64 - meta.ring * 2) : 44;
    }
  })?.id;
}

function getSelectedId(): InstanceId | undefined {
  return selected && boomboxes.has(selected) ? selected : undefined;
}

function findNewestId(): InstanceId | undefined {
  for (let index = ids.length - 1; index >= 0; index--) {
    const id = ids[index];
    if (id && boomboxes.has(id)) {
      return id;
    }
  }
  return undefined;
}

function getPosition(index: number): { x: number; z: number; ring: number } {
  if (index === 0) {
    return { x: 0, z: 0, ring: 0 };
  }
  const angle = index * 2.399963229728653;
  const ring = Math.ceil(Math.sqrt(index) * 0.58);
  const radius = 18 + ring * 10 + index * 0.14;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    ring
  };
}

function getCurrentPosition(meta: BoomBoxMeta): { x: number; y: number; z: number } {
  const position = getPosition(meta.index);
  return {
    x: position.x,
    y: Math.sin(time * 1.8 + meta.phase) * 2.2,
    z: position.z
  };
}

function makeBoomBoxMatrix(x: number, y: number, z: number, scale: number, yaw: number): Mat4 {
  return multiplyMat4(composeMat4(makeMatrix(x, y, z, scale, yaw)), sourceRootMatrix);
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value && "worldMatrix" in value;
}

function makeMaterialsDoubleSided(meshes: ReturnType<typeof collectMeshes>): void {
  const materials = new Set(meshes.map((mesh) => mesh.material));
  for (const material of materials) {
    if ("doubleSided" in material) {
      material.doubleSided = true;
    }
    if ("backFaceCulling" in material) {
      material.backFaceCulling = false;
    }
  }
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        mat4At(a, 0 * 4 + row) * mat4At(b, col * 4 + 0) +
        mat4At(a, 1 * 4 + row) * mat4At(b, col * 4 + 1) +
        mat4At(a, 2 * 4 + row) * mat4At(b, col * 4 + 2) +
        mat4At(a, 3 * 4 + row) * mat4At(b, col * 4 + 3);
    }
  }
  return out as Mat4;
}

function mat4At(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}
