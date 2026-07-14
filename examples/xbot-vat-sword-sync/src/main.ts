import {
  addToScene,
  attachVat,
  bakeVat,
  createCylinder,
  createPbrMaterial,
  goToFrame,
  loadEnvironment,
  loadGltf,
  mat4Compose,
  mat4Multiply,
  playAnimation,
  stopAnimation,
  type ArcRotateCamera,
  type Mat4,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import { createInstanceSet } from "../../../src/index.js";
import { collectMeshes, createExample, runExample } from "../../shared/app.js";

const MODEL_URL = "https://raw.githubusercontent.com/eldinor/ForBJS/master/all-anim.glb";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";

const ctx = await createExample("Xbot VAT Sword Sync");
ctx.panel.set("asset", "loading");

await loadEnvironment(ctx.scene, "https://assets.babylonjs.com/environments/environmentSpecular.env", {
  brdfUrl: BRDF_URL
});

// The hidden source rig supplies the animated hand matrix for the rigid sword.
const sourceContainer = await loadGltf(ctx.engine, MODEL_URL);
addToScene(ctx.scene, sourceContainer);
const sourceRoot = sourceContainer.entities[0];
if (!isSceneNode(sourceRoot)) {
  throw new Error("Source GLB did not provide a scene-node root");
}
const sourceMeshes = collectMeshes(sourceRoot).filter(hasSkeleton);
for (const mesh of sourceMeshes) {
  mesh.visible = false;
}

// A second copy supplies the visible VAT meshes. This avatar has nine skinned parts.
const vatContainer = await loadGltf(ctx.engine, MODEL_URL);
addToScene(ctx.scene, vatContainer);
const vatRoot = vatContainer.entities[0];
if (!isSceneNode(vatRoot)) {
  throw new Error("VAT GLB did not provide a scene-node root");
}
const vatMeshes = collectMeshes(vatRoot).filter(hasSkeleton);
const sourceAnimations = sourceContainer.animationGroups ?? [];
const vatAnimations = vatContainer.animationGroups ?? [];
if (sourceAnimations.length === 0 || vatAnimations.length === 0 || vatMeshes.length === 0) {
  throw new Error("GLB must provide skinned meshes and animation groups for the VAT test");
}

for (const animation of vatAnimations) {
  stopAnimation(animation);
}

let activeAnimationIndex = 0;
let activeSourceAnimation = sourceAnimations[activeAnimationIndex];

const rightHandIndex = activeSourceAnimation?.targetedAnimations.find(
  (animation) => animation.targetName === "RightHand"
)?.nodeIndex;
if (rightHandIndex === undefined) {
  throw new Error("Character animation does not target a RightHand joint");
}

// Bake every skinned part before attaching VAT. Attaching releases the part's live bone texture.
const vatBakes = vatMeshes.map((mesh) => ({ mesh, baked: bakeVat(ctx.engine, mesh, vatAnimations) }));
const characterMatrices = [
  mat4Compose(-2.1, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(0, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(2.1, 0, -1.8, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(-1.05, 0, 1.1, 0, 0, 0, 1, 0.9, 0.9, 0.9),
  mat4Compose(1.05, 0, 1.1, 0, 0, 0, 1, 0.9, 0.9, 0.9)
];
const vatSets = vatBakes.map(({ mesh, baked }) => {
  const handle = attachVat(ctx.engine, mesh, baked);
  const set = createInstanceSet(mesh, {
    capacity: characterMatrices.length,
    engine: ctx.engine,
    visibleStrategy: "scale-zero"
  });
  for (const matrix of characterMatrices) {
    set.create(matrix);
  }
  return { handle, set };
});
let vatTimeSeconds = 0;
let activeVatClip: { frameCount: number; fps: number } | undefined;
activateClip(activeAnimationIndex);

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
const gripOffset = mat4Compose(-0.03, 0.39, 0.01, 0.0610485, 0, 0, 0.9981348, 1, 1, 1);

// The source animation callback is registered before this callback, keeping VAT and sword in step.
const sceneCallbacks = ctx.scene as unknown as SceneCallbackAccess;
sceneCallbacks._beforeRender.push((deltaMs) => {
  const deltaSeconds = deltaMs * 0.001;
  vatTimeSeconds += deltaSeconds;
  for (const vatSet of vatSets) {
    vatSet.handle.update(deltaSeconds);
  }

  if (activeSourceAnimation && activeVatClip) {
    const vatFrame = Math.floor(vatTimeSeconds * activeVatClip.fps) % activeVatClip.frameCount;
    goToFrame(activeSourceAnimation, vatFrame, ctx.engine);
  }

  const controller = (activeSourceAnimation as unknown as { _ctrl?: AnimationControllerDebug } | undefined)?._ctrl;
  const handWorld = controller?._debugWorldMat.subarray(rightHandIndex * 16, rightHandIndex * 16 + 16) as Mat4 | undefined;
  if (!handWorld) {
    return;
  }
  const swordInCharacterSpace = mat4Multiply(handWorld, gripOffset);
  for (let index = 0; index < swordIds.length; index++) {
    const swordId = swordIds[index];
    const characterMatrix = characterMatrices[index];
    if (swordId === undefined || characterMatrix === undefined) {
      continue;
    }
    swords.setMatrix(swordId, mat4Multiply(characterMatrix, swordInCharacterSpace));
  }
});

const camera = ctx.scene.camera;
if (isArcRotateCamera(camera)) {
  camera.radius = 4.2;
  camera.target.x = 0;
  camera.target.y = 0.95;
  camera.target.z = 0;
}

ctx.panel.set("asset", "all-anim.glb");
ctx.panel.set("mode", "9 VAT mesh sets + synchronized sword instances");
ctx.panel.set("vat mesh parts", vatSets.length);
ctx.panel.set("vat characters", characterMatrices.length);
ctx.panel.set("swords", `${swordIds.length} thin instances synced to RightHand`);
ctx.panel.set("active animation", activeSourceAnimation?.name ?? "none");
ctx.panel.button("next animation", () => {
  activeAnimationIndex = (activeAnimationIndex + 1) % sourceAnimations.length;
  activeSourceAnimation = sourceAnimations[activeAnimationIndex];
  activateClip(activeAnimationIndex);
  ctx.panel.set("active animation", activeSourceAnimation?.name ?? "none");
});

await runExample(ctx);

function activateClip(index: number): void {
  for (let animationIndex = 0; animationIndex < sourceAnimations.length; animationIndex++) {
    const sourceAnimation = sourceAnimations[animationIndex];
    const vatAnimation = vatAnimations[animationIndex];
    if (!sourceAnimation || !vatAnimation) {
      continue;
    }
    sourceAnimation.loopAnimation = true;
    sourceAnimation.currentTime = animationIndex === index
      ? vatTimeSeconds % Math.max(sourceAnimation.duration, Number.EPSILON)
      : 0;
    vatAnimation.currentTime = 0;
    if (animationIndex === index) {
      playAnimation(sourceAnimation);
      for (const vatSet of vatSets) {
        const clip = vatSet.handle.clips[vatAnimation.name];
        if (!clip) {
          continue;
        }
        vatSet.handle.play(vatAnimation.name);
        vatSet.handle.setInstances(createVatInstanceParameters(clip.fromRow, clip.frameCount, clip.fps));
      }
    } else {
      stopAnimation(sourceAnimation);
      stopAnimation(vatAnimation);
    }
  }
  const firstVatSet = vatSets[0];
  const activeVatAnimation = vatAnimations[index];
  if (firstVatSet && activeVatAnimation) {
    activeVatClip = firstVatSet.handle.clips[activeVatAnimation.name];
  }
}

function createVatInstanceParameters(fromRow: number, frameCount: number, fps: number): Float32Array {
  const params = new Float32Array(characterMatrices.length * 4);
  for (let index = 0; index < characterMatrices.length; index++) {
    const offset = index * 4;
    params[offset] = fromRow;
    params[offset + 1] = fromRow + frameCount - 1;
    params[offset + 2] = 0;
    params[offset + 3] = fps;
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

interface AnimationControllerDebug {
  _debugWorldMat: Float32Array;
}

interface SceneCallbackAccess {
  _beforeRender: Array<(deltaMs: number) => void>;
}
