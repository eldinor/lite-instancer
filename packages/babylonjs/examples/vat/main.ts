import { Animation } from "@babylonjs/core/Animations/animation.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Color3, Color4, Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  createVatInstanceSet,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId
} from "@litools/instancer-babylonjs";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.05, 26, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.4, 1, -0.2), scene);

const source = MeshBuilder.CreateBox("skinned-source", { width: 0.75, height: 2, depth: 0.75 }, scene);
const material = new StandardMaterial("vat-material", scene);
material.diffuseColor = new Color3(0.35, 0.78, 1);
source.material = material;

const skeleton = new Skeleton("sway-skeleton", "sway-skeleton", scene);
new Bone("root", skeleton, null, Matrix.Identity());
const animatedBone = new Bone("upper", skeleton, skeleton.bones[0], Matrix.Identity());
source.skeleton = skeleton;
const positions = source.getVerticesData(VertexBuffer.PositionKind)!;
const boneIndices: number[] = [];
const boneWeights: number[] = [];
for (let offset = 0; offset < positions.length; offset += 3) {
  boneIndices.push((positions[offset + 1] ?? 0) > 0 ? 1 : 0, 0, 0, 0);
  boneWeights.push(1, 0, 0, 0);
}
source.setVerticesData(VertexBuffer.MatricesIndicesKind, boneIndices);
source.setVerticesData(VertexBuffer.MatricesWeightsKind, boneWeights);
skeleton.prepare();

const sway = new Animation(
  "sway",
  "rotationQuaternion",
  30,
  Animation.ANIMATIONTYPE_QUATERNION,
  Animation.ANIMATIONLOOPMODE_CYCLE
);
sway.setKeys([
  { frame: 0, value: Quaternion.Identity() },
  { frame: 10, value: Quaternion.RotationAxis(Vector3.Forward(), 0.5) },
  { frame: 20, value: Quaternion.RotationAxis(Vector3.Forward(), -0.5) },
  { frame: 30, value: Quaternion.Identity() }
]);
animatedBone.animations.push(sway);
const swayGroup = new AnimationGroup("Sway", scene);
swayGroup.addTargetedAnimation(sway, animatedBone);

const actors = createVatInstanceSet<{ label: string }>(engine, source, [swayGroup], {
  capacity: 4,
  grow: "double",
  colors: true,
  clip: "Sway"
});
let nextIndex = 0;
function addActor(): InstanceId {
  const index = nextIndex++;
  const id = actors.create({
    transform: { position: [(index % 5) * 2.5 - 5, Math.floor(index / 5) * 3 - 1.5, 0] },
    metadata: { label: `actor-${index}` },
    clip: "Sway",
    offset: index * 0.12,
    fps: index % 2 === 0 ? 30 : 18
  });
  actors.setColor(id, [0.25 + (index % 5) * 0.12, 0.65, 1, 1]);
  return id;
}
for (let index = 0; index < 8; index++) addActor();

const status = document.querySelector<HTMLElement>("#status")!;
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const phase = document.querySelector<HTMLButtonElement>("#phase")!;
const speed = document.querySelector<HTMLButtonElement>("#speed")!;
const remove = document.querySelector<HTMLButtonElement>("#remove")!;
let selected: InstanceId | undefined;
const phaseOffsets = new Map<InstanceId, number>();
const slowIds = new Set<InstanceId>();

function refreshPanel(): void {
  const valid = selected !== undefined && actors.has(selected);
  const sample = valid ? actors.getPlaybackSample(selected!) : undefined;
  document.querySelector("#selectedId")!.textContent = valid ? String(Number(selected)) : "—";
  document.querySelector("#selectedSlot")!.textContent = valid ? String(actors.getSlot(selected!)) : "—";
  document.querySelector("#frame")!.textContent = sample ? `${sample.frame}→${sample.nextFrame}` : "—";
  document.querySelector("#fps")!.textContent = sample ? String(sample.fps) : "—";
  document.querySelector("#count")!.textContent = String(actors.count);
  document.querySelector("#visibleCount")!.textContent = String(actors.visibleCount);
  document.querySelector("#capacity")!.textContent = String(actors.capacity);
  document.querySelector("#clip")!.textContent = sample?.clip ?? actors.activeClip ?? "—";
  toggle.disabled = phase.disabled = speed.disabled = remove.disabled = !valid;
  toggle.textContent = valid && !actors.getVisible(selected!) ? "Show selected" : "Hide selected";
}

canvas.addEventListener("pointerup", (event) => {
  const picked = pickScreenSpaceInstanceFromPointer({
    event,
    canvas,
    ids: actors.ids(),
    camera,
    getWorldPosition: (id) => actors.getPositionOrUndefined(id),
    isVisible: (id) => actors.getVisible(id),
    getScreenRadius: () => 38
  });
  selected = picked?.id;
  status.textContent = selected === undefined
    ? "No logical instance center was inside the pick radius."
    : `Selected ${actors.getMetadata(selected)?.label} by stable ID ${Number(selected)}.`;
  refreshPanel();
});

toggle.addEventListener("click", () => {
  if (selected === undefined || !actors.has(selected)) return;
  const visible = !actors.getVisible(selected);
  actors.setVisible(selected, visible);
  status.textContent = `${visible ? "Shown" : "Hidden"} ${actors.getMetadata(selected)?.label}; playback parameters remain attached to its stable ID.`;
  refreshPanel();
});

phase.addEventListener("click", () => {
  if (selected === undefined || !actors.has(selected)) return;
  const offset = ((phaseOffsets.get(selected) ?? 0) + 0.25) % 1;
  phaseOffsets.set(selected, offset);
  actors.setPhaseOffset(selected, offset);
  status.textContent = `Set ${actors.getMetadata(selected)?.label} phase offset to ${offset.toFixed(2)} seconds.`;
  refreshPanel();
});

speed.addEventListener("click", () => {
  if (selected === undefined || !actors.has(selected)) return;
  const slow = !slowIds.has(selected);
  if (slow) slowIds.add(selected); else slowIds.delete(selected);
  actors.setFps(selected, slow ? 10 : 30);
  status.textContent = `Set ${actors.getMetadata(selected)?.label} to ${slow ? 10 : 30} FPS.`;
  refreshPanel();
});

remove.addEventListener("click", () => {
  if (selected === undefined || !actors.has(selected)) return;
  const label = actors.getMetadata(selected)?.label;
  actors.remove(selected);
  phaseOffsets.delete(selected);
  slowIds.delete(selected);
  selected = undefined;
  status.textContent = `Removed ${label}; VAT playback settings were rebuilt in compacted slot order.`;
  refreshPanel();
});

document.querySelector("#grow")!.addEventListener("click", () => {
  const previousCapacity = actors.capacity;
  let added = 0;
  while (actors.capacity === previousCapacity) {
    addActor();
    added++;
  }
  status.textContent = `Added ${added} actor${added === 1 ? "" : "s"}; capacity grew ${previousCapacity} → ${actors.capacity} with stable playback IDs.`;
  refreshPanel();
});

refreshPanel();
engine.runRenderLoop(() => {
  actors.update(engine.getDeltaTime() / 1000);
  scene.render();
  if (selected !== undefined) refreshPanel();
});
window.addEventListener("resize", () => engine.resize());
