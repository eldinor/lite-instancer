import { addToScene, loadGltf, onBeforeRender, pickAsync, type Mat4, type SceneNode } from "@babylonjs/lite";
import { belongsToHierarchyRoot, composeMat4, createHierarchyInstanceSet, type InstanceId } from "../../../src/index.js";
import { collectMeshes, createExample, makeMatrix, runExample } from "../../shared/app.js";

const BOOMBOX_URL = "https://playground.babylonjs.com/scenes/BoomBox.glb";

interface BoomBoxMeta {
  label: string;
  row: number;
  col: number;
  phase: number;
}

const ctx = await createExample("BoomBox Picker");
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
  capacity: 32,
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "active-count"
});

ctx.registry.registerMany(boomboxes.pool.meshes, boomboxes);

const ids: InstanceId[] = [];
const liveIds = new Set<InstanceId>();
const rows = 4;
const cols = 6;
const gap = 26;
const modelScale = 270;

resetGrid();

let selected: InstanceId | undefined;
let lastRegistrySlot: number | undefined;
let lastRegistryLabel = "-";
let lastRootMatch = "-";
let lastRemoved = "-";
let time = 0;

ctx.panel.button("remove selected", () => {
  const id = getSelectedId();
  if (!id) {
    return;
  }
  const meta = boomboxes.getMetadata(id);
  lastRemoved = meta?.label ?? String(Number(id));
  boomboxes.remove(id);
  liveIds.delete(id);
  selected = undefined;
  lastRegistrySlot = undefined;
  lastRegistryLabel = "-";
  lastRootMatch = "-";
});

ctx.panel.button("remove random", () => {
  const active = [...liveIds];
  const id = active[Math.floor(Math.random() * active.length)];
  if (!id) {
    return;
  }
  const meta = boomboxes.getMetadata(id);
  lastRemoved = meta?.label ?? String(Number(id));
  boomboxes.remove(id);
  liveIds.delete(id);
  if (selected === id) {
    selected = undefined;
    lastRegistrySlot = undefined;
    lastRegistryLabel = "-";
    lastRootMatch = "-";
  }
});

ctx.panel.button("reset", () => {
  resetGrid();
  selected = undefined;
  lastRegistrySlot = undefined;
  lastRegistryLabel = "-";
  lastRootMatch = "-";
  lastRemoved = "-";
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickBoomBox(event);
  if (!picked) {
    return;
  }
  selected = picked.logicalId;
  lastRegistrySlot = picked.registrySlot;
  lastRegistryLabel = picked.registryId ? boomboxes.getMetadata(picked.registryId)?.label ?? "-" : "-";
  lastRootMatch = picked.belongsToRoot ? "yes" : "no";
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;

  boomboxes.batch((writer) => {
    for (const id of liveIds) {
      const meta = boomboxes.getMetadata(id);
      if (!meta) {
        continue;
      }
      const selectedBoost = selected === id ? 1.32 : 1;
      const y = Math.sin(time * 1.6 + meta.phase) * 2.5;
      writer.setMatrix(id, makeBoomBoxMatrix(gridX(meta.col), y, gridZ(meta.row), modelScale * selectedBoost, meta.phase));
    }
  });

  selected = getSelectedId();
  const currentSlot = selected ? boomboxes.getSlot(selected) : undefined;
  const meta = selected ? boomboxes.getMetadata(selected) : undefined;

  ctx.panel.set("asset", "BoomBox.glb");
  ctx.panel.set("count", boomboxes.count);
  ctx.panel.set("visible", boomboxes.visibleCount);
  ctx.panel.set("capacity", boomboxes.capacity);
  ctx.panel.set("source meshes", sourceMeshes.length);
  ctx.panel.set("selected id", selected ? Number(selected) : "-");
  ctx.panel.set("selected slot", currentSlot ?? "-");
  ctx.panel.set("registry slot", lastRegistrySlot ?? "-");
  ctx.panel.set("registry label", lastRegistryLabel);
  ctx.panel.set("root match", lastRootMatch);
  ctx.panel.set("metadata", meta ? meta.label : "-");
  ctx.panel.set("last removed", lastRemoved);
});

await runExample(ctx);

function resetGrid(): void {
  boomboxes.clear();
  ids.length = 0;
  liveIds.clear();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = createBoomBox(row, col);
      ids.push(id);
      liveIds.add(id);
    }
  }
}

function createBoomBox(row: number, col: number): InstanceId {
  return boomboxes.create(makeBoomBoxMatrix(gridX(col), 0, gridZ(row), modelScale, (row + col) * 0.14), {
    label: `boombox-${row}-${col}`,
    row,
    col,
    phase: row * 0.41 + col * 0.29
  });
}

async function pickBoomBox(event: PointerEvent): Promise<{
  logicalId: InstanceId;
  registryId?: InstanceId;
  registrySlot?: number;
  belongsToRoot: boolean;
} | undefined> {
  const rect = ctx.canvas.getBoundingClientRect();
  const pick = await pickAsync(ctx.picker, event.clientX - rect.left, event.clientY - rect.top);
  const pickedMesh = pick.pickedMesh && "material" in pick.pickedMesh ? pick.pickedMesh : null;
  const belongsToRoot = belongsToHierarchyRoot(pickedMesh, hierarchyRoot);
  if (!pick.hit || !pick.pickedPoint || !belongsToRoot) {
    return undefined;
  }

  const registryPick = ctx.registry.fromPick({
    mesh: pickedMesh,
    thinInstanceIndex: pick.thinInstanceIndex,
    hasThinInstance: pick.thinInstanceIndex >= 0
  });
  const logicalId = findNearestVisibleBoomBox(pick.pickedPoint[0], pick.pickedPoint[2]);
  if (!logicalId) {
    return undefined;
  }
  const result: { logicalId: InstanceId; registryId?: InstanceId; registrySlot?: number; belongsToRoot: boolean } = {
    logicalId,
    belongsToRoot
  };
  if (registryPick?.set === boomboxes) {
    result.registryId = registryPick.id;
    result.registrySlot = registryPick.slot;
  }
  return result;
}

function findNearestVisibleBoomBox(x: number, z: number): InstanceId | undefined {
  let nearest: InstanceId | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const id of liveIds) {
    const meta = boomboxes.getMetadata(id);
    if (!meta || !boomboxes.getVisible(id)) {
      continue;
    }
    const dx = x - gridX(meta.col);
    const dz = z - gridZ(meta.row);
    const distance = dx * dx + dz * dz;
    if (distance < nearestDistance) {
      nearest = id;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function getSelectedId(): InstanceId | undefined {
  return selected && boomboxes.has(selected) ? selected : undefined;
}

function makeBoomBoxMatrix(x: number, y: number, z: number, scale: number, yaw: number): Mat4 {
  return multiplyMat4(composeMat4(makeMatrix(x, y, z, scale, yaw)), sourceRootMatrix);
}

function gridX(col: number): number {
  return (col - (cols - 1) / 2) * gap;
}

function gridZ(row: number): number {
  return (row - (rows - 1) / 2) * gap;
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
