import {
  addToScene,
  attachControl,
  createDefaultCamera,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  loadGltf,
  pauseAnimation,
  playAnimation,
  registerScene,
  startEngine,
  stopAnimation,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import {
  createInteractionManager,
  onInteraction,
  registerMesh
} from "@litools/interacter";
import "../shared/styles.css";

const MODEL_URL = "https://assets.babylonjs.com/meshes/HVGirl.glb";
const CLIP_NAME = "Samba";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);

const panel = document.createElement("section");
panel.className = "panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Animated GLB picking</h1>
  <p>Click Samba Girl while her live skeletal animation deforms the registered meshes.</p>
  <div class="controls">
    <button type="button" class="playback">Pause animation</button>
    <button type="button" class="next-animation">Next animation</button>
  </div>
  <label>
    Animation speed
    <input class="animation-speed" type="range" min="0.25" max="2" step="0.05" value="1">
    <output class="animation-speed-value">1.00×</output>
  </label>
  <div>Status: <span class="status">loading GLB</span></div>
  <div>Animation: <strong class="animation">-</strong></div>
  <div>Registered meshes: <strong class="mesh-count">0</strong></div>
  <pre class="log" aria-live="polite">Waiting for a click.</pre>
`;
document.body.append(panel);
panel.addEventListener("pointerdown", (event) => event.stopPropagation());
panel.addEventListener("pointerup", (event) => event.stopPropagation());

const status = panel.querySelector<HTMLElement>(".status")!;
const animationName = panel.querySelector<HTMLElement>(".animation")!;
const meshCount = panel.querySelector<HTMLElement>(".mesh-count")!;
const log = panel.querySelector<HTMLElement>(".log")!;
const playback = panel.querySelector<HTMLButtonElement>(".playback")!;
const nextAnimation = panel.querySelector<HTMLButtonElement>(".next-animation")!;
const animationSpeed = panel.querySelector<HTMLInputElement>(".animation-speed")!;
const animationSpeedValue = panel.querySelector<HTMLOutputElement>(".animation-speed-value")!;

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
addToScene(scene, createHemisphericLight([0, 1, 0], 1.25));

const container = await loadGltf(engine, MODEL_URL);
addToScene(scene, container);

const root = container.entities[0];
if (!root || !isSceneNode(root)) {
  throw new Error("Samba Girl did not provide a root scene node.");
}

const camera = createDefaultCamera(scene);
attachControl(camera, canvas, scene);

const animations = container.animationGroups ?? [];
let animationIndex = animations.findIndex((candidate) => candidate.name === CLIP_NAME);
if (animationIndex < 0) animationIndex = 0;
const initialAnimation = animations[animationIndex];
if (!initialAnimation) {
  throw new Error("Samba Girl did not provide an animation group.");
}
let animation = initialAnimation;
animation.loopAnimation = true;
animation.speedRatio = Number(animationSpeed.value);
playAnimation(animation);

let playing = true;
nextAnimation.disabled = animations.length < 2;
playback.addEventListener("click", () => {
  if (playing) {
    pauseAnimation(animation);
  } else {
    playAnimation(animation);
  }
  playing = !playing;
  playback.textContent = playing ? "Pause animation" : "Play animation";
  status.textContent = playing ? "running · live skeleton" : "paused";
});
nextAnimation.addEventListener("click", () => {
  stopAnimation(animation);
  animationIndex = (animationIndex + 1) % animations.length;
  animation = animations[animationIndex]!;
  animation.loopAnimation = true;
  animation.speedRatio = Number(animationSpeed.value);
  playAnimation(animation);
  if (!playing) pauseAnimation(animation);
  animationName.textContent = animation.name;
  status.textContent = playing ? "running · live skeleton" : "paused";
});
animationSpeed.addEventListener("input", () => {
  animation.speedRatio = Number(animationSpeed.value);
  animationSpeedValue.value = `${animation.speedRatio.toFixed(2)}×`;
});

const interactions = createInteractionManager({
  scene,
  canvas,
  onError(error) {
    status.textContent = "interaction error";
    log.textContent = String(error);
  }
});

const meshes = collectMeshes(root);
for (const [index, mesh] of meshes.entries()) {
  if (!mesh.name) mesh.name = `Samba Girl mesh ${index + 1}`;
  const target = registerMesh(interactions, mesh);
  onInteraction(target, "click", (event) => {
    const point = event.pickedPoint;
    log.textContent = [
      `mesh: ${event.mesh.name}`,
      `animation: ${animation.name} (${playing ? "playing" : "paused"})`,
      `canvas: ${event.canvasX.toFixed(1)}, ${event.canvasY.toFixed(1)}`,
      `distance: ${event.distance?.toFixed(3) ?? "-"}`,
      `world point: ${point ? point.map((value) => value.toFixed(3)).join(", ") : "-"}`
    ].join("\n");
  });
}

animationName.textContent = animation.name;
meshCount.textContent = String(meshes.length);
await registerScene(scene);
status.textContent = "running · live skeleton";
await startEngine(engine);

function collectMeshes(rootNode: SceneNode): Mesh[] {
  const meshes: Mesh[] = [];
  const stack: SceneNode[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (isMesh(node)) meshes.push(node);
    stack.push(...node.children);
  }
  return meshes;
}

function isMesh(node: SceneNode): node is Mesh {
  return "material" in node && "receiveShadows" in node;
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value;
}
