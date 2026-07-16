import {
  addToScene,
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
  attachVatSafely,
  createInstanceSet,
  createVatAttachmentController,
  createVatInstanceSet
} from "../../../src/index.js";
import { collectMeshes, createExample, runExample } from "../../shared/app.js";

const MODEL_URL = "https://assets.babylonjs.com/meshes/HVGirl.glb";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const CLIP_NAME = "Samba";
const RIGHT_HAND = "mixamorig:RightHand";
const CHARACTER_SCALE = 0.1;

const ctx = await createExample("Samba Girl VAT Sword Sync");
ctx.panel.set("asset", "loading");
await loadEnvironment(ctx.scene, ENVIRONMENT_URL, { brdfUrl: BRDF_URL });

// This source rig exists only while socket tracks are baked. It is not rendered
// and no live skeleton participates in the runtime animation loop.
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
  throw new Error("HVGirl.glb must provide skinned meshes and animation groups");
}

const characters = createVatInstanceSet(ctx.engine, firstMesh, vatAnimations, {
  capacity: 5,
  engine: ctx.engine,
  visibleStrategy: "scale-zero",
  clip: CLIP_NAME
});
const sockets = bakeVatSocketAsset(ctx.engine, sourceAnimations, {
  clips: characters.clips,
  sockets: { sword: RIGHT_HAND }
});
const secondaryVatSets = vatMeshes.map((mesh) => {
  const handle = attachVatSafely(ctx.engine, mesh, bakeVat(ctx.engine, mesh, vatAnimations));
  const set = createInstanceSet(mesh, { capacity: 5, engine: ctx.engine, visibleStrategy: "scale-zero" });
  return { handle, set };
});

const characterMatrices = [
  mat4Compose(-2.1, 0, -1.5, 0, 0, 0, 1, CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),
  mat4Compose(0, 0, -1.5, 0, 0, 0, 1, CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),
  mat4Compose(2.1, 0, -1.5, 0, 0, 0, 1, CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),
  mat4Compose(-1.05, 0, 1.25, 0, 0, 0, 1, CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),
  mat4Compose(1.05, 0, 1.25, 0, 0, 0, 1, CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE)
];
const characterIds = characterMatrices.map((matrix) => characters.create({ transform: matrix, offset: 0 }));
for (const vatSet of secondaryVatSets) {
  for (const matrix of characterMatrices) {
    vatSet.set.create(matrix);
  }
}

const sword = createCylinder(ctx.engine, { height: 0.7, diameter: 0.065 });
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
// HVGirl carries a 0.01 animated-rig scale under a model subsequently scaled
// by CHARACTER_SCALE. This grip preserves a meter-sized sword in that space.
const gripOffset = mat4Compose(0, 350, 0, 0, 0, 0, 1, 1000, 1000, 1000);
for (let index = 0; index < characterIds.length; index++) {
  const characterId = characterIds[index];
  const swordId = swordIds[index];
  if (characterId !== undefined && swordId !== undefined) {
    swordSync.bind(characterId, swordId, { gripOffset });
  }
}

let activeAnimationIndex = vatAnimations.findIndex((animation) => animation.name === CLIP_NAME);
if (activeAnimationIndex < 0) {
  activeAnimationIndex = 0;
}
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
  camera.radius = 10;
  camera.target.x = 0;
  camera.target.y = 0.9;
  camera.target.z = 0;
}

ctx.panel.set("asset", "HVGirl.glb");
ctx.panel.set("source coordinates", "glTF RH");
ctx.panel.set("scene coordinates", "Babylon Lite LH (loader converted)");
ctx.panel.set("model normalization", `${CHARACTER_SCALE}x instance scale`);
ctx.panel.set("active animation", vatAnimations[activeAnimationIndex]?.name ?? "none");
ctx.panel.set("vat mesh parts", secondaryVatSets.length + 1);
ctx.panel.set("vat characters", characters.count);
ctx.panel.set("swords", `${swordIds.length} thin instances synced to ${RIGHT_HAND}`);
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
