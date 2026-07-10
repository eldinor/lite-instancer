import {
  addToScene,
  loadGltf,
  onBeforeRender,
  playAnimation,
  stopAnimation,
  type Mat4,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import {
  composeMat4,
  createHierarchyInstanceSet,
  createVatInstanceSet,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId
} from "../../../src/index.js";
import { collectMeshes, createExample, makeMatrix, runExample } from "../../shared/app.js";

const SHARK_URL = "https://assets.babylonjs.com/meshes/shark.glb";

interface SharkMeta {
  label: string;
  lane: number;
  baseX: number;
  baseZ: number;
  speed: number;
  phase: number;
  depth: number;
  scale: number;
}

const ctx = await createExample("Shark School");
ctx.panel.set("asset", "loading");
const vatEnabled = new URLSearchParams(window.location.search).get("vat") !== "0";

const container = await loadGltf(ctx.engine, SHARK_URL);
const exampleCamera = ctx.scene.camera;
addToScene(ctx.scene, container);
if (exampleCamera) {
  ctx.scene.camera = exampleCamera;
}

const root = container.entities[0];
if (!root || !isSceneNode(root)) {
  throw new Error("Shark GLB did not provide a root scene node");
}

const sourceMeshes = collectMeshes(root);
makeMaterialsDoubleSided(sourceMeshes);
const sourceRootMatrix = new Float32Array(root.worldMatrix) as Mat4;
const animationGroups = container.animationGroups ?? [];
let activeAnimationIndex = 0;
applyAnimationGroup(activeAnimationIndex);
const skinnedMeshes = sourceMeshes.filter(hasSkeleton);
const vatSet = vatEnabled && skinnedMeshes[0]
  ? createVatInstanceSet<SharkMeta>(ctx.engine, skinnedMeshes[0], animationGroups, {
      capacity: 48,
      engine: ctx.engine,
      visibleStrategy: "scale-zero"
    })
  : undefined;
const vatInstanceMesh = vatSet?.mesh;
const hierarchySet = vatSet ? undefined : createHierarchyInstanceSet<SharkMeta>(root, {
      capacity: 48,
      engine: ctx.engine,
      gpuCulling: true,
      visibleStrategy: "scale-zero"
    });
const sharks = vatSet ? vatSet.set : hierarchySet!;

if (vatInstanceMesh) {
  ctx.registry.register(vatInstanceMesh, sharks);
} else if (hierarchySet) {
  ctx.registry.registerMany(hierarchySet.pool.meshes, hierarchySet);
}

const ids: InstanceId[] = [];
const sharkCount = 28;
const modelScale = 0.9;

for (let index = 0; index < sharkCount; index++) {
  const columns = 7;
  const lane = Math.floor(index / columns);
  const column = index % columns;
  const jitterX = (Math.random() - 0.5) * 3;
  const jitterZ = (Math.random() - 0.5) * 3.6;
  const meta = {
    label: `shark-${index}`,
    lane,
    baseX: (column - (columns - 1) * 0.5) * 8.4 + jitterX,
    baseZ: (lane - 1.5) * 10.4 + (column % 2) * 2.8 + jitterZ,
    speed: 0.16 + Math.random() * 0.18,
    phase: (index / sharkCount) * Math.PI * 2,
    depth: -lane * 0.9 + Math.random() * 0.6,
    scale: modelScale * (0.78 + Math.random() * 0.36)
  };
  const movement = getSharkMovement(meta, false);
  const transform = makeSharkMatrix(movement.x, movement.y, movement.z, modelScale);
  const id = createShark(transform, meta, { offset: 0 });
  ids.push(id);
}

playVatAnimation();

let selected: InstanceId | undefined;
let paused = false;
let scattered = false;
let time = 0;

ctx.panel.button("pause", () => {
  paused = !paused;
});

ctx.panel.button("next animation", () => {
  if (animationGroups.length === 0) {
    return;
  }
  activeAnimationIndex = (activeAnimationIndex + 1) % animationGroups.length;
  applyAnimationGroup(activeAnimationIndex);
  playVatAnimation();
});

ctx.panel.button("scatter", () => {
  scattered = true;
});

ctx.panel.button("regroup", () => {
  scattered = false;
});

ctx.panel.button("hide selected", () => {
  if (!selected || !sharks.has(selected)) {
    return;
  }
  sharks.setVisible(selected, false);
  selected = undefined;
});

ctx.panel.button("show all", () => {
  sharks.batch((writer) => {
    for (const id of ids) {
      writer.setVisible(id, true);
    }
  });
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const id = await pickShark(event);
  if (!id) {
    return;
  }
  selected = id;
});

onBeforeRender(ctx.scene, (deltaMs) => {
  if (!paused) {
    time += deltaMs * 0.001;
    vatSet?.update(deltaMs * 0.001);
  }

  sharks.batch((writer) => {
    for (const id of ids) {
      if (!sharks.getVisible(id)) {
        continue;
      }
      const meta = sharks.getMetadata(id);
      if (!meta) {
        continue;
      }
      const movement = getSharkMovement(meta, scattered);
      const selectedScale = selected === id ? meta.scale * 1.25 : meta.scale;
      writer.setMatrix(id, makeSharkMatrix(movement.x, movement.y, movement.z, selectedScale));
    }
  });

  const meta = selected && sharks.has(selected) ? sharks.getMetadata(selected) : undefined;
  ctx.panel.set("asset", "shark.glb");
  ctx.panel.set("count", sharks.count);
  ctx.panel.set("visible", sharks.visibleCount);
  ctx.panel.set("source meshes", sourceMeshes.length);
  ctx.panel.set("skinned meshes", skinnedMeshes.length);
  ctx.panel.set("vat meshes", vatSet ? 1 : 0);
  ctx.panel.set("animations", getAnimationStatus());
  ctx.panel.set("active animation", getActiveAnimationName());
  ctx.panel.set("phase mode", vatSet ? "shared offset" : "source animation");
  ctx.panel.set("vat mode", vatInstanceMesh ? "single skinned mesh" : vatEnabled ? "unavailable" : "off (?vat=0)");
  ctx.panel.set("mode", paused ? "paused" : scattered ? "scatter" : "school");
  ctx.panel.set("selected", selected && sharks.has(selected) ? Number(selected) : "-");
  ctx.panel.set("metadata", meta ? `${meta.label}, lane ${meta.lane}` : "-");
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

function hasSkeleton(mesh: Mesh): boolean {
  return !!mesh.skeleton;
}

function createShark(transform: Mat4, metadata: SharkMeta, options: { offset?: number } = {}): InstanceId {
  if (vatSet) {
    return vatSet.create({
      transform,
      metadata,
      ...options
    });
  }
  return hierarchySet!.create(transform, metadata);
}

function playVatAnimation(): void {
  const group = animationGroups[activeAnimationIndex];
  if (!group || !vatSet) {
    return;
  }
  vatSet.play(group.name);
}

function applyAnimationGroup(index: number): void {
  for (let groupIndex = 0; groupIndex < animationGroups.length; groupIndex++) {
    const group = animationGroups[groupIndex];
    if (!group) {
      continue;
    }
    group.loopAnimation = true;
    group.currentTime = 0;
    if (groupIndex === index) {
      playAnimation(group);
    } else {
      stopAnimation(group);
    }
  }
}

async function pickShark(event: PointerEvent): Promise<InstanceId | undefined> {
  const camera = ctx.scene.camera;
  if (!camera) {
    return undefined;
  }
  return pickScreenSpaceInstanceFromPointer({
    event,
    canvas: ctx.canvas,
    camera,
    ids,
    has: (id) => sharks.has(id),
    isVisible: (id) => sharks.getVisible(id),
    getWorldPosition: (id) => {
      const meta = sharks.getMetadata(id);
      if (!meta) {
        return undefined;
      }
      const movement = getSharkMovement(meta, scattered);
      return [movement.x, movement.y, movement.z];
    },
    getScreenRadius: (id) => {
      const meta = sharks.getMetadata(id);
      return meta ? Math.max(24, 44 * meta.scale) : 24;
    }
  })?.id;
}

function getSharkMovement(meta: SharkMeta, scatter: boolean): { x: number; y: number; z: number } {
  const scatterAmount = scatter ? 1 : 0;
  const x = meta.baseX + Math.cos(meta.phase) * scatterAmount * (8.4 + meta.lane * 1.6);
  const z = meta.baseZ + Math.sin(meta.phase) * scatterAmount * (7.6 + meta.lane * 1.4);
  const y = meta.depth + Math.sin(meta.phase) * (scatter ? 1.2 : 0.35);
  return { x, y, z };
}

function getAnimationStatus(): string {
  if (animationGroups.length === 0) {
    return "none";
  }
  if (vatSet) {
    return `VAT 1 mesh / ${animationGroups.length} clip${animationGroups.length === 1 ? "" : "s"}`;
  }
  const playing = animationGroups.filter((group) => group.isPlaying).length;
  return `${playing}/${animationGroups.length} live source`;
}

function getActiveAnimationName(): string {
  return animationGroups[activeAnimationIndex]?.name ?? "-";
}

function makeSharkMatrix(x: number, y: number, z: number, scale: number): Mat4 {
  const placement = composeMat4(makeMatrix(x, y, z, scale));
  return vatInstanceMesh ? placement : multiplyMat4(placement, sourceRootMatrix);
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
