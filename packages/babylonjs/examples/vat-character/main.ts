import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Node } from "@babylonjs/core/node.js";
import { Scene } from "@babylonjs/core/scene.js";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic.js";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js";
import { RegisterGLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.pure.js";
import {
  createVatCharacterSet,
  getInstanceSetWorldCenter,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId
} from "@litools/instancer-babylonjs";

RegisterGLTF2Loader();
RegisterGLTFFileLoader();
registerBuiltInGLTFExtensions();

const ASSET_URL = "/Unarmed.glb";
const REQUESTED_CLIPS = ["UnarmedIdle", "UnarmedAttackL1", "UnarmedRunForward"] as const;
interface FighterMetadata {
  label: string;
}
const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const errorText = document.querySelector<HTMLElement>("#error")!;
window.addEventListener("error", (event) => {
  errorText.textContent = event.message;
});
window.addEventListener("unhandledrejection", (event) => {
  errorText.textContent = event.reason instanceof Error ? event.reason.message : String(event.reason);
});
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.12, 21, new Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.4, 1, -0.2), scene);

const ground = MeshBuilder.CreateGround("ground", { width: 30, height: 20 }, scene);
const groundMaterial = new StandardMaterial("ground-material", scene);
groundMaterial.diffuseColor = new Color3(0.045, 0.065, 0.09);
ground.material = groundMaterial;

const container = await loadAssetContainerAsync(ASSET_URL, scene);
container.addAllToScene();
const root = container.rootNodes[0] as Node | undefined;
if (!root) throw new Error("Unarmed.glb did not provide a hierarchy root.");
const groupsByName = new Map(container.animationGroups.map((group) => [group.name, group]));
const animations = REQUESTED_CLIPS.map((name) => groupsByName.get(name)).filter((group) => group !== undefined);
if (animations.length === 0) {
  throw new Error(`Unarmed.glb did not provide any requested clips: ${REQUESTED_CLIPS.join(", ")}.`);
}
for (const group of container.animationGroups) group.stop();

const characters = createVatCharacterSet<FighterMetadata>(engine, root, animations, {
  capacity: 4,
  grow: "double",
  visibleStrategy: "scale-zero",
  clip: animations[0]!.name
});
const clipNames = Object.keys(characters.clips);
let nextIndex = 0;
function addCharacter(): InstanceId {
  const index = nextIndex++;
  const clip = clipNames[index % clipNames.length]!;
  const clipData = characters.clips[clip]!;
  const worldPosition = [(index % 4) * 3 - 4.5, 0, Math.floor(index / 4) * 3 - 1.5] as const;
  return characters.create({
    transform: {
      position: worldPosition
    },
    metadata: { label: `fighter-${index}` },
    clip,
    offset: (index / 8) * (clipData.frameCount / clipData.fps),
    fps: clipData.fps * (index % 2 === 0 ? 1 : 0.8)
  });
}
for (let index = 0; index < 8; index++) addCharacter();

const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const nextClip = document.querySelector<HTMLButtonElement>("#nextClip")!;
const phase = document.querySelector<HTMLButtonElement>("#phase")!;
const speed = document.querySelector<HTMLButtonElement>("#speed")!;
const remove = document.querySelector<HTMLButtonElement>("#remove")!;
const grow = document.querySelector<HTMLButtonElement>("#grow")!;
let selected: InstanceId | undefined;
const phaseOffsets = new Map<InstanceId, number>();
const slowIds = new Set<InstanceId>();
function refreshPanel(): void {
  const valid = selected !== undefined && characters.has(selected);
  const sample = valid ? characters.getPlaybackSample(selected!) : undefined;
  document.querySelector("#selectedId")!.textContent = valid ? String(Number(selected)) : "—";
  document.querySelector("#selectedSlot")!.textContent = valid ? String(characters.getSlot(selected!)) : "—";
  document.querySelector("#parts")!.textContent = String(1 + characters.secondaryParts.length);
  document.querySelector("#frame")!.textContent = sample ? `${sample.frame}→${sample.nextFrame}` : "—";
  document.querySelector("#count")!.textContent = String(characters.count);
  document.querySelector("#visibleCount")!.textContent = String(characters.visibleCount);
  document.querySelector("#capacity")!.textContent = String(characters.capacity);
  document.querySelector("#clip")!.textContent = sample?.clip ?? characters.activeClip ?? "—";
  toggle.disabled = nextClip.disabled = phase.disabled = speed.disabled = remove.disabled = !valid;
  grow.disabled = false;
  toggle.textContent = valid && !characters.getVisible(selected!) ? "Show selected" : "Hide selected";
}

canvas.addEventListener("pointerup", (event) => {
  const picked = pickScreenSpaceInstanceFromPointer({
    event,
    canvas,
    ids: characters.ids(),
    camera,
    getWorldPosition: (id) => getInstanceSetWorldCenter(characters.primary, id),
    isVisible: (id) => characters.getVisible(id),
    getScreenRadius: () => 44
  });
  selected = picked?.id;
  status.textContent = selected === undefined
    ? "No character center was inside the logical pick radius."
    : `Selected ${characters.getMetadata(selected)?.label}; all ${1 + characters.secondaryParts.length} mesh parts share stable ID ${Number(selected)}.`;
  refreshPanel();
});

toggle.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const visible = !characters.getVisible(selected);
  characters.setVisible(selected, visible);
  status.textContent = `${visible ? "Shown" : "Hidden"} ${characters.getMetadata(selected)?.label} across every mesh part.`;
  refreshPanel();
});

nextClip.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const current = characters.getPlaybackSample(selected)?.clip;
  const clip = clipNames[(Math.max(0, clipNames.indexOf(current ?? "")) + 1) % clipNames.length]!;
  characters.setClip(selected, clip);
  status.textContent = `Switched ${characters.getMetadata(selected)?.label} to ${clip} across every mesh part.`;
  refreshPanel();
});

phase.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const offset = ((phaseOffsets.get(selected) ?? 0) + 0.2) % 1;
  phaseOffsets.set(selected, offset);
  characters.setPhaseOffset(selected, offset);
  status.textContent = `Set synchronized phase offset to ${offset.toFixed(2)} seconds.`;
  refreshPanel();
});

speed.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const slow = !slowIds.has(selected);
  if (slow) slowIds.add(selected); else slowIds.delete(selected);
  const baseFps = characters.clips[characters.getPlaybackSample(selected)?.clip ?? ""]?.fps ?? 30;
  characters.setFps(selected, slow ? baseFps * 0.5 : baseFps);
  status.textContent = `Set synchronized playback to ${slow ? "half" : "normal"} speed.`;
  refreshPanel();
});

remove.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const label = characters.getMetadata(selected)?.label;
  characters.remove(selected);
  phaseOffsets.delete(selected);
  slowIds.delete(selected);
  selected = undefined;
  status.textContent = `Removed ${label}; every mesh part compacted in synchronized slot order.`;
  refreshPanel();
});

grow.addEventListener("click", () => {
  const previousCapacity = characters.capacity;
  let added = 0;
  while (characters.capacity === previousCapacity) {
    addCharacter();
    added++;
  }
  status.textContent = `Added ${added} character${added === 1 ? "" : "s"}; every mesh-part pool grew ${previousCapacity} → ${characters.capacity}.`;
  refreshPanel();
});

status.textContent = `Loaded Unarmed.glb from the Lite example with ${1 + characters.secondaryParts.length} skinned mesh parts and ${clipNames.length} selected clips.`;
refreshPanel();
engine.runRenderLoop(() => {
  characters.update(engine.getDeltaTime() / 1000);
  scene.render();
  if (selected !== undefined) refreshPanel();
});
window.addEventListener("resize", () => engine.resize());
window.addEventListener("beforeunload", () => {
  characters.dispose();
  container.dispose();
});
