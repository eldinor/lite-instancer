import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  registerScene,
  startEngine,
  vec3
} from "@babylonjs/lite";
import {
  createInteractionManager,
  onInteraction,
  registerMesh
} from "../../dist/index.js";
import "../shared/styles.css";

const app = document.querySelector("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);

const panel = document.createElement("section");
panel.className = "panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Built package consumer</h1>
  <p>This page imports Interacter directly from <code>../../dist/index.js</code>.</p>
  <div>Status: <span class="status">initializing</span></div>
  <pre class="log" aria-live="polite">Click the cube.</pre>
`;
document.body.append(panel);

const status = panel.querySelector(".status");
const log = panel.querySelector(".log");
const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };

const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.5, 9, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
addToScene(scene, createHemisphericLight([0, 1, 0], 1.25));
attachControl(camera, canvas, scene);

const mesh = createBox(engine, 3);
mesh.name = "Dist cube";
const material = createStandardMaterial();
material.diffuseColor = [0.2, 0.75, 0.55];
material.specularColor = [0.12, 0.12, 0.12];
mesh.material = material;
addToScene(scene, mesh);

const interactions = createInteractionManager({ scene, canvas });
const target = registerMesh(interactions, mesh);
onInteraction(target, "click", (event) => {
  log.textContent = `click from dist/index.js\n${event.canvasX.toFixed(0)}, ${event.canvasY.toFixed(0)}`;
});

await registerScene(scene);
status.textContent = "running";
await startEngine(engine);
