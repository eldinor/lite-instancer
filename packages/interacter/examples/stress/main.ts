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
  vec3,
  type Mesh,
  type StandardMaterialProps
} from "@babylonjs/lite";
import {
  createInteractionManager,
  disposeInteractionTarget,
  isInteractionEnabled,
  onInteractionEvent,
  registerMesh,
  setInteractionEnabled,
  type InteractionEventType,
  type InteractionTarget
} from "@litools/interacter";
import "../shared/styles.css";

const ROWS = 8;
const COLUMNS = 10;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);

const panel = document.createElement("section");
panel.className = "panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Interaction stress test</h1>
  <p>Move and click rapidly across 80 registered meshes. Use the controls while pointer picks are queued.</p>
  <div class="controls">
    <button type="button" class="toggle">Disable interaction</button>
    <button type="button" class="dispose-half">Dispose half</button>
    <button type="button" class="restore">Restore all</button>
    <button type="button" class="reset">Reset counters</button>
  </div>
  <div>Status: <span class="status">initializing</span></div>
  <div>Registered: <strong class="registered">0</strong> / ${ROWS * COLUMNS}</div>
  <div>Events/second: <strong class="rate">0</strong></div>
  <pre class="log" aria-live="polite"></pre>
`;
document.body.append(panel);
panel.addEventListener("pointerdown", (event) => event.stopPropagation());
panel.addEventListener("pointerup", (event) => event.stopPropagation());
panel.addEventListener("contextmenu", (event) => event.stopPropagation());

const toggle = panel.querySelector<HTMLButtonElement>(".toggle")!;
const disposeHalf = panel.querySelector<HTMLButtonElement>(".dispose-half")!;
const restore = panel.querySelector<HTMLButtonElement>(".restore")!;
const reset = panel.querySelector<HTMLButtonElement>(".reset")!;
const status = panel.querySelector<HTMLElement>(".status")!;
const registered = panel.querySelector<HTMLElement>(".registered")!;
const rate = panel.querySelector<HTMLElement>(".rate")!;
const log = panel.querySelector<HTMLElement>(".log")!;

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 3.1, 15, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
addToScene(scene, createHemisphericLight([0, 1, 0], 1.3));
attachControl(camera, canvas, scene);

const meshes = createMeshGrid();
const manager = createInteractionManager({
  scene,
  canvas,
  onError(error) {
    status.textContent = "picker error";
    writeLog(`error: ${String(error)}`);
  }
});
const targets: Array<InteractionTarget | undefined> = new Array(meshes.length);
const counts = new Map<InteractionEventType, number>();
let eventsThisSecond = 0;
let lastEvent = "Move over the grid to begin.";

restoreAll();

for (const type of [
  "pointerdown",
  "pointerup",
  "click",
  "doubleclick",
  "contextmenu",
  "hoverstart",
  "hovermove",
  "hoverend"
] as const) {
  onInteractionEvent(manager, type, (event) => {
    counts.set(type, (counts.get(type) ?? 0) + 1);
    eventsThisSecond += 1;
    lastEvent = `${type.padEnd(12)} ${event.mesh.name} @ ${event.canvasX.toFixed(0)}, ${event.canvasY.toFixed(0)}`;
    if (type === "hoverstart") {
      event.mesh.scaling.y = 1.35;
    } else if (type === "hoverend") {
      event.mesh.scaling.y = 1;
    }
  });
}

toggle.addEventListener("click", () => {
  setInteractionEnabled(manager, !isInteractionEnabled(manager));
  const enabled = isInteractionEnabled(manager);
  toggle.textContent = enabled ? "Disable interaction" : "Enable interaction";
  status.textContent = enabled ? "running" : "disabled";
});

disposeHalf.addEventListener("click", () => {
  for (let index = 0; index < targets.length; index += 2) {
    const target = targets[index];
    if (!target) continue;
    disposeInteractionTarget(target);
    targets[index] = undefined;
    meshes[index]!.scaling.y = 1;
  }
  updateRegisteredCount();
  status.textContent = "half disposed";
});

restore.addEventListener("click", () => {
  restoreAll();
  status.textContent = "running";
});

reset.addEventListener("click", () => {
  counts.clear();
  eventsThisSecond = 0;
  lastEvent = "Counters reset.";
  renderCounters();
});

window.setInterval(() => {
  rate.textContent = String(eventsThisSecond);
  eventsThisSecond = 0;
  renderCounters();
}, 1000);

await registerScene(scene);
status.textContent = "running";
renderCounters();
await startEngine(engine);

function createMeshGrid(): Mesh[] {
  const result: Mesh[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const index = row * COLUMNS + column;
      const mesh = createBox(engine, 0.72);
      mesh.name = `tile-${index + 1}`;
      mesh.position.x = column - (COLUMNS - 1) / 2;
      mesh.position.z = row - (ROWS - 1) / 2;
      mesh.position.y = 0.18 + ((index * 17) % 7) * 0.055;
      const material: StandardMaterialProps = createStandardMaterial();
      material.diffuseColor = [
        0.18 + column / COLUMNS * 0.55,
        0.35 + row / ROWS * 0.4,
        0.82 - row / ROWS * 0.32
      ];
      material.specularColor = [0.08, 0.08, 0.08];
      mesh.material = material;
      addToScene(scene, mesh);
      result.push(mesh);
    }
  }
  return result;
}

function restoreAll(): void {
  for (const [index, mesh] of meshes.entries()) {
    if (!targets[index]) targets[index] = registerMesh(manager, mesh);
  }
  updateRegisteredCount();
}

function updateRegisteredCount(): void {
  registered.textContent = String(targets.filter(Boolean).length);
}

function renderCounters(): void {
  log.textContent = [
    lastEvent,
    "",
    `hovermove   ${counts.get("hovermove") ?? 0}`,
    `hoverstart  ${counts.get("hoverstart") ?? 0}`,
    `hoverend    ${counts.get("hoverend") ?? 0}`,
    `pointerdown ${counts.get("pointerdown") ?? 0}`,
    `pointerup   ${counts.get("pointerup") ?? 0}`,
    `click       ${counts.get("click") ?? 0}`,
    `doubleclick ${counts.get("doubleclick") ?? 0}`,
    `contextmenu ${counts.get("contextmenu") ?? 0}`
  ].join("\n");
}

function writeLog(value: string): void {
  lastEvent = value;
  renderCounters();
}
