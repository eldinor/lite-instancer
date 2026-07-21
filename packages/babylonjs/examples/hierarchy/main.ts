import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  createHierarchyInstanceSet,
  createPickingRegistry,
  type InstanceId
} from "@litools/instancer-babylonjs";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.08, 28, new Vector3(0, 0.4, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.4, 1, -0.2), scene);

const root = new TransformNode("vehicle-source", scene);
const body = MeshBuilder.CreateBox("body", { width: 2.4, height: 0.8, depth: 1.2 }, scene);
body.parent = root;
body.position.y = 0.25;
const cabin = MeshBuilder.CreateBox("cabin", { width: 1.15, height: 0.7, depth: 1.05 }, scene);
cabin.parent = root;
cabin.position.set(0.2, 0.95, 0);
const bodyMaterial = new StandardMaterial("body-material", scene);
bodyMaterial.diffuseColor = new Color3(0.18, 0.62, 0.95);
body.material = bodyMaterial;
cabin.material = bodyMaterial;

const wheelMaterial = new StandardMaterial("wheel-material", scene);
wheelMaterial.diffuseColor = new Color3(0.07, 0.09, 0.12);
for (const [x, z] of [[-0.75, -0.68], [0.75, -0.68], [-0.75, 0.68], [0.75, 0.68]] as const) {
  const wheel = MeshBuilder.CreateCylinder(`wheel-${x}-${z}`, { height: 0.22, diameter: 0.55, tessellation: 18 }, scene);
  wheel.parent = root;
  wheel.position.set(x, -0.15, z);
  wheel.rotation.x = Math.PI / 2;
  wheel.material = wheelMaterial;
}

const vehicles = createHierarchyInstanceSet<{ label: string }>(root, { capacity: 4, grow: "rebuild" });
let nextIndex = 0;
function addVehicle(): InstanceId {
  const index = nextIndex++;
  return vehicles.create(
    { position: [(index % 4) * 4 - 6, Math.floor(index / 4) * 3 - 1.5, 0] },
    { label: `vehicle-${index}` }
  );
}
for (let index = 0; index < 8; index++) addVehicle();

const picking = createPickingRegistry().registerMany(vehicles.meshes, vehicles);
const status = document.querySelector<HTMLElement>("#status")!;
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const remove = document.querySelector<HTMLButtonElement>("#remove")!;
let selected: InstanceId | undefined;

function refreshPanel(): void {
  const valid = selected !== undefined && vehicles.has(selected);
  document.querySelector("#selectedId")!.textContent = valid ? String(Number(selected)) : "—";
  document.querySelector("#selectedSlot")!.textContent = valid ? String(vehicles.getSlot(selected!)) : "—";
  document.querySelector("#count")!.textContent = String(vehicles.count);
  document.querySelector("#capacity")!.textContent = String(vehicles.capacity);
  toggle.disabled = !valid;
  remove.disabled = !valid;
  toggle.textContent = valid && !vehicles.getVisible(selected!) ? "Show selected" : "Hide selected";
}

scene.onPointerPick = (_event, result) => {
  const resolved = picking.fromPick({ pickedMesh: result.pickedMesh as typeof body, thinInstanceIndex: result.thinInstanceIndex });
  selected = resolved?.id;
  if (selected !== undefined) {
    status.textContent = `Picked ${result.pickedMesh?.name}: ${vehicles.getMetadata(selected)?.label}, stable ID ${Number(selected)}, slot ${vehicles.getSlot(selected)}.`;
  }
  refreshPanel();
};

toggle.addEventListener("click", () => {
  if (selected === undefined || !vehicles.has(selected)) return;
  const visible = !vehicles.getVisible(selected);
  vehicles.setVisible(selected, visible);
  status.textContent = `${visible ? "Shown" : "Hidden"} ${vehicles.getMetadata(selected)?.label} across all ${vehicles.meshes.length} child meshes.`;
  refreshPanel();
});

remove.addEventListener("click", () => {
  if (selected === undefined || !vehicles.has(selected)) return;
  const label = vehicles.getMetadata(selected)?.label;
  vehicles.remove(selected);
  status.textContent = `Removed ${label}; every child mesh was compacted to the same slot layout.`;
  selected = undefined;
  refreshPanel();
});

document.querySelector("#add")!.addEventListener("click", () => {
  const before = vehicles.capacity;
  const id = addVehicle();
  status.textContent = `Added ${vehicles.getMetadata(id)?.label} as ID ${Number(id)}${vehicles.capacity !== before ? `; rebuilt capacity ${before} → ${vehicles.capacity}` : ""}.`;
  refreshPanel();
});

refreshPanel();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
