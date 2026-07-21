import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createInstanceSet, createPickingRegistry, type InstanceId } from "@litools/instancer-babylonjs";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const selectedIdText = document.querySelector<HTMLElement>("#selectedId")!;
const selectedSlotText = document.querySelector<HTMLElement>("#selectedSlot")!;
const selectedVisibleText = document.querySelector<HTMLElement>("#selectedVisible")!;
const countText = document.querySelector<HTMLElement>("#count")!;
const visibleCountText = document.querySelector<HTMLElement>("#visibleCount")!;
const capacityText = document.querySelector<HTMLElement>("#capacity")!;
const toggleButton = document.querySelector<HTMLButtonElement>("#toggle")!;
const removeButton = document.querySelector<HTMLButtonElement>("#remove")!;
const engine = await (async () => {
  if (new URLSearchParams(location.search).has("webgpu")) {
    const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine.js");
    const webgpu = new WebGPUEngine(canvas);
    await webgpu.initAsync();
    return webgpu;
  }
  return new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
})();
const scene = new Scene(engine);
scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.05, 24, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.4, 1, 0.2), scene);

const source = MeshBuilder.CreateBox("box", { size: 0.8 }, scene);
const material = new StandardMaterial("box-material", scene);
material.diffuseColor = new Color3(1, 1, 1);
source.material = material;
const boxes = createInstanceSet<{ label: string }>(source, { capacity: 4, grow: "double", colors: true });
let nextLabel = 0;
for (let index = 0; index < 12; index++) {
  const id = boxes.create({ position: [(index % 4) * 2 - 3, Math.floor(index / 4) * 2 - 2, 0] }, { label: `box-${index}` });
  boxes.setColor(id, [0.2 + (index % 4) * 0.15, 0.55, 0.9, 1]);
  nextLabel++;
}

const picking = createPickingRegistry().register(source, boxes);
let selected: InstanceId | undefined;
const hiddenOnce = new Set<InstanceId>();

function markCheck(id: "pickCheck" | "visibilityCheck" | "removeCheck" | "growCheck", text: string): void {
  const element = document.querySelector<HTMLElement>(`#${id}`)!;
  element.textContent = text;
  element.classList.add("pass");
}

function refreshPanel(): void {
  const validSelection = selected !== undefined && boxes.has(selected);
  selectedIdText.textContent = validSelection ? String(Number(selected)) : "—";
  selectedSlotText.textContent = validSelection ? String(boxes.getSlot(selected!)) : "—";
  selectedVisibleText.textContent = validSelection ? String(boxes.getVisible(selected!)) : "—";
  countText.textContent = String(boxes.count);
  visibleCountText.textContent = String(boxes.visibleCount);
  capacityText.textContent = String(boxes.capacity);
  toggleButton.disabled = !validSelection;
  removeButton.disabled = !validSelection;
  toggleButton.textContent = validSelection && !boxes.getVisible(selected!) ? "Show selected" : "Hide selected";
}

function addOne(): InstanceId {
  const index = nextLabel++;
  const rowIndex = index - 12;
  const id = boxes.create(
    { position: [(rowIndex % 8) - 3.5, 4 + Math.floor(rowIndex / 8) * 1.2, 0] },
    { label: `grown-${index}` }
  );
  boxes.setColor(id, [1, 0.45, 0.2, 1]);
  return id;
}

scene.onPointerPick = (_event, result) => {
  const resolved = picking.fromPick({ pickedMesh: result.pickedMesh as typeof source, thinInstanceIndex: result.thinInstanceIndex });
  selected = resolved?.id;
  if (selected !== undefined) {
    status.textContent = `Selected ${boxes.getMetadata(selected)?.label}; stable ID ${Number(selected)} currently occupies slot ${boxes.getSlot(selected)}.`;
    markCheck("pickCheck", "picking ✓");
  }
  refreshPanel();
};

toggleButton.addEventListener("click", () => {
  if (selected === undefined || !boxes.has(selected)) return;
  const nextVisible = !boxes.getVisible(selected);
  boxes.setVisible(selected, nextVisible);
  const label = boxes.getMetadata(selected)?.label;
  status.textContent = `${nextVisible ? "Shown" : "Hidden"} ${label} by stable ID ${Number(selected)}; its current slot is ${boxes.getSlot(selected)}.`;
  if (nextVisible && hiddenOnce.has(selected)) markCheck("visibilityCheck", "hide/show ✓");
  if (!nextVisible) hiddenOnce.add(selected);
  refreshPanel();
});
removeButton.addEventListener("click", () => {
  if (selected === undefined || !boxes.has(selected)) return;
  const removedId = selected;
  const removedSlot = boxes.getSlot(removedId)!;
  const previousSlots = new Map(Array.from(boxes.slots(), ({ id, slot }) => [id, slot]));
  const label = boxes.getMetadata(removedId)?.label;
  boxes.remove(removedId);
  const moved = Array.from(previousSlots).find(([id, oldSlot]) => boxes.has(id) && boxes.getSlot(id) !== oldSlot);
  const moveDescription = moved
    ? ` Stable ID ${Number(moved[0])} moved from slot ${moved[1]} to slot ${boxes.getSlot(moved[0])}.`
    : " No slot swap was needed.";
  status.textContent = `Removed ${label} (stable ID ${Number(removedId)}) from slot ${removedSlot}.${moveDescription}`;
  selected = undefined;
  markCheck("removeCheck", "compaction ✓");
  refreshPanel();
});
document.querySelector("#add")!.addEventListener("click", () => {
  const id = addOne();
  status.textContent = `Added ${boxes.getMetadata(id)?.label} as stable ID ${Number(id)} in slot ${boxes.getSlot(id)}.`;
  refreshPanel();
});
document.querySelector("#grow")!.addEventListener("click", () => {
  const previousCapacity = boxes.capacity;
  let added = 0;
  while (boxes.capacity === previousCapacity) {
    addOne();
    added++;
  }
  status.textContent = `Added ${added} instance${added === 1 ? "" : "s"}; capacity grew from ${previousCapacity} to ${boxes.capacity}. Existing stable IDs remain valid.`;
  markCheck("growCheck", "growth ✓");
  refreshPanel();
});

refreshPanel();

engine.runRenderLoop(() => {
  scene.render();
  document.body.dataset.rendered = "true";
});
window.addEventListener("resize", () => engine.resize());
