import {
  addToScene,
  attachControl,
  createDefaultCamera,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  loadGltf,
  registerScene,
  startEngine,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import {
  createInteractionManager,
  onInteraction,
  registerMesh
} from "@litools/interacter";
import "../shared/styles.css";

const ASSET_URL = "https://playground.babylonjs.com/scenes/BoomBox.glb";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);

const panel = document.createElement("section");
panel.className = "panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Static GLB picking</h1>
  <p>Click the non-animated BoomBox to resolve its exact GLB child mesh through Interacter.</p>
  <div>Status: <span class="status">loading GLB</span></div>
  <div>Registered meshes: <strong class="mesh-count">0</strong></div>
  <pre class="log" aria-live="polite">Waiting for a click.</pre>
`;
document.body.append(panel);
panel.addEventListener("pointerdown", (event) => event.stopPropagation());
panel.addEventListener("pointerup", (event) => event.stopPropagation());

const status = panel.querySelector<HTMLElement>(".status")!;
const meshCount = panel.querySelector<HTMLElement>(".mesh-count")!;
const log = panel.querySelector<HTMLElement>(".log")!;

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };

addToScene(scene, createHemisphericLight([0, 1, 0], 1.25));

const container = await loadGltf(engine, ASSET_URL);
addToScene(scene, container);

const root = container.entities[0];
if (!root || !isSceneNode(root)) {
  throw new Error("The BoomBox GLB did not provide a root scene node.");
}
const camera = createDefaultCamera(scene);
camera.alpha += Math.PI;
attachControl(camera, canvas, scene);

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
  if (!mesh.name) mesh.name = `BoomBox mesh ${index + 1}`;
  const target = registerMesh(interactions, mesh);
  onInteraction(target, "click", (event) => {
    const point = event.pickedPoint;
    log.textContent = [
      `mesh: ${event.mesh.name}`,
      `canvas: ${event.canvasX.toFixed(1)}, ${event.canvasY.toFixed(1)}`,
      `distance: ${event.distance?.toFixed(3) ?? "-"}`,
      `world point: ${point ? point.map((value) => value.toFixed(3)).join(", ") : "-"}`
    ].join("\n");
  });
}

meshCount.textContent = String(meshes.length);
await registerScene(scene);
status.textContent = "running · static model";
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
  return typeof value === "object" && value !== null && "children" in value && "scaling" in value;
}
