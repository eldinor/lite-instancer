import {
  addToScene,
  loadGltf,
  onBeforeRender,
  stopAnimation,
  type Mat4,
  type Mesh,
  type SceneNode,
} from "@babylonjs/lite";
import {
  composeMat4,
  createVatInstanceSet,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId,
} from "../../../dist/index.js";
import { collectMeshes, createExample, makeMatrix, runExample } from "../../shared/app.js";

const PLANE_URL = "https://assets.babylonjs.com/meshes/Demos/optimized/acrobaticPlane_variants.glb";

interface PlaneMeta {
  label: string;
  lane: number;
  clip: string;
  radius: number;
  angle: number;
  altitude: number;
  speed: number;
  scale: number;
}

const ctx = await createExample("Dist VAT Acrobatic Plane");
ctx.panel.set("asset", "loading");
ctx.panel.set("package", "dist/index.js");
if (ctx.scene.camera && "radius" in ctx.scene.camera && typeof ctx.scene.camera.radius === "number") {
  ctx.scene.camera.radius *= 12;
}

const container = await loadGltf(ctx.engine, PLANE_URL);
const exampleCamera = ctx.scene.camera;
addToScene(ctx.scene, container);
if (exampleCamera) {
  ctx.scene.camera = exampleCamera;
}

const root = container.entities[0];
if (!root || !isSceneNode(root)) {
  throw new Error("Acrobatic plane GLB did not provide a root scene node");
}

const sourceMeshes = collectMeshes(root);
makeMaterialsDoubleSided(sourceMeshes);
const skinnedMesh = sourceMeshes.find(hasSkeleton);
const animationGroups = container.animationGroups ?? [];

if (!skinnedMesh) {
  throw new Error("Acrobatic plane GLB did not provide a skinned mesh for VAT");
}
if (animationGroups.length === 0) {
  throw new Error("Acrobatic plane GLB did not provide animation groups for VAT");
}

for (const group of animationGroups) {
  stopAnimation(group);
}

const clipNames = animationGroups.map((group) => group.name);
let activeClipIndex = Math.max(0, clipNames.indexOf("idle"));
let phaseSeed = 0;
const initialClip = clipNames[activeClipIndex];

const planes = createVatInstanceSet<PlaneMeta>(ctx.engine, skinnedMesh, animationGroups, {
  capacity: 40,
  engine: ctx.engine,
  visibleStrategy: "scale-zero",
  ...(initialClip ? { clip: initialClip } : {}),
});

const ids: InstanceId[] = [];
const planeCount = 24;
const modelScale = 260;
let selected: InstanceId | undefined;
let paused = false;
let spiral = false;
let time = 0;

for (let index = 0; index < planeCount; index++) {
  const lane = index % 3;
  const clip = clipNames[(index + lane) % clipNames.length] ?? clipNames[activeClipIndex] ?? "";
  const angle = (index / planeCount) * Math.PI * 2;
  const meta: PlaneMeta = {
    label: `plane-${index}`,
    lane,
    clip,
    radius: 8 + lane * 3,
    angle,
    altitude: 1.2 + lane * 1.05,
    speed: 0.18 + lane * 0.035 + fractional(index * 0.31) * 0.04,
    scale: modelScale * (0.86 + fractional(index * 0.47) * 0.22),
  };
  const movement = getPlaneMovement(meta, 0);
  ids.push(
    planes.create({
      transform: makePlaneMatrix(movement, meta.scale),
      metadata: meta,
      clip,
      offset: index * 0.17,
      fps: getClipFps(clip) * (0.9 + fractional(index * 0.29) * 0.22),
    }),
  );
}

planes.play(clipNames[activeClipIndex] ?? "");
applyPhaseOffsets();

ctx.panel.button("pause", () => {
  paused = !paused;
});

ctx.panel.button("next clip", () => {
  activeClipIndex = (activeClipIndex + 1) % clipNames.length;
  const clip = clipNames[activeClipIndex];
  if (clip) {
    planes.play(clip);
  }
  applyPhaseOffsets();
});

ctx.panel.button("shuffle phases", () => {
  phaseSeed++;
  applyPhaseOffsets();
});

ctx.panel.button("spiral", () => {
  spiral = !spiral;
});

ctx.panel.button("hide selected", () => {
  if (!selected || !planes.has(selected)) {
    return;
  }
  planes.setVisible(selected, false);
  selected = undefined;
});

ctx.panel.button("show all", () => {
  planes.setVisibleMany(ids, true);
});

ctx.canvas.addEventListener("pointerdown", async (event) => {
  const id = await pickPlane(event);
  if (id) {
    selected = id;
  }
});

onBeforeRender(ctx.scene, (deltaMs) => {
  const deltaSeconds = deltaMs * 0.001;
  if (!paused) {
    time += deltaSeconds;
    planes.update(deltaSeconds);
  }

  planes.batch((writer) => {
    for (const id of ids) {
      if (!planes.getVisible(id)) {
        continue;
      }
      const meta = planes.getMetadata(id);
      if (!meta) {
        continue;
      }
      const movement = getPlaneMovement(meta, time);
      const scale = selected === id ? meta.scale * 1.25 : meta.scale;
      writer.setMatrix(id, makePlaneMatrix(movement, scale));
    }
  });

  const meta = selected && planes.has(selected) ? planes.getMetadata(selected) : undefined;
  ctx.panel.set("asset", "acrobaticPlane_variants.glb");
  ctx.panel.set("package", "dist/index.js");
  ctx.panel.set("count", planes.count);
  ctx.panel.set("visible", planes.visibleCount);
  ctx.panel.set("source meshes", sourceMeshes.length);
  ctx.panel.set("skinned mesh", skinnedMesh.name ?? "yes");
  ctx.panel.set("animations", clipNames.join(", "));
  ctx.panel.set("active clip", planes.activeClip ?? "-");
  ctx.panel.set("mode", paused ? "paused" : spiral ? "spiral" : "orbit");
  ctx.panel.set("selected", selected && planes.has(selected) ? Number(selected) : "-");
  ctx.panel.set("metadata", meta ? `${meta.label}, lane ${meta.lane}, ${meta.clip}` : "-");
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

function applyPhaseOffsets(): void {
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    if (id === undefined || !planes.has(id)) {
      continue;
    }
    const clip = planes.getClip(id) ?? planes.activeClip;
    const fps = getClipFps(clip);
    const frameCount = getClipFrameCount(clip);
    const durationSeconds = fps > 0 ? frameCount / fps : 0;
    const phase = fractional(index * 0.61803398875 + phaseSeed * 0.27);
    planes.setPhaseOffset(id, phase * durationSeconds);
    planes.setFps(id, fps * (0.86 + fractional(index * 0.41 + phaseSeed * 0.13) * 0.3));
  }
}

async function pickPlane(event: PointerEvent): Promise<InstanceId | undefined> {
  const camera = ctx.scene.camera;
  if (!camera) {
    return undefined;
  }
  return pickScreenSpaceInstanceFromPointer({
    event,
    canvas: ctx.canvas,
    camera,
    ids,
    has: (id) => planes.has(id),
    isVisible: (id) => planes.getVisible(id),
    getWorldPosition: (id) => {
      const meta = planes.getMetadata(id);
      if (!meta) {
        return undefined;
      }
      const movement = getPlaneMovement(meta, time);
      return [movement.x, movement.y, movement.z];
    },
    getScreenRadius: (id) => {
      const meta = planes.getMetadata(id);
      return meta ? 26 + meta.lane * 4 : 26;
    },
  })?.id;
}

function getPlaneMovement(
  meta: PlaneMeta,
  seconds: number,
): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
} {
  const lanePhase = meta.angle + seconds * meta.speed * Math.PI * 2;
  const radius = spiral ? meta.radius + Math.sin(seconds * 0.7 + meta.lane) * 1.8 : meta.radius;
  const x = Math.cos(lanePhase) * radius;
  const z = Math.sin(lanePhase) * radius;
  const y = meta.altitude + Math.sin(lanePhase * 2 + meta.lane) * (spiral ? 1.2 : 0.45);
  const yaw = -lanePhase + Math.PI / 2;
  const pitch = Math.sin(lanePhase * 1.7) * 0.12;
  const roll = spiral ? Math.sin(lanePhase * 2.3) * 0.8 : -0.35;
  return { x, y, z, yaw, pitch, roll };
}

function makePlaneMatrix(
  movement: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number },
  scale: number,
): Mat4 {
  return composeMat4(
    makeMatrix(movement.x, movement.y, movement.z, scale, movement.yaw, movement.pitch, movement.roll),
  );
}

function getClipFps(clip: string | undefined): number {
  return clip ? (planes.clips[clip]?.fps ?? 24) : 24;
}

function getClipFrameCount(clip: string | undefined): number {
  return clip ? (planes.clips[clip]?.frameCount ?? 1) : 1;
}

function fractional(value: number): number {
  return value - Math.floor(value);
}
