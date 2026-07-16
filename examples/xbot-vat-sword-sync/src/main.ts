import {
  addToScene,
  attachVat,
  bakeVat,
  createCylinder,
  createPbrMaterial,
  loadEnvironment,
  loadGltf,
  mat4Compose,
  onBeforeRender,
  type ArcRotateCamera,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import {
  bakeVatSocketAsset,
  createInstanceSet,
  createVatAttachmentController,
  createVatInstanceSet
} from "../../../src/index.js";
import { collectMeshes, createExample, runExample } from "../../shared/app.js";

const MODEL_URL = "https://raw.githubusercontent.com/eldinor/ForBJS/master/all-anim.glb";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const RIGHT_HAND = "RightHand";

const ctx = await createExample("Xbot VAT Sword Sync");
ctx.panel.set("asset", "loading");
await loadEnvironment(ctx.scene, "https://assets.babylonjs.com/environments/environmentSpecular.env", { brdfUrl: BRDF_URL });

// This container is evaluated only once to bake socket tracks. It is never added
// to the scene and no live skeleton is used during playback.
const socketSource = await loadGltf(ctx.engine, MODEL_URL);
const sourceAnimations = socketSource.animationGroups ?? [];

const vatContainer = await loadGltf(ctx.engine, MODEL_URL);
addToScene(ctx.scene, vatContainer);
const vatRoot = vatContainer.entities[0];
if (!isSceneNode(vatRoot)) {
  throw new Error("VAT GLB did not provide a scene-node root");
}
const vatMeshes = collectMeshes(vatRoot).filter(hasSkeleton);
const vatAnimations = vatContainer.animationGroups ?? [];
const firstMesh = vatMeshes.shift();
if (!firstMesh || sourceAnimations.length === 0 || vatAnimations.length === 0) {
  throw new Error("Xbot GLB must provide skinned meshes and animation groups");
}

const characters = createVatInstanceSet(ctx.engine, firstMesh, vatAnimations, {
  capacity: 5,
  engine: ctx.engine,
  visibleStrategy: "scale-zero"
});
const sockets = bakeVatSocketAsset(ctx.engine, sourceAnimations, {
  clips: characters.clips,
  sockets: { sword: RIGHT_HAND }
});
const secondaryVatSets = vatMeshes.map((mesh) => {
  const handle = attachVat(ctx.engine, mesh, bakeVat(ctx.engine, mesh, vatAnimations));
  const set = createInstanceSet(mesh, { capacity: 5, engine: ctx.engine, visibleStrategy: "scale-zero" });
  return { handle, set };
});

const characterMatrices = [
  mat4Compose(-2.1, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(0, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(2.1, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(-1.05, 0, 1.1, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(1.05, 0, 1.1, 0, 0, 0, 1, 0.9, 0.9, 0.9)
];
const characterIds = characterMatrices.map((matrix) => characters.create({ transform: matrix, offset: 0 }));
for (const vatSet of secondaryVatSets) {
  for (const matrix of characterMatrices) {
    vatSet.set.create(matrix);
  }
}

const sword = createCylinder(ctx.engine, { height: 0.675, diameter: 0.07 });
sword.material = createPbrMaterial({
  baseColorFactor: [0.82, 0.86, 0.95, 1],
  metallicFactor: 0.78,
  roughnessFactor: 0.24,
  environmentIntensity: 1.6,
  directIntensity: 1.35
});
addToScene(ctx.scene, sword);
const swords = createInstanceSet(sword, { capacity: characterMatrices.length, engine: ctx.engine });
const swordIds = characterMatrices.map(() => swords.create());
const swordSync = createVatAttachmentController({
  characters,
  attachments: swords,
  socketAsset: sockets,
  socket: "sword"
});
const gripOffset = mat4Compose(-0.03, 0.39, 0.01, 0.0610485, 0, 0, 0.9981348, 1, 1, 1);
for (let index = 0; index < characterIds.length; index++) {
  const characterId = characterIds[index];
  const swordId = swordIds[index];
  if (characterId !== undefined && swordId !== undefined) {
    swordSync.bind(characterId, swordId, { gripOffset });
  }
}

let activeAnimationIndex = 0;
let phaseSpreadEnabled = false;
let fpsVariationEnabled = false;
activateClip(activeAnimationIndex);
onBeforeRender(ctx.scene, (deltaMs) => {
  const deltaSeconds = deltaMs * 0.001;
  characters.update(deltaSeconds);
  for (const vatSet of secondaryVatSets) {
    vatSet.handle.update(deltaSeconds);
  }
  swordSync.update();
});

const camera = ctx.scene.camera;
if (isArcRotateCamera(camera)) {
  camera.radius = 4.2;
  camera.target.x = 0;
  camera.target.y = 0.95;
  camera.target.z = 0;
}

ctx.panel.set("asset", "all-anim.glb");
ctx.panel.set("mode", "VAT sockets + thin sword attachments");
ctx.panel.set("vat mesh parts", secondaryVatSets.length + 1);
ctx.panel.set("vat characters", characters.count);
ctx.panel.set("swords", `${swordIds.length} thin instances synced to ${RIGHT_HAND}`);
ctx.panel.set("active animation", vatAnimations[activeAnimationIndex]?.name ?? "none");
ctx.panel.set("per-instance phase", "aligned");
ctx.panel.set("per-instance FPS", "clip FPS");
ctx.panel.button("next animation", () => {
  activeAnimationIndex = (activeAnimationIndex + 1) % vatAnimations.length;
  activateClip(activeAnimationIndex);
  ctx.panel.set("active animation", vatAnimations[activeAnimationIndex]?.name ?? "none");
});
ctx.panel.button("toggle phase spread", () => {
  phaseSpreadEnabled = !phaseSpreadEnabled;
  applyPlaybackControls();
  ctx.panel.set("per-instance phase", phaseSpreadEnabled ? "spread across clip" : "aligned");
});
ctx.panel.button("toggle FPS variation", () => {
  fpsVariationEnabled = !fpsVariationEnabled;
  applyPlaybackControls();
  ctx.panel.set("per-instance FPS", fpsVariationEnabled ? "0.7x to 1.3x" : "clip FPS");
});

await runExample(ctx);

function activateClip(index: number): void {
  const animation = vatAnimations[index];
  if (!animation || !characters.play(animation.name)) {
    return;
  }
  applyPlaybackControls();
}

function applyPlaybackControls(): void {
  const clip = characters.getActiveClip();
  const animation = vatAnimations[activeAnimationIndex];
  if (!clip || !animation) {
    return;
  }
  const duration = clip.frameCount / clip.fps;
  for (let index = 0; index < characterIds.length; index++) {
    const id = characterIds[index];
    if (id === undefined) {
      continue;
    }
    characters.setPhaseOffset(id, phaseSpreadEnabled ? (index / characterIds.length) * duration : 0);
    characters.setFps(id, fpsVariationEnabled ? clip.fps * (0.7 + index * 0.15) : undefined);
  }
  synchronizeSecondaryVatSets(animation.name);
}

function synchronizeSecondaryVatSets(animationName: string): void {
  for (const vatSet of secondaryVatSets) {
    const clip = vatSet.handle.clips[animationName];
    if (!clip) {
      continue;
    }
    vatSet.handle.play(animationName);
    vatSet.handle.setInstances(createVatInstanceParameters(clip.fromRow, clip.frameCount, clip.fps));
  }
}

function createVatInstanceParameters(fromRow: number, frameCount: number, fps: number): Float32Array {
  const params = new Float32Array(characterMatrices.length * 4);
  for (let index = 0; index < characterMatrices.length; index++) {
    const offset = index * 4;
    const characterId = characterIds[index];
    const sample = characterId === undefined ? undefined : characters.getPlaybackSample(characterId);
    params[offset] = fromRow;
    params[offset + 1] = fromRow + frameCount - 1;
    params[offset + 2] = sample ? sample.offsetSeconds * sample.fps : 0;
    params[offset + 3] = sample?.fps ?? fps;
  }
  return params;
}

function hasSkeleton(mesh: Mesh): boolean {
  return !!mesh.skeleton;
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value;
}

function isArcRotateCamera(value: unknown): value is ArcRotateCamera {
  return typeof value === "object" && value !== null && "radius" in value && "target" in value;
}
