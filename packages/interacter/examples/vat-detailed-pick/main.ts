import {
  addToScene,
  attachControl,
  createDefaultCamera,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  loadGltf,
  onBeforeRender,
  registerScene,
  startEngine,
  type Mat4,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import { createVatInstanceSet } from "../../../../src/index.js";
import {
  createInteractionManager,
  onInteraction,
  registerMesh
} from "@litools/interacter";
import "../shared/styles.css";

const SHARK_URL = "https://assets.babylonjs.com/meshes/shark.glb";
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);
const panel = document.createElement("section");
panel.className = "panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>VAT detailed picking</h1>
  <p>Click the animated shark to verify Lite 1.14 face and barycentric results.</p>
  <div>Status: <strong class="status">loading</strong></div>
  <pre class="log" aria-live="polite">Waiting for a VAT pick.</pre>
`;
document.body.append(panel);
panel.addEventListener("pointerdown", (event) => event.stopPropagation());
panel.addEventListener("pointerup", (event) => event.stopPropagation());
const status = panel.querySelector<HTMLElement>(".status")!;
const log = panel.querySelector<HTMLElement>(".log")!;

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
addToScene(scene, createHemisphericLight([0, 1, 0], 1.25));

const container = await loadGltf(engine, SHARK_URL);
addToScene(scene, container);
const root = container.entities[0];
if (!root || !isSceneNode(root)) throw new Error("Shark GLB did not provide a root node.");
const mesh = collectMeshes(root).find((candidate) => candidate.skeleton);
const animations = container.animationGroups ?? [];
if (!mesh || animations.length === 0) throw new Error("Shark GLB did not provide VAT source data.");

const instances = createVatInstanceSet(engine, mesh, animations, { capacity: 1, engine });
const id = instances.create({ transform: new Float32Array(root.worldMatrix) as Mat4 });
const camera = createDefaultCamera(scene);
attachControl(camera, canvas, scene);

const interactions = createInteractionManager({
  scene,
  canvas,
  detailedPicking: { discrete: true },
  onError(error) {
    status.textContent = "error";
    log.textContent = String(error);
  }
});
const target = registerMesh(interactions, mesh, {
  resolveInstanceId: (slot) => instances.getIdForSlot(slot) ?? null
});
onInteraction(target, "click", (event) => {
  const details = event.pickDetails;
  const sum = details?.barycentric.reduce((total, weight) => total + weight, 0);
  const valid = details !== null && sum !== undefined && Math.abs(sum - 1) < 1e-5;
  status.textContent = valid ? "PASS" : event.pickDetailsStatus;
  log.textContent = [
    `stable ID: ${event.instanceId ?? "-"} (expected ${id})`,
    `thin slot: ${event.thinInstanceIndex}`,
    `face: ${details?.faceId ?? "-"}`,
    `vertices: ${details?.vertexIndices?.join(", ") ?? "-"}`,
    `barycentric: ${details?.barycentric.map((value) => value.toFixed(5)).join(", ") ?? "-"}`,
    `weight sum: ${sum?.toFixed(6) ?? "-"}`,
    `UV: ${details?.pickedUV?.map((value) => value.toFixed(5)).join(", ") ?? "-"}`
  ].join("\n");
});

onBeforeRender(scene, (deltaMs) => instances.update(deltaMs * 0.001));
await registerScene(scene);
status.textContent = "running";
await startEngine(engine);

function collectMeshes(rootNode: SceneNode): Mesh[] {
  const meshes: Mesh[] = [];
  const stack = [rootNode];
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
