import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createInstanceSet, type InstanceId } from "@litools/instancer-babylonjs";

interface BenchmarkCase {
  population: number;
  boundsMode: "auto" | "fixed";
  samples: number;
  edits: number;
  frameP50Ms: number;
  frameP95Ms: number;
  updateP50Ms: number;
  updateP95Ms: number;
  uploadCalls: number;
  uploadBytes: number;
  boundsRefreshCalls: number;
  boundsRefreshMs: number;
}

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const status = document.querySelector<HTMLElement>("#benchmarkStatus")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
const checks = document.querySelector<HTMLUListElement>("#checks")!;
const results = document.querySelector<HTMLElement>("#results")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy")!;

const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.015, 0.025, 0.045, 1);
const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.05, 54, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0.3, 1, -0.2), scene);
const source = MeshBuilder.CreateBox("benchmark-box", { size: 0.55 }, scene);
const material = new StandardMaterial("benchmark-material", scene);
material.diffuseColor = Color3.White();
source.material = material;
let set = createInstanceSet(source, { capacity: 64, grow: "double", colors: true, visibleStrategy: "active-count" });

let uploadCalls = 0;
let uploadBytes = 0;
let boundsRefreshCalls = 0;
let boundsRefreshMs = 0;
const originalPartialUpdate = source.thinInstancePartialBufferUpdate.bind(source);
source.thinInstancePartialBufferUpdate = (kind, dataOrLength, offset): void => {
  const stride = kind === "matrix" ? 16 : 4;
  uploadCalls++;
  uploadBytes += typeof dataOrLength === "number" ? dataOrLength * stride * 4 : dataOrLength.byteLength;
  originalPartialUpdate(kind, dataOrLength, offset);
};
const originalBoundsRefresh = source.thinInstanceRefreshBoundingInfo.bind(source);
source.thinInstanceRefreshBoundingInfo = (...args): void => {
  const start = performance.now();
  try {
    originalBoundsRefresh(...args);
  } finally {
    boundsRefreshCalls++;
    boundsRefreshMs += performance.now() - start;
  }
};

const beforeFrame = set.create({ position: [-1, 0, 0] });
set.setColor(beforeFrame, [0.2, 0.75, 1, 1]);
engine.runRenderLoop(() => scene.render());
await nextFrame();
const afterFrame = set.create({ position: [1, 0, 0] });
set.setColor(afterFrame, [1, 0.55, 0.2, 1]);
runLifecycleChecks(beforeFrame, afterFrame);

let latestReport = "";
runButton.addEventListener("click", () => void runBenchmark());
copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestReport);
  status.textContent = "Benchmark report copied";
});
window.addEventListener("resize", () => engine.resize());

async function runBenchmark(): Promise<void> {
  runButton.disabled = true;
  copyButton.disabled = true;
  camera.detachControl();
  const cases: BenchmarkCase[] = [];
  try {
    for (const population of [100, 500, 1000, 1500]) {
      for (const boundsMode of ["auto", "fixed"] as const) {
        status.textContent = `Benchmarking ${population.toLocaleString()} instances · ${boundsMode} bounds…`;
        cases.push(await runCase(population, boundsMode));
        await waitFrames(3);
      }
    }
    const report = {
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        renderer: "Babylon.js WebGL",
        devicePixelRatio: window.devicePixelRatio
      },
      cases
    };
    latestReport = JSON.stringify(report, null, 2);
    renderCases(cases);
    summary.textContent = "Complete · automatic versus fixed-bounds report ready";
    status.textContent = "Benchmark complete · camera controls restored";
    copyButton.disabled = false;
  } catch (error) {
    status.textContent = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    camera.attachControl(canvas, true);
    runButton.disabled = false;
  }
}

async function runCase(population: number, boundsMode: "auto" | "fixed"): Promise<BenchmarkCase> {
  set.dispose();
  set = createInstanceSet(source, {
    capacity: population,
    grow: "double",
    colors: true,
    visibleStrategy: "active-count",
    boundsMode,
    ...(boundsMode === "fixed"
      ? { fixedBounds: { minimum: [-20, -14, -2] as const, maximum: [20, 18, 2] as const } }
      : {})
  });
  const inputs = Array.from({ length: population }, (_, index) => ({ transform: { position: gridPosition(index) } }));
  const ids = set.createMany(inputs);
  set.batch((writer) => {
    for (let index = 0; index < ids.length; index++) {
      const hue = (index % 17) / 17;
      writer.setColor?.(ids[index]!, [0.25 + hue * 0.65, 0.75 - hue * 0.35, 0.9, 1]);
    }
  });
  await waitFrames(6);
  uploadCalls = 0;
  uploadBytes = 0;
  boundsRefreshCalls = 0;
  boundsRefreshMs = 0;
  const frameTimes: number[] = [];
  const updateTimes: number[] = [];
  const samples = 12;
  const editsPerSample = Math.max(10, Math.ceil(population * 0.1));
  let previousFrame = performance.now();
  const position = new Float32Array(3);
  for (let sample = 0; sample < samples; sample++) {
    const updateStart = performance.now();
    set.batch((writer) => {
      for (let edit = 0; edit < editsPerSample; edit++) {
        const index = (sample * editsPerSample + edit) % population;
        const id = ids[index]!;
        set.getPosition(id, position);
        writer.setPosition(id, [position[0]!, position[1]! + (sample % 2 === 0 ? 0.015 : -0.015), position[2]!]);
      }
    });
    updateTimes.push(performance.now() - updateStart);
    const frame = await nextFrame();
    frameTimes.push(frame - previousFrame);
    previousFrame = frame;
  }
  return {
    population,
    boundsMode,
    samples,
    edits: samples * editsPerSample,
    frameP50Ms: percentile(frameTimes, 0.5),
    frameP95Ms: percentile(frameTimes, 0.95),
    updateP50Ms: percentile(updateTimes, 0.5),
    updateP95Ms: percentile(updateTimes, 0.95),
    uploadCalls,
    uploadBytes,
    boundsRefreshCalls,
    boundsRefreshMs
  };
}

function runLifecycleChecks(beforeFrame: InstanceId, afterFrame: InstanceId): void {
  const entries: Array<[string, boolean]> = [];
  entries.push(["create before first frame", set.has(beforeFrame)]);
  entries.push(["create after first frame", set.has(afterFrame)]);
  set.setVisible(beforeFrame, false);
  const hidden = !set.getVisible(beforeFrame) && set.visibleCount === 1;
  set.setVisible(beforeFrame, true);
  entries.push(["active-count hide/show", hidden && set.getVisible(beforeFrame)]);
  const bulk = set.createMany(Array.from({ length: 70 }, (_, index) => ({ transform: { position: gridPosition(index) } })));
  entries.push(["capacity growth", set.capacity >= 72]);
  entries.push(["bulk create/remove", set.removeMany(bulk) === bulk.length]);
  entries.push(["colored slots", Array.from(set.getColor(afterFrame)).some((value) => value !== 1)]);
  checks.replaceChildren(...entries.map(([label, passed]) => {
    const item = document.createElement("li");
    item.className = passed ? "pass" : "fail";
    item.textContent = `${passed ? "✓" : "✗"} ${label}`;
    return item;
  }));
}

function gridPosition(index: number): [number, number, number] {
  const width = 40;
  return [(index % width) * 0.72 - 14, Math.floor(index / width) * 0.72 - 12, 0];
}
function nextFrame(): Promise<number> { return new Promise((resolve) => requestAnimationFrame(resolve)); }
async function waitFrames(count: number): Promise<void> { for (let index = 0; index < count; index++) await nextFrame(); }
function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}
function renderCases(cases: BenchmarkCase[]): void {
  results.replaceChildren(...cases.map((item) => {
    const element = document.createElement("div");
    element.className = "case";
    element.innerHTML = `<strong>${item.population.toLocaleString()} · ${item.boundsMode}</strong><br>F ${item.frameP50Ms.toFixed(2)}/${item.frameP95Ms.toFixed(2)} ms · U ${item.updateP50Ms.toFixed(3)}/${item.updateP95Ms.toFixed(3)} ms<br>${item.edits} edits · ${item.uploadCalls} uploads · ${(item.uploadBytes / 1048576).toFixed(2)} MiB<br>B ${item.boundsRefreshCalls} calls · ${item.boundsRefreshMs.toFixed(3)} ms total`;
    return element;
  }));
}
