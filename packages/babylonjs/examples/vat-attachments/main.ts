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
  bakeVatSocketAsset,
  createVatAttachmentBinding,
  createVatCharacterSet,
  getInstanceSetWorldCenter,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId,
  type VatAttachmentPreset
} from "@litools/instancer-babylonjs";

RegisterGLTF2Loader();
RegisterGLTFFileLoader();
registerBuiltInGLTFExtensions();

const CHARACTER_URL = "https://assets.babylonjs.com/meshes/HVGirl.glb";
const SWORD_URL = "/fantasy_sword.glb";
const RIGHT_HAND = "mixamorig:RightHand";
const CHARACTER_MODEL_SCALE = 0.1;
const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const errorText = document.querySelector<HTMLElement>("#error")!;
window.addEventListener("error", (event) => { errorText.textContent = event.message; });
window.addEventListener("unhandledrejection", (event) => {
  errorText.textContent = event.reason instanceof Error ? event.reason.message : String(event.reason);
});

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.09, 0.12, 0.17, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.12, 10, new Vector3(0, 0.9, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.4, 1, -0.2), scene);
const ground = MeshBuilder.CreateGround("ground", { width: 24, height: 18 }, scene);
const groundMaterial = new StandardMaterial("ground-material", scene);
groundMaterial.diffuseColor = new Color3(0.16, 0.19, 0.23);
ground.material = groundMaterial;

// Keep one unrendered rig for socket baking. The rendered copy becomes VAT-only.
const socketContainer = await loadAssetContainerAsync(CHARACTER_URL, scene);
const characterContainer = await loadAssetContainerAsync(CHARACTER_URL, scene);
characterContainer.addAllToScene();
const socketRoot = socketContainer.rootNodes[0] as Node | undefined;
const characterRoot = characterContainer.rootNodes[0] as Node | undefined;
if (!socketRoot || !characterRoot) throw new Error("HVGirl.glb did not provide a hierarchy root.");
const animations = characterContainer.animationGroups;
if (animations.length === 0) throw new Error("HVGirl.glb did not provide animation groups.");
for (const group of animations) group.stop();

const characters = createVatCharacterSet<{ label: string }>(engine, characterRoot, animations, {
  capacity: 5,
  grow: "double",
  visibleStrategy: "scale-zero",
  clip: animations.find((group) => group.name === "Samba")?.name ?? animations[0]!.name
});
const socketAsset = bakeVatSocketAsset(engine, socketContainer.animationGroups, {
  root: socketRoot,
  clips: characters.clips,
  sockets: { sword: RIGHT_HAND }
});
socketContainer.dispose();

const swordContainer = await loadAssetContainerAsync(SWORD_URL, scene);
swordContainer.addAllToScene();
const swordRoot = swordContainer.rootNodes[0] as Node | undefined;
if (!swordRoot) throw new Error("fantasy_sword.glb did not provide a hierarchy root.");
const preset: VatAttachmentPreset = {
  version: 1,
  character: { kind: "url", url: CHARACTER_URL },
  attachment: { kind: "url", url: SWORD_URL },
  socket: { key: "sword", nodeIndex: -1, nodeName: RIGHT_HAND },
  clipScope: "all",
  // Exact Samba Girl + fantasy sword values from the Lite VAT configurator.
  grip: { translation: [500, 100, 0], rotationEulerDegrees: [0, 0, 0], scale: [600, 600, 600] }
};
const swords = createVatAttachmentBinding<{ label: string }>({
  engine,
  character: characters,
  attachmentRoot: swordRoot,
  socketAsset,
  preset,
  instanceOptions: { capacity: 5, grow: "rebuild", visibleStrategy: "scale-zero" }
});

const positions = [[-3.2, 0, -1.4], [0, 0, -1.4], [3.2, 0, -1.4], [-1.6, 0, 1.8], [1.6, 0, 1.8]] as const;
const pairs = new Map<InstanceId, InstanceId>();
for (let index = 0; index < positions.length; index++) {
  const id = characters.create({
    transform: { position: positions[index]!, scale: CHARACTER_MODEL_SCALE },
    metadata: { label: `dancer-${index + 1}` },
    offset: index * 0.12
  });
  const swordId = swords.create(undefined, { label: `sword-${index + 1}` });
  if (!swords.bind(id, swordId)) throw new Error(`Could not bind sword for character ${Number(id)}.`);
  pairs.set(id, swordId);
}

const clipNames = Object.keys(characters.clips);
let activeClipIndex = Math.max(0, clipNames.indexOf(characters.activeClip ?? ""));
let selected: InstanceId | undefined;
const phaseOffsets = new Map<InstanceId, number>();
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const phase = document.querySelector<HTMLButtonElement>("#phase")!;
const remove = document.querySelector<HTMLButtonElement>("#remove")!;

function refreshPanel(): void {
  const valid = selected !== undefined && characters.has(selected);
  const sample = valid ? characters.getPlaybackSample(selected!) : undefined;
  document.querySelector("#selectedId")!.textContent = valid ? String(Number(selected)) : "—";
  document.querySelector("#selectedSlot")!.textContent = valid ? String(characters.getSlot(selected!)) : "—";
  document.querySelector("#count")!.textContent = String(characters.count);
  document.querySelector("#swords")!.textContent = String(swords.attachments.count);
  document.querySelector("#clip")!.textContent = characters.activeClip ?? "—";
  document.querySelector("#frame")!.textContent = sample ? `${sample.frame}→${sample.nextFrame}` : "—";
  document.querySelector("#parts")!.textContent = String(1 + characters.secondaryParts.length);
  toggle.disabled = phase.disabled = remove.disabled = !valid;
  toggle.textContent = valid && !characters.getVisible(selected!) ? "Show selected" : "Hide selected";
}

canvas.addEventListener("pointerup", (event) => {
  const picked = pickScreenSpaceInstanceFromPointer({
    event, canvas, ids: characters.ids(), camera,
    getWorldPosition: (id) => getInstanceSetWorldCenter(characters.primary, id),
    isVisible: (id) => characters.getVisible(id),
    // Samba Girl is much taller on screen than its logical mesh center. Keep
    // the screen-space picker generous enough for head, torso, arms, and legs.
    getScreenRadius: () => 96
  });
  selected = picked?.id;
  status.textContent = selected === undefined
    ? "No character was inside the logical pick radius."
    : `Selected ${characters.getMetadata(selected)?.label}; commands use stable ID ${Number(selected)}.`;
  refreshPanel();
});

toggle.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const visible = !characters.getVisible(selected);
  characters.setVisible(selected, visible);
  status.textContent = `${visible ? "Shown" : "Hidden"} the selected dancer and its bound sword.`;
  refreshPanel();
});

document.querySelector<HTMLButtonElement>("#nextClip")!.addEventListener("click", () => {
  activeClipIndex = (activeClipIndex + 1) % clipNames.length;
  characters.play(clipNames[activeClipIndex]!);
  status.textContent = `All dancers now use ${clipNames[activeClipIndex]}.`;
  refreshPanel();
});

phase.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const offset = ((phaseOffsets.get(selected) ?? 0) + 0.2) % 1;
  phaseOffsets.set(selected, offset);
  characters.setPhaseOffset(selected, offset);
  status.textContent = `Shifted the selected dancer and sword socket by ${offset.toFixed(1)} seconds.`;
  refreshPanel();
});

remove.addEventListener("click", () => {
  if (selected === undefined || !characters.has(selected)) return;
  const swordId = pairs.get(selected);
  swords.unbind(selected);
  if (swordId !== undefined) swords.attachments.remove(swordId);
  pairs.delete(selected);
  phaseOffsets.delete(selected);
  characters.remove(selected);
  selected = undefined;
  status.textContent = "Removed the selected stable-ID pair; remaining character and sword slots compacted safely.";
  refreshPanel();
});

engine.runRenderLoop(() => {
  characters.update(engine.getDeltaTime() * 0.001);
  swords.update();
  scene.render();
  refreshPanel();
});
window.addEventListener("resize", () => engine.resize());
status.textContent = "Pick a dancer, then hide, show, phase-shift, or remove its stable character/sword pair.";
refreshPanel();
