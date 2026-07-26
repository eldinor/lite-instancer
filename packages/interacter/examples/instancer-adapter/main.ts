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
import { createInstanceSet, type InstanceId } from "@litools/instancer";
import { registerInstanceSet } from "@litools/instancer/interacter";
import { createInteractionManager, onInteraction } from "@litools/interacter";
import "../shared/styles.css";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The example page is missing its app root.");

const canvas = document.createElement("canvas");
app.append(canvas);
const panel = createPanel();
document.body.append(panel.root);

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.7, 14, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
addToScene(scene, createHemisphericLight([0, 1, 0], 1.35));
attachControl(camera, canvas, scene);

const host = createBox(engine, 1.55);
host.name = "Instancer boxes";
const material = createStandardMaterial();
material.diffuseColor = [1, 1, 1];
material.specularColor = [0.08, 0.08, 0.08];
host.material = material;
addToScene(scene, host);

const instances = createInstanceSet(host, {
  capacity: 8,
  grow: "double",
  colors: true,
  engine
});
const baseColors = new Map<InstanceId, readonly [number, number, number, number]>();
const positionById = new Map<InstanceId, number>();
const positions: ReadonlyArray<readonly [number, number, number]> = [
  [-4.2, 1.15, 0],
  [-2.1, -1.15, 0],
  [0, 1.15, 0],
  [2.1, -1.15, 0],
  [4.2, 1.15, 0],
  [0, -1.15, 0],
  [-4.2, -1.15, 0],
  [4.2, -1.15, 0]
];
const palette: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.18, 0.72, 1, 1],
  [0.38, 0.9, 0.62, 1],
  [0.64, 0.5, 1, 1],
  [1, 0.48, 0.38, 1],
  [1, 0.77, 0.27, 1],
  [0.92, 0.4, 0.8, 1],
  [0.42, 0.82, 0.92, 1],
  [0.78, 0.9, 0.38, 1]
];
let selected: InstanceId | undefined;
let lastPickedSlot: number | undefined;

for (let index = 0; index < 6; index++) addInstance();

const manager = createInteractionManager({
  scene,
  canvas,
  onError(error) {
    panel.log(`error: ${String(error)}`);
  }
});
const target = registerInstanceSet(manager, instances);
onInteraction(target, "click", (event) => {
  if (typeof event.instanceId !== "number") return;
  const id = event.instanceId as InstanceId;
  if (!instances.has(id)) return;
  select(id);
  lastPickedSlot = event.thinInstanceIndex;
  panel.log(`click: stable ID ${Number(id)}, renderer slot ${event.thinInstanceIndex}`);
  refreshPanel();
});

panel.removeButton.addEventListener("click", removeSelected);
panel.addButton.addEventListener("click", () => {
  const id = addInstance();
  select(id);
  panel.log(`created stable ID ${Number(id)} in slot ${instances.getSlot(id)}`);
  refreshPanel();
});

refreshPanel();
await registerScene(scene);
await startEngine(engine);

function addInstance(): InstanceId {
  const occupied = new Set(positionById.values());
  const positionIndex = positions.findIndex((_position, index) => !occupied.has(index));
  if (positionIndex < 0) throw new Error("No demo position remains available.");
  const position = positions[positionIndex]!;
  const color = palette[positionIndex % palette.length]!;
  const id = instances.create({ position });
  positionById.set(id, positionIndex);
  baseColors.set(id, color);
  instances.setColor(id, color);
  return id;
}

function select(id: InstanceId): void {
  if (selected !== undefined && instances.has(selected)) {
    instances.setColor(selected, baseColors.get(selected) ?? [1, 1, 1, 1]);
  }
  selected = id;
  instances.setColor(id, [1, 1, 1, 1]);
}

function removeSelected(): void {
  if (selected === undefined || !instances.has(selected)) return;
  const removedId = selected;
  const removedSlot = instances.getSlot(removedId)!;
  const finalSlot = instances.count - 1;
  const movedId = removedSlot === finalSlot ? undefined : instances.getIdForSlot(finalSlot);
  instances.remove(removedId);
  baseColors.delete(removedId);
  positionById.delete(removedId);
  selected = undefined;
  lastPickedSlot = undefined;
  if (movedId === undefined) {
    panel.log(`removed ID ${Number(removedId)} from final slot ${removedSlot}; no compaction needed`);
  } else {
    panel.log(
      `removed ID ${Number(removedId)} from slot ${removedSlot}; ID ${Number(movedId)} moved ${finalSlot} -> ${removedSlot}`
    );
  }
  refreshPanel();
}

function refreshPanel(): void {
  panel.count.textContent = String(instances.count);
  panel.selectedId.textContent = selected === undefined ? "-" : String(Number(selected));
  panel.pickedSlot.textContent = lastPickedSlot === undefined ? "-" : String(lastPickedSlot);
  panel.currentSlot.textContent = selected === undefined ? "-" : String(instances.getSlot(selected) ?? "-");
  panel.removeButton.disabled = selected === undefined;
  panel.addButton.disabled = instances.count >= positions.length;
  panel.mapping.textContent = [...instances.slots()]
    .map(({ id, slot }) => `slot ${slot} -> stable ID ${Number(id)}`)
    .join("\n");
}

function createPanel() {
  const root = document.createElement("section");
  root.className = "panel adapter-panel";
  root.innerHTML = `
    <a class="home" href="../">← Interaction examples</a>
    <h1>Instancer stable-ID adapter</h1>
    <p>Click a box, then remove it. Instancer may compact renderer slots, while Interacter keeps reporting the logical ID.</p>
    <div class="controls">
      <button class="remove" type="button">Remove selected</button>
      <button class="add" type="button">Add instance</button>
    </div>
    <dl class="adapter-values">
      <dt>Live instances</dt><dd class="count">0</dd>
      <dt>Selected stable ID</dt><dd class="selected-id">-</dd>
      <dt>Picked renderer slot</dt><dd class="picked-slot">-</dd>
      <dt>Current slot for ID</dt><dd class="current-slot">-</dd>
    </dl>
    <h2>Live slot mapping</h2>
    <pre class="mapping"></pre>
    <h2>Compaction log</h2>
    <pre class="log" aria-live="polite"></pre>
  `;
  for (const type of ["pointerdown", "pointerup", "contextmenu"] as const) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  const log = root.querySelector<HTMLElement>(".log")!;
  const lines: string[] = [];
  return {
    root,
    count: root.querySelector<HTMLElement>(".count")!,
    selectedId: root.querySelector<HTMLElement>(".selected-id")!,
    pickedSlot: root.querySelector<HTMLElement>(".picked-slot")!,
    currentSlot: root.querySelector<HTMLElement>(".current-slot")!,
    mapping: root.querySelector<HTMLElement>(".mapping")!,
    removeButton: root.querySelector<HTMLButtonElement>(".remove")!,
    addButton: root.querySelector<HTMLButtonElement>(".add")!,
    log(value: string) {
      lines.unshift(value);
      log.textContent = lines.slice(0, 8).join("\n");
    }
  };
}
