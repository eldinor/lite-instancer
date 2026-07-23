import { Animation } from "@babylonjs/core/Animations/animation.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4, Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  bakeBabylonVatAsset,
  createVatInstanceSet,
  createVatInstanceSetFromAsset,
  decodeBabylonVatAsset,
  encodeBabylonVatAsset,
  inspectInstancerCapabilities,
  type EncodedBabylonVatAsset,
  type InstanceId,
  type VatInstanceSet,
  type VatSocketAsset
} from "@litools/instancer-babylonjs";

interface Rig {
  mesh: Mesh;
  skeleton: Skeleton;
  group: AnimationGroup;
}

interface DisplayState {
  runtime: VatInstanceSet<{ label: string }>;
  loaded: VatInstanceSet<{ label: string }>;
  runtimeRig: Rig;
  loadedRig: Rig;
}

interface CheckResult {
  label: string;
  passed: boolean;
  detail?: string;
}

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const status = document.querySelector<HTMLElement>("#smokeStatus")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const checksElement = document.querySelector<HTMLUListElement>("#checks")!;
const assetInfo = document.querySelector<HTMLElement>("#assetInfo")!;
const capabilitiesElement = document.querySelector<HTMLElement>("#capabilities")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy")!;

const engine = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.012, 0.02, 0.035, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.08, 27, new Vector3(-1.5, 1, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.3, 1, -0.2), scene);
const material = new StandardMaterial("vat-smoke-material", scene);
material.diffuseColor = Color3.White();
material.specularColor = new Color3(0.12, 0.12, 0.12);

let renderCalls = 0;
scene.onBeforeRenderObservable.add(() => renderCalls++);
let current: DisplayState | undefined;
let latestReport = "";
const capabilities = inspectInstancerCapabilities(engine);
capabilitiesElement.textContent = [
  `${capabilities.runtime} · ${capabilities.renderingBackend}`,
  `partial uploads: ${capabilities.partialVatUploads}`,
  `VAT runtime/codecs: ${capabilities.vatAssetRuntime}/${capabilities.vatAssetCodecs}`,
  `encodings: ${capabilities.supportedVatEncodings.join(", ")}`,
  `float16: ${capabilities.float16Shader} · worker: ${capabilities.worker}`
].join("\n");

engine.runRenderLoop(() => {
  const deltaSeconds = Math.min(engine.getDeltaTime() / 1000, 0.1);
  current?.runtime.update(deltaSeconds);
  current?.loaded.update(deltaSeconds);
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
runButton.addEventListener("click", () => void runSmokeCheck());
copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestReport);
  status.textContent = "VAT asset smoke report copied";
});

async function runSmokeCheck(): Promise<void> {
  runButton.disabled = true;
  copyButton.disabled = true;
  camera.detachControl();
  status.textContent = "Running VAT bake and deterministic asset round-trip…";
  const started = performance.now();
  const checkResults: CheckResult[] = [];
  try {
    disposeDisplayState();
    const assetRig = createRig("asset-source");
    const bakeStarted = performance.now();
    const asset = bakeBabylonVatAsset(assetRig.mesh, [assetRig.group], {
      sockets: createSocketAsset(31),
      bounds: {
        model: { min: [-0.9, -1.2, -0.7], max: [0.9, 1.2, 0.7] },
        clips: { Sway: { min: [-0.9, -1.2, -0.7], max: [0.9, 1.2, 0.7] } }
      },
      source: { name: "procedural-smoke-rig", generator: "vat-asset-smoke" }
    });
    const bakeMs = performance.now() - bakeStarted;
    const encoded = encodeBabylonVatAsset(asset);
    const encodedAgain = encodeBabylonVatAsset(asset);
    const decoded = decodeBabylonVatAsset(encoded.manifest, encoded.payload);
    addCheck(checkResults, "deterministic manifest and payload", encoded.manifest === encodedAgain.manifest && payloadsEqual(encoded, encodedAgain));
    addCheck(checkResults, "matrix atlas contains animated frames", containsAnimation(asset.frameData, asset.boneCount));
    addCheck(checkResults, "clip metadata survives round-trip", decoded.clips.Sway?.frameCount === 31 && decoded.clips.Sway.fps === 30);
    addCheck(checkResults, "animated bounds survive round-trip", decoded.bounds?.clips?.Sway?.max[1] === 1.2);
    addCheck(checkResults, "socket tracks survive round-trip", decoded.sockets?.sockets.weapon?.Sway?.rotations.length === 31 * 4);

    assetRig.group.dispose();
    assetRig.skeleton.dispose();
    assetRig.mesh.dispose();

    const runtimeRig = createRig("runtime-path");
    const loadedRig = createRig("asset-path");
    const runtime = createVatInstanceSet<{ label: string }>(engine, runtimeRig.mesh, [runtimeRig.group], {
      capacity: 2,
      grow: "double",
      colors: true,
      visibleStrategy: "active-count"
    });
    const rendersBeforeLoad = renderCalls;
    const loaded = createVatInstanceSetFromAsset<{ label: string }>(engine, loadedRig.mesh, decoded, {
      capacity: 2,
      grow: "double",
      colors: true,
      visibleStrategy: "active-count"
    });
    const loadRenderCalls = renderCalls - rendersBeforeLoad;
    current = { runtime, loaded, runtimeRig, loadedRig };
    addCheck(checkResults, "asset loading performs no animation resampling", loadRenderCalls === 0, `${loadRenderCalls} scene renders`);

    const runtimeIds: InstanceId[] = [];
    const loadedIds: InstanceId[] = [];
    for (let index = 0; index < 4; index++) createPair(index, runtimeIds, loadedIds);
    await waitFrames(2);
    for (let index = 4; index < 6; index++) createPair(index, runtimeIds, loadedIds);
    addCheck(checkResults, "instances work before and after rendered frames", runtime.count === 6 && loaded.count === 6);
    addCheck(checkResults, "capacity growth remains paired", runtime.capacity >= 8 && runtime.capacity === loaded.capacity);

    runtime.setVisible(runtimeIds[1]!, false);
    loaded.setVisible(loadedIds[1]!, false);
    const hiddenCountsMatch = runtime.visibleCount === 5 && loaded.visibleCount === 5;
    runtime.setVisible(runtimeIds[1]!, true);
    loaded.setVisible(loadedIds[1]!, true);
    addCheck(checkResults, "active-count hide/show remains paired", hiddenCountsMatch && runtime.visibleCount === loaded.visibleCount);

    runtime.update(0.375);
    loaded.update(0.375);
    addCheck(checkResults, "runtime and decoded playback samples match", pairedPlaybackMatches(runtime, loaded, runtimeIds, loadedIds));
    addCheck(checkResults, "colored slots match", arraysEqual(runtime.getColor(runtimeIds[3]!), loaded.getColor(loadedIds[3]!)));

    runtime.remove(runtimeIds[0]!);
    loaded.remove(loadedIds[0]!);
    const survivorRuntime = runtimeIds[5]!;
    const survivorLoaded = loadedIds[5]!;
    addCheck(checkResults, "removal keeps survivor state on stable IDs",
      runtime.getMetadata(survivorRuntime)?.label === loaded.getMetadata(survivorLoaded)?.label
      && runtime.getPlaybackSample(survivorRuntime)?.offsetSeconds === loaded.getPlaybackSample(survivorLoaded)?.offsetSeconds);
    addCheck(checkResults, "draw counts remain paired after compaction",
      runtimeRig.mesh.thinInstanceCount === loadedRig.mesh.thinInstanceCount
      && runtimeRig.mesh.thinInstanceCount === runtime.visibleCount);

    const disposalRig = createRig("disposal-path");
    const disposalSet = createVatInstanceSetFromAsset(engine, disposalRig.mesh, decoded, { capacity: 1 });
    disposalSet.create();
    disposalSet.dispose();
    addCheck(checkResults, "disposal detaches the VAT manager", disposalRig.mesh.bakedVertexAnimationManager === null);
    disposalRig.group.dispose();
    disposalRig.skeleton.dispose();
    disposalRig.mesh.dispose();

    const report = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        capabilities
      },
      asset: {
        encoding: decoded.encoding,
        boneCount: decoded.boneCount,
        frameCount: decoded.frameCount,
        texture: decoded.texture,
        clips: decoded.clips,
        sockets: Object.keys(decoded.sockets?.sockets ?? {}),
        manifestBytes: new TextEncoder().encode(encoded.manifest).byteLength,
        payloadBytes: encoded.payload.byteLength,
        integrity: decoded.integrity
      },
      timing: { bakeMs, totalMs: performance.now() - started, loadRenderCalls },
      checks: checkResults,
      passed: checkResults.every((check) => check.passed)
    };
    latestReport = JSON.stringify(report, null, 2);
    renderChecks(checkResults);
    assetInfo.textContent = [
      `${decoded.encoding} · ${decoded.boneCount} bones · ${decoded.frameCount} frames`,
      `${decoded.texture.width}×${decoded.texture.height} ${decoded.texture.format}`,
      `${(encoded.payload.byteLength / 1024).toFixed(2)} KiB payload · ${decoded.integrity}`,
      `bake ${bakeMs.toFixed(2)} ms · load renders ${loadRenderCalls}`
    ].join("\n");
    summary.textContent = report.passed
      ? "PASS · runtime-baked and encoded/decoded paths are stable"
      : "FAIL · inspect the failed checks and visual pair";
    status.textContent = report.passed
      ? "VAT asset smoke check complete · camera controls restored"
      : "VAT asset smoke check found a failure";
    copyButton.disabled = false;
  } catch (error) {
    summary.textContent = "Smoke check failed before completion.";
    status.textContent = `VAT asset smoke check failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    camera.attachControl(canvas, true);
    runButton.disabled = false;
  }
}

function createPair(index: number, runtimeIds: InstanceId[], loadedIds: InstanceId[]): void {
  if (!current) throw new Error("Display state is not initialized.");
  const row = Math.floor(index / 3);
  const column = index % 3;
  const common = { metadata: { label: `actor-${index}` }, clip: "Sway", offset: index * 0.11, fps: index % 2 === 0 ? 30 : 18 };
  const runtimeId = current.runtime.create({ ...common, transform: { position: [-6 + column * 2.1, row * 2.7, 0] } });
  const loadedId = current.loaded.create({ ...common, transform: { position: [1 + column * 2.1, row * 2.7, 0] } });
  const color: readonly [number, number, number, number] = [0.25 + column * 0.2, 0.55 + row * 0.18, 1 - column * 0.12, 1];
  current.runtime.setColor(runtimeId, color);
  current.loaded.setColor(loadedId, color);
  runtimeIds.push(runtimeId);
  loadedIds.push(loadedId);
}

function createRig(name: string): Rig {
  const mesh = MeshBuilder.CreateBox(name, { width: 0.75, height: 2, depth: 0.75 }, scene);
  mesh.material = material;
  const skeleton = new Skeleton(`${name}-skeleton`, `${name}-skeleton`, scene);
  const root = new Bone("root", skeleton, null, Matrix.Identity());
  const upper = new Bone("upper", skeleton, root, Matrix.Identity());
  mesh.skeleton = skeleton;
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const indices: number[] = [];
  const weights: number[] = [];
  for (let offset = 0; offset < positions.length; offset += 3) {
    indices.push((positions[offset + 1] ?? 0) > 0 ? 1 : 0, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, indices);
  mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights);
  skeleton.prepare();
  const animation = new Animation("sway", "rotationQuaternion", 30, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
  animation.setKeys([
    { frame: 0, value: Quaternion.Identity() },
    { frame: 10, value: Quaternion.RotationAxis(Vector3.Forward(), 0.5) },
    { frame: 20, value: Quaternion.RotationAxis(Vector3.Forward(), -0.5) },
    { frame: 30, value: Quaternion.Identity() }
  ]);
  upper.animations.push(animation);
  const group = new AnimationGroup("Sway", scene);
  group.addTargetedAnimation(animation, upper);
  return { mesh, skeleton, group };
}

function createSocketAsset(frameCount: number): VatSocketAsset {
  const translations = new Float32Array(frameCount * 3);
  const rotations = new Float32Array(frameCount * 4);
  for (let frame = 0; frame < frameCount; frame++) rotations[frame * 4 + 3] = 1;
  return {
    version: 1,
    space: "gltf-rh-model-world",
    basis: new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    clips: { Sway: { name: "Sway", fps: 30, frameCount, durationSeconds: frameCount / 30 } },
    sockets: { weapon: { Sway: { translations, rotations } } }
  };
}

function pairedPlaybackMatches(
  runtime: VatInstanceSet,
  loaded: VatInstanceSet,
  runtimeIds: InstanceId[],
  loadedIds: InstanceId[]
): boolean {
  return runtimeIds.every((runtimeId, index) => {
    if (!runtime.has(runtimeId)) return true;
    const left = runtime.getPlaybackSample(runtimeId);
    const right = loaded.getPlaybackSample(loadedIds[index]!);
    return left?.clip === right?.clip && left?.fps === right?.fps && left?.offsetSeconds === right?.offsetSeconds
      && left?.frame === right?.frame && left?.nextFrame === right?.nextFrame && Math.abs((left?.alpha ?? 0) - (right?.alpha ?? 0)) < 1e-6;
  });
}

function containsAnimation(data: Float32Array, boneCount: number): boolean {
  const stride = (boneCount + 1) * 16;
  for (let index = 0; index < stride; index++) if (Math.abs((data[index] ?? 0) - (data[stride + index] ?? 0)) > 1e-6) return true;
  return false;
}

function payloadsEqual(left: EncodedBabylonVatAsset, right: EncodedBabylonVatAsset): boolean {
  return arraysEqual(new Uint8Array(left.payload), new Uint8Array(right.payload));
}

function arraysEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function addCheck(results: CheckResult[], label: string, passed: boolean, detail?: string): void {
  results.push({ label, passed, ...(detail ? { detail } : {}) });
}

function renderChecks(results: CheckResult[]): void {
  checksElement.replaceChildren(...results.map((check) => {
    const item = document.createElement("li");
    item.className = check.passed ? "pass" : "fail";
    item.textContent = `${check.passed ? "✓" : "✕"} ${check.label}${check.detail ? ` · ${check.detail}` : ""}`;
    return item;
  }));
}

function disposeDisplayState(): void {
  if (!current) return;
  current.runtime.dispose();
  current.loaded.dispose();
  for (const rig of [current.runtimeRig, current.loadedRig]) {
    rig.group.dispose();
    rig.skeleton.dispose();
    rig.mesh.dispose();
  }
  current = undefined;
}

async function createEngine(target: HTMLCanvasElement): Promise<AbstractEngine> {
  const requested = new URLSearchParams(location.search).get("backend");
  if (requested === "webgpu" && await WebGPUEngine.IsSupportedAsync) {
    const webgpu = new WebGPUEngine(target, { antialias: true });
    await webgpu.initAsync();
    return webgpu;
  }
  return new Engine(target, true, { preserveDrawingBuffer: true, stencil: true });
}

function nextFrame(): Promise<number> { return new Promise((resolve) => requestAnimationFrame(resolve)); }
async function waitFrames(count: number): Promise<void> { for (let index = 0; index < count; index++) await nextFrame(); }
