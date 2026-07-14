import {
  addToScene,
  createCylinder,
  createPbrMaterial,
  loadGltf,
  loadEnvironment,
  mat4Compose,
  mat4Decompose,
  mat4Multiply,
  playAnimation,
  stopAnimation,
  type ArcRotateCamera,
  type Mat4,
  type SceneNode
} from "@babylonjs/lite";
import { createExample, runExample } from "../../shared/app.js";

const XBOT_URL = "https://raw.githubusercontent.com/eldinor/ForBJS/master/all-anim.glb";

const ctx = await createExample("Xbot Basic Animation");
ctx.panel.set("asset", "loading");

await loadEnvironment(ctx.scene, "https://assets.babylonjs.com/environments/environmentSpecular.env", {
  brdfUrl: "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png"
});

const container = await loadGltf(ctx.engine, XBOT_URL);
addToScene(ctx.scene, container);

const camera = ctx.scene.camera;
if (isArcRotateCamera(camera)) {
  camera.radius = 4.2;
  camera.target.x = 0;
  camera.target.y = 0.95;
  camera.target.z = 0;
}

const animations = container.animationGroups ?? [];
let activeAnimationIndex = 0;
let activeAnimation = animations[activeAnimationIndex];
activateAnimation(activeAnimationIndex);

const root = container.entities[0];
if (!isSceneNode(root)) {
  throw new Error("Character GLB did not provide a scene-node root");
}

const rightHandIndex = activeAnimation?.targetedAnimations.find(
  (animation) => animation.targetName === "RightHand"
)?.nodeIndex;
if (rightHandIndex === undefined) {
  throw new Error("Character animation does not target a RightHand joint");
}

const cylinder = createCylinder(ctx.engine, { height: 0.675, diameter: 0.07 });
cylinder.material = createPbrMaterial({
  baseColorFactor: [0.82, 0.86, 0.95, 1],
  metallicFactor: 0.78,
  roughnessFactor: 0.24,
  environmentIntensity: 1.6,
  directIntensity: 1.35
});
addToScene(ctx.scene, cylinder);
cylinder.name = "attached-cylinder";
const grip = { x: -0.03, y: 0.39, z: 0.01, pitch: 7, yaw: 0, roll: 0 };
let gripOffset = createGripOffset();

const sceneCallbacks = ctx.scene as unknown as SceneCallbackAccess;
sceneCallbacks._beforeRender.push(() => {
  const controller = (activeAnimation as unknown as { _ctrl?: AnimationControllerDebug } | undefined)?._ctrl;
  const handWorld = controller?._debugWorldMat.subarray(rightHandIndex * 16, rightHandIndex * 16 + 16) as Mat4 | undefined;
  if (!handWorld) {
    return;
  }
  const attachedWorld = mat4Multiply(handWorld, gripOffset);
  const { translation, rotation, scale } = mat4Decompose(attachedWorld);
  cylinder.position.set(translation.x, translation.y, translation.z);
  cylinder.rotationQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  cylinder.scaling.set(scale.x, scale.y, scale.z);
});

ctx.panel.set("asset", "all-anim.glb");
ctx.panel.set("environment", "Lite default");
ctx.panel.set("animations", animations.length);
ctx.panel.set("active animation", activeAnimation?.name ?? "none");
ctx.panel.set("root", root.name || "unnamed");
ctx.panel.set("status", activeAnimation ? "playing" : "no animation found");
createGripTuningControls();
ctx.panel.set("attachment", "tall cylinder → RightHand");
ctx.panel.button("next animation", () => {
  if (animations.length === 0) {
    return;
  }
  activeAnimationIndex = (activeAnimationIndex + 1) % animations.length;
  activeAnimation = animations[activeAnimationIndex];
  activateAnimation(activeAnimationIndex);
  ctx.panel.set("active animation", activeAnimation?.name ?? "none");
});
ctx.panel.button("reset grip", () => {
  Object.assign(grip, { x: -0.03, y: 0.39, z: 0.01, pitch: 7, yaw: 0, roll: 0 });
  gripOffset = createGripOffset();
  syncGripInputs();
  updateGripReadout();
});

await runExample(ctx);

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value;
}

function isArcRotateCamera(value: unknown): value is ArcRotateCamera {
  return typeof value === "object" && value !== null && "radius" in value && "target" in value;
}

function activateAnimation(index: number): void {
  for (let animationIndex = 0; animationIndex < animations.length; animationIndex++) {
    const animation = animations[animationIndex];
    if (!animation) {
      continue;
    }
    animation.loopAnimation = true;
    animation.currentTime = 0;
    if (animationIndex === index) {
      playAnimation(animation);
    } else {
      stopAnimation(animation);
    }
  }
}

function createGripTuningControls(): void {
  const controls = document.createElement("fieldset");
  controls.innerHTML = "<legend>Sword grip tuning</legend>";
  controls.style.cssText = "display:grid;gap:6px;margin:12px 0 0;padding:8px;border:1px solid rgba(255,255,255,.14);border-radius:6px;font-size:12px";
  ctx.panel.root.append(controls);

  addGripSlider(controls, "X", "x", -0.4, 0.4, 0.01);
  addGripSlider(controls, "Y", "y", -0.1, 0.6, 0.01);
  addGripSlider(controls, "Z", "z", -0.4, 0.4, 0.01);
  addGripSlider(controls, "Pitch", "pitch", -180, 180, 1);
  addGripSlider(controls, "Yaw", "yaw", -180, 180, 1);
  addGripSlider(controls, "Roll", "roll", -180, 180, 1);
  updateGripReadout();
}

function addGripSlider(
  parent: HTMLElement,
  label: string,
  key: keyof typeof grip,
  min: number,
  max: number,
  step: number
): void {
  const row = document.createElement("label");
  row.style.cssText = "display:grid;grid-template-columns:42px 1fr 48px;align-items:center;gap:6px";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(grip[key]);
  input.dataset.gripKey = key;
  const value = document.createElement("output");
  value.textContent = input.value;
  input.addEventListener("input", () => {
    grip[key] = Number(input.value);
    value.textContent = input.value;
    gripOffset = createGripOffset();
    updateGripReadout();
  });
  row.append(name, input, value);
  parent.append(row);
}

function createGripOffset(): Mat4 {
  const [x, y, z, w] = quaternionFromEulerDegrees(grip.pitch, grip.yaw, grip.roll);
  return mat4Compose(grip.x, grip.y, grip.z, x, y, z, w, 1, 1, 1);
}

function quaternionFromEulerDegrees(pitch: number, yaw: number, roll: number): [number, number, number, number] {
  const halfPitch = pitch * Math.PI / 360;
  const halfYaw = yaw * Math.PI / 360;
  const halfRoll = roll * Math.PI / 360;
  const cp = Math.cos(halfPitch);
  const sp = Math.sin(halfPitch);
  const cy = Math.cos(halfYaw);
  const sy = Math.sin(halfYaw);
  const cr = Math.cos(halfRoll);
  const sr = Math.sin(halfRoll);
  return [sp * cy * cr + cp * sy * sr, cp * sy * cr - sp * cy * sr, cp * cy * sr + sp * sy * cr, cp * cy * cr - sp * sy * sr];
}

function updateGripReadout(): void {
  ctx.panel.set(
    "grip transform",
    `pos [${grip.x.toFixed(2)}, ${grip.y.toFixed(2)}, ${grip.z.toFixed(2)}], rot [${grip.pitch}, ${grip.yaw}, ${grip.roll}]°`
  );
}

function syncGripInputs(): void {
  for (const input of ctx.panel.root.querySelectorAll<HTMLInputElement>("input[data-grip-key]")) {
    const key = input.dataset.gripKey as keyof typeof grip;
    input.value = String(grip[key]);
    input.dispatchEvent(new Event("input"));
  }
}

interface AnimationControllerDebug {
  _debugWorldMat: Float32Array;
}

interface SceneCallbackAccess {
  _beforeRender: Array<(deltaMs: number) => void>;
}
