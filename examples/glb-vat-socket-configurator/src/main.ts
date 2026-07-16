import {
  addToScene,
  attachControl,
  bakeVat,
  createArcRotateCamera,
  createGround,
  createPbrMaterial,
  createSphere,
  loadEnvironment,
  loadGltf,
  mat4Compose,
  mat4Decompose,
  mat4Multiply,
  invalidateRenderBundles,
  onBeforeRender,
  vec3,
  type ArcRotateCamera,
  type AssetContainer,
  type Mat4,
  type Mesh,
  type SceneNode
} from "@babylonjs/lite";
import {
  bakeVatSocketAsset,
  attachVatSafely,
  createHierarchyInstanceSet,
  createInstanceSet,
  createVatAttachmentController,
  createVatAttachmentPreset,
  createVatInstanceSet,
  disposeVatGlbAssets,
  getVatSocketCandidates,
  quaternionFromEulerDegrees,
  sampleVatSocket,
  serializeVatAttachmentPreset,
  type VatAttachmentAssetReference,
  type VatAttachmentGrip,
  type VatAttachmentPreset
} from "../../../src/index.js";
import { collectMeshes, createExample, runExample } from "../../shared/app.js";

const READY_PLAYER_URL = "https://raw.githubusercontent.com/eldinor/ForBJS/master/all-anim.glb";
const SAMBA_URL = "https://assets.babylonjs.com/meshes/HVGirl.glb";
const SWORD_URL = "/fantasy_sword.glb";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const CONFIGURATOR_CAMERA_TARGET = [-1.2880618569595765, 0.45020791361900053, -0.7928849665901115] as const;

type GltfSource = string | File;

interface CharacterPreset {
  label: string;
  source: string;
  scale: number;
  cameraRadius: number;
  grip: { x: number; y: number; z: number; pitch: number; yaw: number; roll: number; sx: number; sy: number; sz: number };
}

interface SocketChoice {
  nodeIndex: number;
  nodeName: string;
}

interface PreviewRuntime {
  socketSource: AssetContainer;
  characterContainer: AssetContainer;
  attachmentContainer: AssetContainer;
  characterRoot: SceneNode;
  attachmentRoot: SceneNode;
  characterMeshes: Mesh[];
  attachmentMeshes: Mesh[];
  characters: ReturnType<typeof createVatInstanceSet>;
  secondary: Array<{ handle: ReturnType<typeof attachVatSafely>; set: ReturnType<typeof createInstanceSet> }>;
  secondaryIds: number[][];
  characterIds: number[];
  attachments: ReturnType<typeof createHierarchyInstanceSet>;
  attachmentIds: number[];
  socketAsset: ReturnType<typeof bakeVatSocketAsset>;
  controller: ReturnType<typeof createVatAttachmentController>;
  attachmentRootMatrix: Mat4;
  socketChoices: SocketChoice[];
  activeAnimationIndex: number;
}

const ctx = await createExample("GLB VAT Socket Configurator", { createDefaultCamera: false });
const configuratorCamera = createArcRotateCamera(3 * Math.PI / 4, Math.PI / 3.2, 4.2, vec3(...CONFIGURATOR_CAMERA_TARGET));
ctx.scene.camera = configuratorCamera;
addToScene(ctx.scene, configuratorCamera);
attachControl(configuratorCamera, ctx.canvas, ctx.scene);
await loadEnvironment(ctx.scene, ENVIRONMENT_URL, { brdfUrl: BRDF_URL });

const ground = createGround(ctx.engine, { width: 32, height: 32 });
ground.material = createPbrMaterial({ baseColorFactor: [0.08, 0.1, 0.13, 1], roughnessFactor: 0.95, metallicFactor: 0 });
addToScene(ctx.scene, ground);

const socketMarker = createMarker([0.15, 0.88, 1, 1]);
const attachmentMarker = createMarker([1, 0.52, 0.14, 1]);

const presets: Record<string, CharacterPreset> = {
  "ready-player": {
    label: "Ready Player", source: READY_PLAYER_URL, scale: 1, cameraRadius: 4.2,
    grip: { x: 0.42, y: 0.09, z: 0.01, pitch: 0, yaw: 0, roll: 0, sx: 0.53, sy: 0.53, sz: 0.53 }
  },
  samba: {
    label: "Samba Girl", source: SAMBA_URL, scale: 0.1, cameraRadius: 10,
    // HVGirl's animated hand hierarchy is authored at 0.01 and the preview
    // applies another 0.1 character scale. These values keep the curated
    // meter-sized Fantasy Sword visible in that hand space.
    grip: { x: 500, y: 100, z: 0, pitch: 0, yaw: 0, roll: 0, sx: 600, sy: 600, sz: 600 }
  }
};
const readyPlayerPreset = presets["ready-player"]!;
let characterSource: GltfSource = readyPlayerPreset.source;
let attachmentSource: GltfSource = SWORD_URL;
let characterReference: VatAttachmentAssetReference = { kind: "url", url: READY_PLAYER_URL };
let attachmentReference: VatAttachmentAssetReference = { kind: "url", url: SWORD_URL };
let characterScale = readyPlayerPreset.scale;
let cameraRadius = readyPlayerPreset.cameraRadius;
let selectedSocket: SocketChoice | undefined;
let previewCount = 1;
let playing = true;
let showMarkers = true;
let attachmentVisible = true;
let scaleAll = readyPlayerPreset.grip.sx;
let animationSpeed = 1;
let phaseStepSeconds = 0;
let fpsStepMultiplier = 0;
let runtime: PreviewRuntime | undefined;
let rebuildGeneration = 0;
const grip: { x: number; y: number; z: number; pitch: number; yaw: number; roll: number; sx: number; sy: number; sz: number } = {
  ...readyPlayerPreset.grip
};

const editor = createEditor();
const uploadGuidance = createUploadGuidance();
let uploadGuidanceTimer: ReturnType<typeof setTimeout> | undefined;
ctx.panel.button("download JSON", () => download("vat-attachment.json", serializeVatAttachmentPreset(getPreset())));
ctx.panel.button("copy TypeScript", () => void copyText(createTypeScriptSnippet(getPreset())));
ctx.panel.set("status", "loading Ready Player and Fantasy Sword");
await rebuildPreview();

onBeforeRender(ctx.scene, (deltaMs) => {
  const current = runtime;
  if (!current) {
    return;
  }
  if (playing) {
    const deltaSeconds = deltaMs * 0.001 * animationSpeed;
    current.characters.update(deltaSeconds);
    for (const part of current.secondary) {
      part.handle.update(deltaSeconds);
    }
  }
  current.controller.update();
  updateMarkers(current);
});

await runExample(ctx);

function createEditor(): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "panel attachment-configurator-panel";
  const heading = document.createElement("h1");
  heading.textContent = "Attachment configuration";
  const fieldset = document.createElement("fieldset");
  fieldset.className = "configurator-editor";
  fieldset.innerHTML = "<legend>GLB socket and grip</legend>";
  panel.append(heading, fieldset);
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("pointerup", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  document.body.append(panel);

  const characterSelect = addSelect(fieldset, "Character preset", Object.entries(presets).map(([value, preset]) => ({ value, label: preset.label })));
  characterSelect.value = "ready-player";
  characterSelect.addEventListener("change", () => {
    const preset = presets[characterSelect.value];
    if (!preset) return;
    characterSource = preset.source;
    characterReference = { kind: "url", url: preset.source };
    characterScale = preset.scale;
    cameraRadius = preset.cameraRadius;
    selectedSocket = undefined;
    applyGripPreset(preset.grip);
    void rebuildPreview();
  });
  addFileInput(fieldset, "Character .glb", async (file) => {
    characterSource = file;
    characterReference = { kind: "local-glb", fileName: file.name };
    characterScale = 1;
    cameraRadius = 5;
    applyGripPreset({ ...grip, sx: 1, sy: 1, sz: 1 });
    selectedSocket = undefined;
    await rebuildPreview();
    showUploadGuidance("Character GLB loaded. Attachment scale was reset to 1.");
  });
  addFileInput(fieldset, "Attachment .glb", async (file) => {
    attachmentSource = file;
    attachmentReference = { kind: "local-glb", fileName: file.name };
    await rebuildPreview();
    showUploadGuidance("Attachment GLB loaded.");
  });

  const socketSelect = addSelect(fieldset, "Animated socket", []);
  socketSelect.addEventListener("change", () => {
    const choice = runtime?.socketChoices.find((item) => String(item.nodeIndex) === socketSelect.value);
    if (!choice) return;
    selectedSocket = choice;
    void rebuildPreview();
  });
  socketSelect.dataset.socketPicker = "true";

  const clipButton = addButton(fieldset, "next clip", () => {
    const current = runtime;
    if (!current) return;
    current.activeAnimationIndex = (current.activeAnimationIndex + 1) % Object.keys(current.characters.clips).length;
    activateClip(current);
  });
  clipButton.dataset.clipButton = "true";
  addButton(fieldset, "play / pause", () => {
    playing = !playing;
    ctx.panel.set("playback", playing ? "playing" : "paused");
  });
  addButton(fieldset, "1 / 5 instance test", () => {
    previewCount = previewCount === 1 ? 5 : 1;
    applyPreviewMode();
  });
  addRangeInput(fieldset, "Total animation speed", 0, 2, 0.05, animationSpeed, (value) => {
    animationSpeed = value;
    ctx.panel.set("animation speed", `${animationSpeed.toFixed(2)}x`);
  });
  addRangeInput(fieldset, "Phase step (seconds)", 0, 1, 0.01, phaseStepSeconds, (value) => {
    phaseStepSeconds = value;
    applyPreviewMode();
  });
  addRangeInput(fieldset, "FPS step (multiplier)", -0.2, 0.25, 0.01, fpsStepMultiplier, (value) => {
    fpsStepMultiplier = value;
    applyPreviewMode();
  });
  addButton(fieldset, "toggle origin markers", () => {
    showMarkers = !showMarkers;
    socketMarker.visible = showMarkers;
    attachmentMarker.visible = showMarkers;
  });
  addButton(fieldset, "toggle attachment", () => {
    const current = runtime;
    if (!current) return;
    attachmentVisible = !attachmentVisible;
    applyPreviewMode();
    ctx.panel.set("attachment", attachmentVisible ? "visible" : "hidden");
  });

  const transformTitle = document.createElement("strong");
  transformTitle.textContent = "Grip transform";
  fieldset.append(transformTitle);
  for (const [label, key, min, max, step] of [
    ["X", "x", -1000, 1000, 0.01], ["Y", "y", -1000, 1000, 0.01], ["Z", "z", -1000, 1000, 0.01],
    ["Pitch", "pitch", -180, 180, 1], ["Yaw", "yaw", -180, 180, 1], ["Roll", "roll", -180, 180, 1],
    ["Scale X", "sx", 0.001, 2000, 0.01], ["Scale Y", "sy", 0.001, 2000, 0.01], ["Scale Z", "sz", 0.001, 2000, 0.01]
  ] as const) {
    addNumberInput(fieldset, label, key, min, max, step);
  }
  addRangeInput(fieldset, "Scale all", 0.01, 2000, 0.01, scaleAll, (nextScale) => {
    const normalizedScale = normalizeScale(nextScale);
    const multiplier = normalizedScale / scaleAll;
    grip.sx = normalizeScale(grip.sx * multiplier);
    grip.sy = normalizeScale(grip.sy * multiplier);
    grip.sz = normalizeScale(grip.sz * multiplier);
    scaleAll = normalizedScale;
    syncGripInputs(fieldset);
    updateBindings();
  });
  addButton(fieldset, "reset transform", () => {
    Object.assign(grip, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, sx: 1, sy: 1, sz: 1 });
    scaleAll = 1;
    syncGripInputs(fieldset);
    syncScaleAllInput(fieldset);
    updateBindings();
  });
  addButton(fieldset, "copy transform", () => void copyText(JSON.stringify(getGrip(), null, 2)));
  return fieldset;
}

function createUploadGuidance(): HTMLElement {
  const toast = document.createElement("aside");
  toast.className = "upload-guidance";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  const title = document.createElement("strong");
  title.dataset.uploadGuidanceTitle = "true";
  const message = document.createElement("p");
  message.textContent = "GLBs can use different units and pivots. If the weapon is not visible, adjust Scale all, then tune X/Y/Z and rotation. Also choose an animated hand socket, make sure the attachment is visible, and orbit or zoom the camera to frame it.";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Got it";
  close.addEventListener("click", () => hideUploadGuidance());
  toast.append(title, message, close);
  document.body.append(toast);
  return toast;
}

function showUploadGuidance(title: string): void {
  const titleElement = uploadGuidance.querySelector<HTMLElement>("[data-upload-guidance-title]");
  if (titleElement) titleElement.textContent = title;
  uploadGuidance.classList.add("is-visible");
  if (uploadGuidanceTimer) clearTimeout(uploadGuidanceTimer);
  uploadGuidanceTimer = setTimeout(hideUploadGuidance, 12_000);
}

function hideUploadGuidance(): void {
  uploadGuidance.classList.remove("is-visible");
  if (uploadGuidanceTimer) clearTimeout(uploadGuidanceTimer);
  uploadGuidanceTimer = undefined;
}

async function rebuildPreview(): Promise<void> {
  const generation = ++rebuildGeneration;
  ctx.panel.set("status", "loading assets");
  cleanupRuntime();
  try {
    const [socketSource, characterContainer, attachmentContainer] = await Promise.all([
      loadGltf(ctx.engine, characterSource),
      loadGltf(ctx.engine, characterSource),
      loadGltf(ctx.engine, attachmentSource)
    ]);
    // A user can select another GLB while these requests are in flight. Never
    // add an obsolete container to the scene after the newer selection wins.
    if (generation !== rebuildGeneration) return;
    const sourceAnimations = socketSource.animationGroups ?? [];
    prepareDynamicMaterialGroups(characterContainer, attachmentContainer);
    addToScene(ctx.scene, characterContainer);
    const characterRoot = requireRoot(characterContainer.entities[0], "Character");
    const characterMeshes = collectMeshes(characterRoot).filter((mesh) => !!mesh.skeleton);
    const firstMesh = characterMeshes.shift();
    const animations = characterContainer.animationGroups ?? [];
    if (!firstMesh || sourceAnimations.length === 0 || animations.length === 0) {
      throw new Error("Character GLB needs skinned meshes and at least one animation group.");
    }
    const characters = createVatInstanceSet(ctx.engine, firstMesh, animations, { capacity: 5, engine: ctx.engine, visibleStrategy: "scale-zero" });
    const socketChoices = getVatSocketCandidates(sourceAnimations);
    if (socketChoices.length === 0) {
      throw new Error("No node is animated by every clip, so there is no socket safe for all-clip VAT baking.");
    }
    const requestedSocket = selectedSocket;
    const socket = socketChoices.find((choice) => choice.nodeIndex === requestedSocket?.nodeIndex)
      ?? socketChoices.find((choice) => /right.*(hand|wrist)|(hand|wrist).*right/i.test(choice.nodeName))
      ?? socketChoices[0];
    if (!socket) throw new Error("No animated socket is available.");
    selectedSocket = socket;
    const socketAsset = bakeVatSocketAsset(ctx.engine, sourceAnimations, { clips: characters.clips, sockets: { attachment: socket.nodeIndex } });
    const secondary = characterMeshes.map((mesh) => ({
      handle: attachVatSafely(ctx.engine, mesh, bakeVat(ctx.engine, mesh, animations)),
      set: createInstanceSet(mesh, { capacity: 5, engine: ctx.engine, visibleStrategy: "scale-zero" })
    }));
    const matrices = createCharacterMatrices(5, characterScale);
    const characterIds = matrices.map((matrix) => characters.create({ transform: matrix, offset: 0 }));
    const secondaryIds = secondary.map((part) => matrices.map((matrix) => part.set.create(matrix)));

    addToScene(ctx.scene, attachmentContainer);
    const attachmentRoot = requireRoot(attachmentContainer.entities[0], "Attachment");
    const attachmentMeshes = collectMeshes(attachmentRoot);
    if (attachmentMeshes.length === 0) throw new Error("Attachment GLB does not contain a mesh.");
    const attachments = createHierarchyInstanceSet(attachmentRoot, { capacity: 5, engine: ctx.engine, visibleStrategy: "scale-zero" });
    const attachmentIds = matrices.map(() => attachments.create());
    const controller = createVatAttachmentController({ characters, attachments, socketAsset, socket: "attachment" });
    const nextRuntime: PreviewRuntime = {
      socketSource, characterContainer, attachmentContainer, characterRoot, attachmentRoot, characterMeshes: [firstMesh, ...characterMeshes], attachmentMeshes, characters, secondary, secondaryIds,
      characterIds, attachments, attachmentIds, socketAsset, socketChoices, controller,
      attachmentRootMatrix: new Float32Array(attachmentRoot.worldMatrix) as Mat4, activeAnimationIndex: 0
    };
    runtime = nextRuntime;
    applyPreviewMode();
    updateBindings();
    updateSocketPicker(socketChoices, socket.nodeIndex);
    setCamera(cameraRadius);
    // GLBs selected after `runExample()` add deferred material builders. Flush
    // them so dynamically loaded Samba meshes become renderables, not merely
    // Explorer-visible scene nodes.
    await flushDeferredSceneBuilders();
    if (generation !== rebuildGeneration) return;
    invalidateRenderBundles(ctx.engine);
    ctx.panel.set("asset", `${labelFor(characterReference)} + ${labelFor(attachmentReference)}`);
    ctx.panel.set("socket", socket.nodeName);
    ctx.panel.set("attachment meshes", attachmentMeshes.length);
    ctx.panel.set("attachment", attachmentVisible ? "visible" : "hidden");
    ctx.panel.set("playback", playing ? "playing" : "paused");
    ctx.panel.set("status", "running");
  } catch (error) {
    if (generation !== rebuildGeneration) return;
    runtime = undefined;
    ctx.panel.set("status", error instanceof Error ? error.message : String(error));
  }
}

function activateClip(current: PreviewRuntime): void {
  const names = Object.keys(current.characters.clips);
  const name = names[current.activeAnimationIndex];
  if (!name || !current.characters.play(name)) return;
  for (const part of current.secondary) {
    const clip = part.handle.clips[name];
    if (!clip) continue;
    part.handle.play(name);
    part.handle.setInstances(createSecondaryParameters(current, clip.fromRow, clip.frameCount, clip.fps));
  }
  ctx.panel.set("active clip", name);
}

function applyPreviewMode(): void {
  const current = runtime;
  if (!current) return;
  const clip = current.characters.getActiveClip();
  const fps = clip?.fps ?? 60;
  for (let index = 0; index < current.characterIds.length; index++) {
    const characterId = current.characterIds[index];
    const attachmentId = current.attachmentIds[index];
    const visible = index < previewCount;
    if (characterId !== undefined) {
      current.characters.setVisible(characterId as never, visible);
      current.characters.setPhaseOffset(characterId as never, previewCount === 5 ? index * phaseStepSeconds : 0);
      current.characters.setFps(characterId as never, previewCount === 5 ? fps * (1 + index * fpsStepMultiplier) : undefined);
    }
    if (attachmentId !== undefined) current.attachments.setVisible(attachmentId as never, visible && attachmentVisible);
    for (let partIndex = 0; partIndex < current.secondary.length; partIndex++) {
      const id = current.secondaryIds[partIndex]?.[index];
      if (id !== undefined) current.secondary[partIndex]?.set.setVisible(id as never, visible);
    }
  }
  activateClip(current);
  updateBindings();
  ctx.panel.set("instances", previewCount);
  ctx.panel.set("phase step", `${phaseStepSeconds.toFixed(2)} s`);
  ctx.panel.set("FPS step", `${fpsStepMultiplier.toFixed(2)}x`);
}

function updateBindings(): void {
  const current = runtime;
  if (!current) return;
  const userGrip = getGripMatrix();
  const fullGrip = mat4Multiply(userGrip, current.attachmentRootMatrix);
  for (let index = 0; index < current.characterIds.length; index++) {
    const characterId = current.characterIds[index];
    const attachmentId = current.attachmentIds[index];
    if (characterId !== undefined && attachmentId !== undefined) current.controller.bind(characterId as never, attachmentId as never, { gripOffset: fullGrip });
  }
  ctx.panel.set("grip", `T ${grip.x.toFixed(2)}, ${grip.y.toFixed(2)}, ${grip.z.toFixed(2)} | R ${grip.pitch}, ${grip.yaw}, ${grip.roll} | S ${grip.sx.toFixed(2)}, ${grip.sy.toFixed(2)}, ${grip.sz.toFixed(2)}`);
}

function createSecondaryParameters(current: PreviewRuntime, fromRow: number, frameCount: number, fps: number): Float32Array {
  const params = new Float32Array(current.characterIds.length * 4);
  for (let index = 0; index < current.characterIds.length; index++) {
    const id = current.characterIds[index];
    const sample = id === undefined ? undefined : current.characters.getPlaybackSample(id as never);
    const offset = index * 4;
    params[offset] = fromRow;
    params[offset + 1] = fromRow + frameCount - 1;
    params[offset + 2] = sample ? sample.offsetSeconds * sample.fps : 0;
    params[offset + 3] = sample?.fps ?? fps;
  }
  return params;
}

function updateMarkers(current: PreviewRuntime): void {
  if (!showMarkers) return;
  const characterId = current.characterIds[0];
  const attachmentId = current.attachmentIds[0];
  if (characterId === undefined || attachmentId === undefined) return;
  const sample = current.characters.getPlaybackSample(characterId as never);
  const socket = sample && sampleVatSocket(current.socketAsset, sample, "attachment");
  if (!socket) return;
  const socketLocal = mat4Compose(socket.translation[0]!, socket.translation[1]!, socket.translation[2]!, socket.rotation[0]!, socket.rotation[1]!, socket.rotation[2]!, socket.rotation[3]!, socket.scale[0]!, socket.scale[1]!, socket.scale[2]!);
  const socketWorld = mat4Multiply(current.characters.getMatrix(characterId as never), mat4Multiply(current.socketAsset.basis as Mat4, socketLocal));
  setMarkerMatrix(socketMarker, socketWorld);
  setMarkerMatrix(attachmentMarker, current.attachments.getMatrix(attachmentId as never));
}

function createMarker(color: readonly [number, number, number, number]): Mesh {
  const marker = createSphere(ctx.engine, { diameter: 0.1, segments: 12 });
  marker.material = createPbrMaterial({ baseColorFactor: [...color] as [number, number, number, number], emissiveColor: [color[0], color[1], color[2]], roughnessFactor: 0.4 });
  addToScene(ctx.scene, marker);
  return marker;
}

function setMarkerMatrix(marker: Mesh, matrix: Mat4): void {
  const { translation, rotation } = mat4Decompose(matrix);
  marker.position.set(translation.x, translation.y, translation.z);
  marker.rotationQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

function getGrip(): VatAttachmentGrip {
  return { translation: [grip.x, grip.y, grip.z], rotationEulerDegrees: [grip.pitch, grip.yaw, grip.roll], scale: [grip.sx, grip.sy, grip.sz] };
}

function getGripMatrix(): Mat4 {
  const [x, y, z, w] = quaternionFromEulerDegrees(grip.pitch, grip.yaw, grip.roll);
  return mat4Compose(grip.x, grip.y, grip.z, x, y, z, w, grip.sx, grip.sy, grip.sz);
}

function getPreset(): VatAttachmentPreset {
  if (!selectedSocket) throw new Error("No socket selected");
  return createVatAttachmentPreset({ version: 1, character: characterReference, attachment: attachmentReference, socket: { key: "attachment", nodeIndex: selectedSocket.nodeIndex, nodeName: selectedSocket.nodeName }, clipScope: "all", grip: getGrip() });
}

function createTypeScriptSnippet(preset: VatAttachmentPreset): string {
  const source = (asset: VatAttachmentAssetReference, variable: string) => asset.kind === "url" ? `const ${variable} = ${JSON.stringify(asset.url)};` : `const ${variable} = "/assets/${asset.fileName}"; // Copy the uploaded GLB here`;
  return `import { addToScene, loadGltf, onBeforeRender, type SceneNode } from "@babylonjs/lite";\nimport { createVatCharacterSet, disposeVatGlbAssets } from "@litools/instancer/vat";\nimport { bakeVatSocketAsset, createVatAttachmentBinding, validateVatAttachmentPreset, type VatAttachmentPreset } from "@litools/instancer/vat-sockets";\n\n${source(preset.character, "characterUrl")}\n${source(preset.attachment, "attachmentUrl")}\n\nconst preset: VatAttachmentPreset = ${JSON.stringify(preset, null, 2)};\n\n// Keep an unrendered source solely for the original glTF socket tracks.\nconst socketSource = await loadGltf(engine, characterUrl);\nconst socketAnimations = socketSource.animationGroups ?? [];\nconst validation = validateVatAttachmentPreset(preset, socketAnimations);\nif (!validation.valid) throw new Error(validation.reason);\n\nconst character = await loadGltf(engine, characterUrl);\naddToScene(scene, character);\nconst characterRoot = character.entities[0] as SceneNode;\nconst animations = character.animationGroups ?? [];\nconst hero = createVatCharacterSet(engine, characterRoot, animations, { capacity: 1, engine });\nconst heroId = hero.create();\nconst socketAsset = bakeVatSocketAsset(engine, socketAnimations, {\n  clips: hero.clips,\n  sockets: { [preset.socket.key]: preset.socket.nodeIndex }\n});\n\nconst weapon = await loadGltf(engine, attachmentUrl);\naddToScene(scene, weapon);\nconst weaponRoot = weapon.entities[0] as SceneNode;\nconst attachment = createVatAttachmentBinding({\n  engine,\n  character: hero,\n  attachmentRoot: weaponRoot,\n  socketAsset,\n  preset,\n  instanceOptions: { capacity: 1 }\n});\nconst weaponId = attachment.create();\nif (!attachment.bind(heroId, weaponId)) throw new Error("Could not bind weapon to VAT socket");\n\n// hero.play("Run"); // switches every skinned mesh part together\nonBeforeRender(scene, (deltaMs) => {\n  hero.update(deltaMs * 0.001);\n  attachment.update();\n});\n\n// On model replacement or page teardown, release both rendered and source GLBs.\n// disposeVatGlbAssets({ scene, containers: [socketSource, character, weapon], disposables: [hero, attachment] });\n`;
}

function createCharacterMatrices(count: number, scale: number): Mat4[] {
  if (count === 1) return [mat4Compose(0, 0, 0, 0, 0, 0, 1, scale, scale, scale)];
  return [-2.1, -1.05, 0, 1.05, 2.1].map((x) => mat4Compose(x, 0, 0, 0, 0, 0, 1, scale, scale, scale));
}

function cleanupRuntime(): void {
  if (!runtime) return;
  runtime.controller.clear();
  disposeVatGlbAssets({
    scene: ctx.scene,
    containers: [runtime.socketSource, runtime.characterContainer, runtime.attachmentContainer],
    disposables: [runtime.characters.set, runtime.attachments, ...runtime.secondary.map((part) => part.set)]
  });
  runtime = undefined;
}

function addSelect(parent: HTMLElement, label: string, options: Array<{ value: string; label: string }>): HTMLSelectElement {
  const row = document.createElement("label");
  row.className = "config-row";
  const name = document.createElement("span");
  name.textContent = label;
  const select = document.createElement("select");
  for (const option of options) select.add(new Option(option.label, option.value));
  row.append(name, select);
  parent.append(row);
  return select;
}

function addFileInput(parent: HTMLElement, label: string, onFile: (file: File) => Promise<void>): void {
  const row = document.createElement("label");
  row.className = "config-row";
  row.textContent = label;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,model/gltf-binary";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void onFile(file);
  });
  row.append(input);
  parent.append(row);
}

function addNumberInput(parent: HTMLElement, label: string, key: keyof typeof grip, min: number, max: number, step: number): void {
  const row = document.createElement("label");
  row.className = "config-number";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(grip[key]);
  input.dataset.gripKey = key;
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) {
      grip[key] = key.startsWith("s") ? normalizeScale(value) : value;
      input.value = String(grip[key]);
      updateBindings();
    }
  });
  row.append(name, input);
  parent.append(row);
}

function addRangeInput(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onInput: (value: number) => void
): void {
  const row = document.createElement("label");
  row.className = "config-range";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  if (label === "Scale all") input.dataset.scaleAll = "true";
  const output = document.createElement("output");
  output.textContent = initial.toFixed(2);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    output.textContent = value.toFixed(2);
    onInput(value);
  });
  row.append(name, input, output);
  parent.append(row);
}

function addButton(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
  parent.append(button);
  return button;
}

function syncGripInputs(parent: HTMLElement): void {
  for (const input of parent.querySelectorAll<HTMLInputElement>("input[data-grip-key]")) {
    const key = input.dataset.gripKey as keyof typeof grip;
    input.value = String(key.startsWith("s") ? normalizeScale(grip[key]) : grip[key]);
  }
}

function syncScaleAllInput(parent: HTMLElement): void {
  const input = parent.querySelector<HTMLInputElement>("input[data-scale-all]");
  const output = input?.parentElement?.querySelector<HTMLOutputElement>("output");
  if (!input || !output) return;
  input.value = String(scaleAll);
  output.textContent = scaleAll.toFixed(2);
}

function applyGripPreset(nextGrip: typeof grip): void {
  Object.assign(grip, {
    ...nextGrip,
    sx: normalizeScale(nextGrip.sx),
    sy: normalizeScale(nextGrip.sy),
    sz: normalizeScale(nextGrip.sz)
  });
  scaleAll = grip.sx;
  syncGripInputs(editor);
  syncScaleAllInput(editor);
}

function normalizeScale(value: number): number {
  return Math.round(value * 100) / 100;
}

function updateSocketPicker(choices: SocketChoice[], selectedIndex: number): void {
  const picker = editor.querySelector<HTMLSelectElement>("select[data-socket-picker]");
  if (!picker) return;
  picker.replaceChildren(...choices.map((choice) => new Option(`${choice.nodeName} (#${choice.nodeIndex})`, String(choice.nodeIndex))));
  picker.value = String(selectedIndex);
}

function requireRoot(value: unknown, label: string): SceneNode {
  if (!value || typeof value !== "object" || !("children" in value) || !("worldMatrix" in value)) throw new Error(`${label} GLB did not provide a scene-node root.`);
  return value as SceneNode;
}

function setCamera(radius: number): void {
  const camera = ctx.scene.camera;
  if (!isArcRotateCamera(camera)) return;
  camera.radius = radius;
  camera.target.x = CONFIGURATOR_CAMERA_TARGET[0];
  camera.target.y = CONFIGURATOR_CAMERA_TARGET[1];
  camera.target.z = CONFIGURATOR_CAMERA_TARGET[2];
}

function isArcRotateCamera(value: unknown): value is ArcRotateCamera {
  return typeof value === "object" && value !== null && "radius" in value && "target" in value;
}

function labelFor(asset: VatAttachmentAssetReference): string {
  return asset.kind === "url" ? asset.url.split("/").pop() ?? asset.url : asset.fileName;
}

async function flushDeferredSceneBuilders(): Promise<void> {
  const scene = ctx.scene as unknown as {
    _deferredBuilders: Array<() => Promise<void>>;
    _materialSwapQueue: unknown[];
    _renderableVersion: number;
    _built: boolean;
  };
  // `addToScene()` queues a material swap whenever a scene is already running.
  // The material groups prepared above will instead be built below as a complete
  // group, just like `buildScene()` does during initial registration.
  scene._materialSwapQueue.length = 0;
  while (scene._deferredBuilders.length > 0) {
    const builders = scene._deferredBuilders.splice(0);
    await Promise.all(builders.map((builder) => builder()));
  }
  scene._renderableVersion++;
  scene._built = true;
}

/**
 * A Lite material build group captures the mesh/material feature set at build
 * time. Reusing the already-built Ready Player group for a newly loaded GLB can leave
 * the dynamic material-swap path with incomplete texture bindings (HVGirl is
 * the reproducible case). Give incoming GLB meshes a fresh group instead.
 */
function prepareDynamicMaterialGroups(...containers: Array<{ entities: unknown[] }>): void {
  const scene = ctx.scene as unknown as {
    _groups: Map<unknown, unknown[]>;
    _builtGroups: Set<unknown>;
  };
  const builders = new Set<unknown>();
  for (const container of containers) {
    for (const mesh of collectMeshes(requireRoot(container.entities[0], "GLB"))) {
      const material = mesh.material as unknown as { _buildGroup?: unknown } | null;
      if (material?._buildGroup) {
        builders.add(material._buildGroup);
      }
    }
  }
  for (const builder of builders) {
    scene._groups.delete(builder);
    scene._builtGroups.delete(builder);
  }
}

function download(fileName: string, text: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  ctx.panel.set("export", "copied to clipboard");
}
