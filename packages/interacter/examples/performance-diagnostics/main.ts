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
  type StandardMaterialProps
} from "@babylonjs/lite";
import {
  createInteractionManager,
  getInteractionDiagnostics,
  onInteractionEvent,
  registerMesh,
  type InteractionDiagnostics
} from "@litools/interacter";
import "../shared/styles.css";

const MESH_COUNTS = [80, 200, 500] as const;
const BENCHMARK_WARMUP_MS = 2_000;
const BENCHMARK_ROUND_MS = 5_000;
const BENCHMARK_ROUND_COUNT = 3;
const BENCHMARK_SAMPLE_RATE_HZ = 30;
const BENCHMARK_CLICK_EVERY_MOVES = 4;
const BENCHMARK_POINTER_ID = 9001;
const parameters = new URLSearchParams(location.search);
const requestedMeshCount = Number(parameters.get("meshes"));
const meshCount = MESH_COUNTS.includes(requestedMeshCount as (typeof MESH_COUNTS)[number])
  ? requestedMeshCount
  : 200;
const detailed = parameters.get("detail") === "detailed";
const hoverEnabled = parameters.get("hover") !== "off";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const canvas = document.createElement("canvas");
app.append(canvas);

const controlsPanel = document.createElement("section");
controlsPanel.className = "panel";
controlsPanel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Performance diagnostics</h1>
  <p>Move rapidly across the grid and click repeatedly. Change one setting at a time to compare scheduler and picker cost.</p>
  <div class="control-grid">
    <label for="mesh-count">Meshes</label>
    <select id="mesh-count">
      ${MESH_COUNTS.map((count) => `<option value="${count}"${count === meshCount ? " selected" : ""}>${count}</option>`).join("")}
    </select>
    <label for="pick-detail">Picker</label>
    <select id="pick-detail">
      <option value="basic"${detailed ? "" : " selected"}>Basic</option>
      <option value="detailed"${detailed ? " selected" : ""}>Detailed</option>
    </select>
    <label for="hover-workload">Hover workload</label>
    <select id="hover-workload">
      <option value="on"${hoverEnabled ? " selected" : ""}>Enabled</option>
      <option value="off"${hoverEnabled ? "" : " selected"}>Disabled</option>
    </select>
  </div>
  <div class="controls">
    <button type="button" class="run-benchmark">Run benchmark suite</button>
    <button type="button" class="reset-sample">Reset sample</button>
  </div>
  <div>Status: <strong class="status">initializing</strong></div>
  <div>Benchmark: <strong class="benchmark-status">not run</strong></div>
  <div>Configuration: <strong>${meshCount} / ${detailed ? "detailed" : "basic"} / hover ${hoverEnabled ? "on" : "off"}</strong></div>
  <p class="diagnostics-note">Changing a selector reloads the scene so each run starts with a fresh manager and fresh lifetime counters.</p>
`;
document.body.append(controlsPanel);

const diagnosticsPanel = document.createElement("section");
diagnosticsPanel.className = "panel diagnostics-panel";
diagnosticsPanel.innerHTML = `
  <h2>Live diagnostics</h2>
  <p>Counters and throughput since the last sample reset.</p>
  <div class="diagnostics-grid">
    <span>Sample time</span><strong class="sample-time">0.0 s</strong>
    <span>In flight</span><strong class="in-flight">none</strong>
    <span>Queued discrete</span><strong class="queued-discrete">0</strong>
    <span>Queued hover</span><strong class="queued-hover">0</strong>
    <span>Peak queued</span><strong class="peak-queued">0</strong>
    <span>Completed picks</span><strong class="completed">0</strong>
    <span>Failed picks</span><strong class="failed">0</strong>
    <span>Pick throughput</span><strong class="pick-rate">0 /s</strong>
    <span>Event throughput</span><strong class="event-rate">0 /s</strong>
    <span>Coalesced hover</span><strong class="coalesced-hover">0</strong>
    <span>Scheduler wait</span><strong class="scheduler-wait">—</strong>
    <span>Last pick</span><strong class="last-pick">—</strong>
    <span>Lifetime average pick</span><strong class="average-pick">—</strong>
    <span>Lifetime maximum pick</span><strong class="maximum-pick">—</strong>
  </div>
  <div class="controls report-controls">
    <button type="button" class="copy-report">Copy JSON report</button>
    <span class="copy-status" role="status" aria-live="polite"></span>
  </div>
  <p class="diagnostics-note">Scheduler wait is enqueue-to-start. Pick duration excludes event listeners and rendering. Last, average, and maximum timing values come directly from the manager and remain lifetime statistics after a local sample reset.</p>
`;
document.body.append(diagnosticsPanel);

for (const overlay of [controlsPanel, diagnosticsPanel]) {
  for (const type of ["pointerdown", "pointerup", "contextmenu"] as const) {
    overlay.addEventListener(type, (event) => event.stopPropagation());
  }
}

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
const columns = Math.ceil(Math.sqrt(meshCount * 1.5));
const rows = Math.ceil(meshCount / columns);
const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 3.2, Math.max(columns, rows) * 1.25, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
addToScene(scene, createHemisphericLight([0, 1, 0], 1.35));
attachControl(camera, canvas, scene);

const manager = createInteractionManager({
  scene,
  canvas,
  hover: hoverEnabled,
  detailedPicking: {
    discrete: detailed,
    drag: false,
    hover: detailed
  },
  onError(error) {
    controlsPanel.querySelector<HTMLElement>(".status")!.textContent = `error: ${String(error)}`;
  }
});

for (let index = 0; index < meshCount; index += 1) {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const mesh = createBox(engine, 0.72);
  mesh.name = `diagnostic-tile-${index + 1}`;
  mesh.position.x = column - (columns - 1) / 2;
  mesh.position.z = row - (rows - 1) / 2;
  mesh.position.y = 0.14 + ((index * 17) % 7) * 0.045;
  const material: StandardMaterialProps = createStandardMaterial();
  material.diffuseColor = [
    0.2 + column / columns * 0.5,
    0.34 + row / rows * 0.42,
    0.82 - row / rows * 0.3
  ];
  material.specularColor = [0.06, 0.06, 0.06];
  mesh.material = material;
  addToScene(scene, mesh);
  registerMesh(manager, mesh);
}

let eventsThisInterval = 0;
let eventRate = 0;
let activeBenchmarkRound: BenchmarkRoundResult | null = null;
for (const type of ["pointerdown", "pointerup", "click", "hoverstart", "hovermove", "hoverend"] as const) {
  onInteractionEvent(manager, type, (event) => {
    eventsThisInterval += 1;
    if (!activeBenchmarkRound) return;
    if (type === "pointerdown" || type === "pointerup") {
      activeBenchmarkRound.resolvedDiscreteHits += 1;
      if (event.pickDetailsStatus === "available") activeBenchmarkRound.detailedResultsAvailable += 1;
    } else if (type === "hoverstart" || type === "hovermove") {
      activeBenchmarkRound.resolvedHoverHits += 1;
      if (event.pickDetailsStatus === "available") activeBenchmarkRound.detailedResultsAvailable += 1;
    }
  });
}

const fields = {
  sampleTime: diagnosticsPanel.querySelector<HTMLElement>(".sample-time")!,
  inFlight: diagnosticsPanel.querySelector<HTMLElement>(".in-flight")!,
  queuedDiscrete: diagnosticsPanel.querySelector<HTMLElement>(".queued-discrete")!,
  queuedHover: diagnosticsPanel.querySelector<HTMLElement>(".queued-hover")!,
  peakQueued: diagnosticsPanel.querySelector<HTMLElement>(".peak-queued")!,
  completed: diagnosticsPanel.querySelector<HTMLElement>(".completed")!,
  failed: diagnosticsPanel.querySelector<HTMLElement>(".failed")!,
  pickRate: diagnosticsPanel.querySelector<HTMLElement>(".pick-rate")!,
  eventRate: diagnosticsPanel.querySelector<HTMLElement>(".event-rate")!,
  coalescedHover: diagnosticsPanel.querySelector<HTMLElement>(".coalesced-hover")!,
  schedulerWait: diagnosticsPanel.querySelector<HTMLElement>(".scheduler-wait")!,
  lastPick: diagnosticsPanel.querySelector<HTMLElement>(".last-pick")!,
  averagePick: diagnosticsPanel.querySelector<HTMLElement>(".average-pick")!,
  maximumPick: diagnosticsPanel.querySelector<HTMLElement>(".maximum-pick")!
};

let baseline = getInteractionDiagnostics(manager);
let sampleStartedAt = performance.now();
let previousCompleted = baseline.completedPicks;
let pickRate = 0;
let peakQueued = 0;
let benchmarkRunning = false;
let lastBenchmark: BenchmarkResult | null = null;

const runBenchmarkButton = controlsPanel.querySelector<HTMLButtonElement>(".run-benchmark")!;
const resetSampleButton = controlsPanel.querySelector<HTMLButtonElement>(".reset-sample")!;
const benchmarkStatus = controlsPanel.querySelector<HTMLElement>(".benchmark-status")!;
runBenchmarkButton.addEventListener("click", () => void runBenchmark());
resetSampleButton.addEventListener("click", resetSample);
diagnosticsPanel.querySelector<HTMLButtonElement>(".copy-report")!.addEventListener("click", copyJsonReport);
controlsPanel.querySelector<HTMLSelectElement>("#mesh-count")!.addEventListener("change", (event) => {
  reloadWith("meshes", (event.currentTarget as HTMLSelectElement).value);
});
controlsPanel.querySelector<HTMLSelectElement>("#pick-detail")!.addEventListener("change", (event) => {
  reloadWith("detail", (event.currentTarget as HTMLSelectElement).value);
});
controlsPanel.querySelector<HTMLSelectElement>("#hover-workload")!.addEventListener("change", (event) => {
  reloadWith("hover", (event.currentTarget as HTMLSelectElement).value);
});

window.setInterval(() => {
  const current = getInteractionDiagnostics(manager);
  pickRate = current.completedPicks - previousCompleted;
  previousCompleted = current.completedPicks;
  eventRate = eventsThisInterval;
  eventsThisInterval = 0;
}, 1000);

await registerScene(scene);
controlsPanel.querySelector<HTMLElement>(".status")!.textContent = "running";
refreshDiagnostics();
await startEngine(engine);

function resetSample(): void {
  if (benchmarkRunning) return;
  resetSampleBaseline();
}

function resetSampleBaseline(): void {
  baseline = getInteractionDiagnostics(manager);
  sampleStartedAt = performance.now();
  previousCompleted = baseline.completedPicks;
  pickRate = 0;
  eventRate = 0;
  eventsThisInterval = 0;
  peakQueued = 0;
}

async function runBenchmark(): Promise<void> {
  if (benchmarkRunning) return;
  benchmarkRunning = true;
  runBenchmarkButton.disabled = true;
  resetSampleButton.disabled = true;
  const startedAt = performance.now();
  lastBenchmark = {
    workloadVersion: 2,
    configuration: {
      meshCount,
      picker: detailed ? "detailed" : "basic",
      hover: hoverEnabled
    },
    status: "warming-up",
    warmup: null,
    roundCount: BENCHMARK_ROUND_COUNT,
    roundDurationMs: BENCHMARK_ROUND_MS,
    sampleRateHz: BENCHMARK_SAMPLE_RATE_HZ,
    clickEveryPointerMoves: BENCHMARK_CLICK_EVERY_MOVES,
    rounds: [],
    median: null,
    totalDurationMs: null
  };
  benchmarkStatus.textContent = "warming up";

  try {
    const warmupStartedAt = performance.now();
    const warmupInjection = await injectBenchmarkInput(BENCHMARK_WARMUP_MS, "warm-up");
    const warmupInjectionEndedAt = performance.now();
    benchmarkStatus.textContent = "draining warm-up";
    await waitForSchedulerIdle();
    const warmupCompletedAt = performance.now();
    lastBenchmark.warmup = {
      requestedDurationMs: BENCHMARK_WARMUP_MS,
      ...warmupInjection,
      settlingDurationMs: warmupCompletedAt - warmupInjectionEndedAt,
      totalDurationMs: warmupCompletedAt - warmupStartedAt
    };

    resetSampleBaseline();
    lastBenchmark.status = "measuring";
    for (let roundIndex = 1; roundIndex <= BENCHMARK_ROUND_COUNT; roundIndex += 1) {
      const roundBaseline = getInteractionDiagnostics(manager);
      const round: BenchmarkRoundResult = {
        round: roundIndex,
        requestedDurationMs: BENCHMARK_ROUND_MS,
        requestedPointerMoves: moveCountForDuration(BENCHMARK_ROUND_MS),
        dispatchedPointerMoves: 0,
        dispatchedClickCycles: 0,
        injectionDurationMs: 0,
        settlingDurationMs: 0,
        totalDurationMs: 0,
        completedPicks: 0,
        failedPicks: 0,
        coalescedHoverSamples: 0,
        averagePickDurationMs: null,
        throughputPicksPerSecond: 0,
        peakQueued: 0,
        resolvedDiscreteHits: 0,
        resolvedHoverHits: 0,
        detailedResultsAvailable: 0
      };
      activeBenchmarkRound = round;
      const roundStartedAt = performance.now();
      const injection = await injectBenchmarkInput(BENCHMARK_ROUND_MS, `round ${roundIndex}`);
      round.dispatchedPointerMoves = injection.dispatchedPointerMoves;
      round.dispatchedClickCycles = injection.dispatchedClickCycles;
      round.injectionDurationMs = injection.injectionDurationMs;
      const injectionEndedAt = performance.now();
      benchmarkStatus.textContent = `round ${roundIndex}/${BENCHMARK_ROUND_COUNT}: draining`;
      await waitForSchedulerIdle();
      const roundCompletedAt = performance.now();
      const endingDiagnostics = getInteractionDiagnostics(manager);
      round.settlingDurationMs = roundCompletedAt - injectionEndedAt;
      round.totalDurationMs = roundCompletedAt - roundStartedAt;
      round.completedPicks = endingDiagnostics.completedPicks - roundBaseline.completedPicks;
      round.failedPicks = endingDiagnostics.failedPicks - roundBaseline.failedPicks;
      round.coalescedHoverSamples = endingDiagnostics.coalescedHoverSamples - roundBaseline.coalescedHoverSamples;
      round.averagePickDurationMs = averagePickDurationBetween(roundBaseline, endingDiagnostics);
      round.throughputPicksPerSecond = round.completedPicks / (round.totalDurationMs / 1000);
      activeBenchmarkRound = null;
      lastBenchmark.rounds.push(round);
    }

    lastBenchmark.median = summarizeRounds(lastBenchmark.rounds);
    lastBenchmark.totalDurationMs = performance.now() - startedAt;
    lastBenchmark.status = "complete";
    benchmarkStatus.textContent = `complete in ${(lastBenchmark.totalDurationMs / 1000).toFixed(2)} s`;
  } catch (error) {
    activeBenchmarkRound = null;
    if (lastBenchmark) lastBenchmark.status = "failed";
    benchmarkStatus.textContent = "failed";
    controlsPanel.querySelector<HTMLElement>(".status")!.textContent = `benchmark error: ${String(error)}`;
  } finally {
    benchmarkRunning = false;
    runBenchmarkButton.disabled = false;
    resetSampleButton.disabled = false;
  }
}

async function injectBenchmarkInput(durationMs: number, phaseLabel: string): Promise<BenchmarkInjection> {
  const startedAt = performance.now();
  const moveCount = moveCountForDuration(durationMs);
  const intervalMs = 1000 / BENCHMARK_SAMPLE_RATE_HZ;
  let dispatchedClickCycles = 0;
  for (let index = 0; index < moveCount; index += 1) {
    const scheduledAt = startedAt + index * intervalMs;
    const delayMs = scheduledAt - performance.now();
    if (delayMs > 0) await delay(delayMs);
    const point = benchmarkPoint(index, moveCount);
    dispatchPointer("pointermove", point.x, point.y, -1, 0);
    if (index % BENCHMARK_CLICK_EVERY_MOVES === 0) {
      dispatchPointer("pointerdown", point.x, point.y, 0, 1);
      dispatchPointer("pointerup", point.x, point.y, 0, 0);
      dispatchedClickCycles += 1;
    }
    benchmarkStatus.textContent = `${phaseLabel} ${Math.round((index + 1) / moveCount * 100)}%`;
  }
  const remainingMs = startedAt + durationMs - performance.now();
  if (remainingMs > 0) await delay(remainingMs);
  return {
    requestedPointerMoves: moveCount,
    dispatchedPointerMoves: moveCount,
    dispatchedClickCycles,
    injectionDurationMs: performance.now() - startedAt
  };
}

function moveCountForDuration(durationMs: number): number {
  return durationMs / 1000 * BENCHMARK_SAMPLE_RATE_HZ;
}

function benchmarkPoint(index: number, moveCount: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const phase = index / moveCount * Math.PI * 2;
  return {
    x: rect.left + rect.width * (0.5 + Math.sin(phase * 3) * 0.22),
    y: rect.top + rect.height * (0.54 + Math.sin(phase * 2 + Math.PI / 3) * 0.24)
  };
}

function dispatchPointer(
  type: "pointermove" | "pointerdown" | "pointerup",
  clientX: number,
  clientY: number,
  button: number,
  buttons: number
): void {
  canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    pointerId: BENCHMARK_POINTER_ID,
    pointerType: "mouse",
    isPrimary: true,
    clientX,
    clientY,
    button,
    buttons
  }));
}

async function waitForSchedulerIdle(): Promise<void> {
  while (true) {
    const current = getInteractionDiagnostics(manager);
    if (
      current.inFlightKind === null
      && current.queuedDiscrete === 0
      && current.queuedDrag === 0
      && current.queuedHover === 0
    ) return;
    await nextAnimationFrame();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function averagePickDurationBetween(
  start: InteractionDiagnostics,
  current: InteractionDiagnostics
): number | null {
  const baselineSettled = start.completedPicks + start.failedPicks;
  const currentSettled = current.completedPicks + current.failedPicks;
  const sampleSettled = currentSettled - baselineSettled;
  if (sampleSettled === 0 || current.averagePickDurationMs === null) return null;
  const currentTotal = current.averagePickDurationMs * currentSettled;
  const baselineTotal = (start.averagePickDurationMs ?? 0) * baselineSettled;
  return (currentTotal - baselineTotal) / sampleSettled;
}

function summarizeRounds(rounds: readonly BenchmarkRoundResult[]): BenchmarkMedian {
  return {
    completedPicks: median(rounds.map((round) => round.completedPicks)),
    failedPicks: median(rounds.map((round) => round.failedPicks)),
    coalescedHoverSamples: median(rounds.map((round) => round.coalescedHoverSamples)),
    averagePickDurationMs: median(rounds.map((round) => round.averagePickDurationMs ?? 0)),
    throughputPicksPerSecond: median(rounds.map((round) => round.throughputPicksPerSecond)),
    settlingDurationMs: median(rounds.map((round) => round.settlingDurationMs)),
    peakQueued: median(rounds.map((round) => round.peakQueued)),
    resolvedDiscreteHits: median(rounds.map((round) => round.resolvedDiscreteHits)),
    resolvedHoverHits: median(rounds.map((round) => round.resolvedHoverHits)),
    detailedResultsAvailable: median(rounds.map((round) => round.detailedResultsAvailable))
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function copyJsonReport(): Promise<void> {
  const copyStatus = diagnosticsPanel.querySelector<HTMLElement>(".copy-status")!;
  if (!lastBenchmark) {
    copyStatus.textContent = "Run benchmark first";
    window.setTimeout(() => {
      copyStatus.textContent = "";
    }, 2000);
    return;
  }
  const json = JSON.stringify(lastBenchmark, null, 2);
  try {
    await writeClipboardText(json);
    copyStatus.textContent = "Copied";
  } catch (error) {
    copyStatus.textContent = "Copy failed";
    controlsPanel.querySelector<HTMLElement>(".status")!.textContent = `copy error: ${String(error)}`;
  }
  window.setTimeout(() => {
    copyStatus.textContent = "";
  }, 2000);
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function refreshDiagnostics(): void {
  const current = getInteractionDiagnostics(manager);
  const queued = current.queuedDiscrete + current.queuedDrag + current.queuedHover;
  peakQueued = Math.max(peakQueued, queued);
  if (activeBenchmarkRound) {
    activeBenchmarkRound.peakQueued = Math.max(activeBenchmarkRound.peakQueued, queued);
  }
  fields.sampleTime.textContent = `${((performance.now() - sampleStartedAt) / 1000).toFixed(1)} s`;
  fields.inFlight.textContent = current.inFlightKind ?? "none";
  fields.queuedDiscrete.textContent = String(current.queuedDiscrete);
  fields.queuedHover.textContent = String(current.queuedHover);
  fields.peakQueued.textContent = String(peakQueued);
  fields.completed.textContent = String(current.completedPicks - baseline.completedPicks);
  fields.failed.textContent = String(current.failedPicks - baseline.failedPicks);
  fields.pickRate.textContent = `${pickRate} /s`;
  fields.eventRate.textContent = `${eventRate} /s`;
  fields.coalescedHover.textContent = String(current.coalescedHoverSamples - baseline.coalescedHoverSamples);
  fields.schedulerWait.textContent = milliseconds(current.lastSchedulerWaitMs);
  fields.lastPick.textContent = milliseconds(current.lastPickDurationMs);
  fields.averagePick.textContent = milliseconds(current.averagePickDurationMs);
  fields.maximumPick.textContent = milliseconds(current.maximumPickDurationMs);
  requestAnimationFrame(refreshDiagnostics);
}

function milliseconds(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} ms`;
}

function reloadWith(name: string, value: string): void {
  const next = new URL(location.href);
  next.searchParams.set(name, value);
  location.assign(next);
}

interface BenchmarkResult {
  workloadVersion: 2;
  configuration: {
    meshCount: number;
    picker: "basic" | "detailed";
    hover: boolean;
  };
  status: "warming-up" | "measuring" | "complete" | "failed";
  warmup: BenchmarkWarmup | null;
  roundCount: number;
  roundDurationMs: number;
  sampleRateHz: number;
  clickEveryPointerMoves: number;
  rounds: BenchmarkRoundResult[];
  median: BenchmarkMedian | null;
  totalDurationMs: number | null;
}

interface BenchmarkInjection {
  requestedPointerMoves: number;
  dispatchedPointerMoves: number;
  dispatchedClickCycles: number;
  injectionDurationMs: number;
}

interface BenchmarkWarmup extends BenchmarkInjection {
  requestedDurationMs: number;
  settlingDurationMs: number;
  totalDurationMs: number;
}

interface BenchmarkRoundResult extends BenchmarkInjection {
  round: number;
  requestedDurationMs: number;
  settlingDurationMs: number;
  totalDurationMs: number;
  completedPicks: number;
  failedPicks: number;
  coalescedHoverSamples: number;
  averagePickDurationMs: number | null;
  throughputPicksPerSecond: number;
  peakQueued: number;
  resolvedDiscreteHits: number;
  resolvedHoverHits: number;
  detailedResultsAvailable: number;
}

interface BenchmarkMedian {
  completedPicks: number;
  failedPicks: number;
  coalescedHoverSamples: number;
  averagePickDurationMs: number;
  throughputPicksPerSecond: number;
  settlingDurationMs: number;
  peakQueued: number;
  resolvedDiscreteHits: number;
  resolvedHoverHits: number;
  detailedResultsAvailable: number;
}
