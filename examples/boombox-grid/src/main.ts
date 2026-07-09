import { addToScene, loadGltf, onBeforeRender, pickAsync, type Mat4, type SceneNode } from "@babylonjs/lite";
import { composeMat4, createHierarchyInstanceSet, type InstanceId } from "../../../src/index.js";
import { collectMeshes, createExample, makeMatrix, runExample } from "../../shared/app.js";

const BOOMBOX_URL = "https://playground.babylonjs.com/scenes/BoomBox.glb";

interface BoomBoxMeta {
  label: string;
  row: number;
  col: number;
  phase: number;
  removed: boolean;
}

const ctx = await createExample("BoomBox Grid");
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

const sourceMeshes = collectMeshes(root);
makeMaterialsDoubleSided(sourceMeshes);
const sourceRootMatrix = new Float32Array(root.worldMatrix) as Mat4;

const boomboxes = createHierarchyInstanceSet<BoomBoxMeta>(root, {
  capacity: 96,
  engine: ctx.engine,
  gpuCulling: true,
  visibleStrategy: "scale-zero"
});

ctx.registry.registerMany(boomboxes.pool.meshes, boomboxes);

const ids: InstanceId[] = [];
const activeIds = new Set<InstanceId>();
const size = 8;
const gap = 24;
const modelScale = 260;

for (let row = 0; row < size; row++) {
  for (let col = 0; col < size; col++) {
    const id = createBoomBox(row, col);
    ids.push(id);
  }
}

let selected: InstanceId | undefined;
let selectedSlot: number | undefined;
let time = 0;

ctx.panel.button("remove selected", () => {
  const id = getSelectedId();
  if (!id) {
    return;
  }
  const meta = boomboxes.getMetadata(id);
  if (meta) {
    meta.removed = true;
  }
  boomboxes.setVisible(id, false);
  activeIds.delete(id);
  selected = undefined;
  selectedSlot = undefined;
});

ctx.panel.button("remove random", () => {
  const active = ids.filter((id) => activeIds.has(id));
  if (active.length === 0) {
    return;
  }
  const id = active[Math.floor(Math.random() * active.length)];
  if (!id) {
    return;
  }
  const meta = boomboxes.getMetadata(id);
  if (meta) {
    meta.removed = true;
  }
  boomboxes.setVisible(id, false);
  activeIds.delete(id);
  if (selected === id) {
    selected = undefined;
    selectedSlot = undefined;
  }
});

ctx.panel.button("toggle selected", () => {
  const id = getSelectedId();
  if (!id) {
    return;
  }
  boomboxes.setVisible(id, !boomboxes.getVisible(id));
  selected = id;
  selectedSlot = boomboxes.getSlot(id);
});

ctx.panel.button("show all", () => {
  boomboxes.batch((writer) => {
    for (let index = 0; index < size * size; index++) {
      const id = ids[index];
      if (id && boomboxes.has(id)) {
        const meta = boomboxes.getMetadata(id);
        if (meta) {
          meta.removed = false;
        }
        writer.setVisible(id, true);
        activeIds.add(id);
        continue;
      }

      const row = Math.floor(index / size);
      const col = index % size;
      ids[index] = createBoomBox(row, col);
    }
  });
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const picked = await pickBoomBox(event);
  if (!picked) {
    return;
  }
  selected = picked;
  selectedSlot = boomboxes.getSlot(picked);
});

onBeforeRender(ctx.scene, (deltaMs) => {
  time += deltaMs * 0.001;
  boomboxes.batch((writer) => {
    for (const id of activeIds) {
      const meta = boomboxes.getMetadata(id);
      if (!meta) {
        continue;
      }
      const selectedBoost = selected === id ? 1.28 : 1;
      const x = gridX(meta.col);
      const z = gridZ(meta.row);
      const y = Math.sin(time * 2 + meta.phase) * 3.5;
      const yaw = time * 0.35 + meta.phase;
      writer.setMatrix(id, makeBoomBoxMatrix(x, y, z, modelScale * selectedBoost, yaw));
    }
  });

  selected = getSelectedId();
  selectedSlot = selected ? boomboxes.getSlot(selected) : undefined;
  const meta = selected ? boomboxes.getMetadata(selected) : undefined;
  ctx.panel.set("asset", "BoomBox.glb");
  ctx.panel.set("count", boomboxes.count);
  ctx.panel.set("visible", boomboxes.visibleCount);
  ctx.panel.set("capacity", boomboxes.capacity);
  ctx.panel.set("source meshes", sourceMeshes.length);
  ctx.panel.set("selected", selected ? Number(selected) : "-");
  ctx.panel.set("metadata", meta ? meta.label : "-");
});

await runExample(ctx);

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

function createBoomBox(row: number, col: number): InstanceId {
  const x = gridX(col);
  const z = gridZ(row);
  const id = boomboxes.create(makeBoomBoxMatrix(x, 0, z, modelScale, (row + col) * 0.18), {
    label: `boombox-${row}-${col}`,
    row,
    col,
    phase: row * 0.37 + col * 0.23,
    removed: false
  });
  activeIds.add(id);
  return id;
}

async function pickBoomBox(event: PointerEvent): Promise<InstanceId | undefined> {
  const rect = ctx.canvas.getBoundingClientRect();
  const pick = await pickAsync(ctx.picker, event.clientX - rect.left, event.clientY - rect.top);
  if (!pick.hit || !pick.pickedPoint || !sourceMeshes.includes(pick.pickedMesh as never)) {
    return undefined;
  }
  return findNearestVisibleBoomBox(pick.pickedPoint[0], pick.pickedPoint[2]);
}

function findNearestVisibleBoomBox(x: number, z: number): InstanceId | undefined {
  let nearest: InstanceId | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const id of activeIds) {
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
  if (selected && boomboxes.has(selected)) {
    return selected;
  }
  if (selectedSlot === undefined) {
    return undefined;
  }
  const id = boomboxes.getIdForSlot(selectedSlot);
  return id && boomboxes.has(id) ? id : undefined;
}

function makeBoomBoxMatrix(x: number, y: number, z: number, scale: number, yaw: number): Mat4 {
  return multiplyMat4(composeMat4(makeMatrix(x, y, z, scale, yaw)), sourceRootMatrix);
}

function gridX(col: number): number {
  return (col - (size - 1) / 2) * gap;
}

function gridZ(row: number): number {
  return (row - (size - 1) / 2) * gap;
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
