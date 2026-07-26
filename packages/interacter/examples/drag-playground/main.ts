import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createCylinder,
  createEngine,
  createGround,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  registerScene,
  startEngine,
  vec3,
  type Mesh,
  type StandardMaterialProps
} from "@babylonjs/lite";
import { createThinInstanceOutliner } from "../../../../src/outline.js";
import {
  createInteractionManager,
  getActivePointers,
  getInteractionDiagnostics,
  isInteractionEnabled,
  onInteractionEvent,
  registerMesh,
  setInteractionEnabled,
  type InteractionEvent
} from "@litools/interacter";
import "../shared/styles.css";

interface StartPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface DragOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface SurfaceExtents {
  readonly halfWidth: number;
  readonly floorY: number;
  readonly wallDepth: number;
}

const FLOOR_WIDTH = 12;
const FLOOR_DEPTH = 9;
const WALL_WIDTH = 12;
const WALL_HEIGHT = 5.5;
const WALL_Z = FLOOR_DEPTH / 2;
const FLOOR_OUTLINE_COLOR = [0.2, 0.82, 1] as const;
const WALL_OUTLINE_COLOR = [1, 0.12, 0.1] as const;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const canvas = document.createElement("canvas");
app.append(canvas);
const dragDetailsEnabled = new URL(window.location.href).searchParams.get("dragDetails") === "1";

const panel = document.createElement("section");
panel.className = "panel drag-panel";
panel.innerHTML = `
  <a class="home" href="../">← Interaction examples</a>
  <h1>Drag playground</h1>
  <p>Drag colored objects across the floor or onto the vertical wall. Both surfaces are unregistered; <code>pickedMesh</code> selects the active movement plane.</p>
  <div class="controls">
    <button type="button" class="toggle">Disable interaction</button>
    <button type="button" class="details">Drag details: ${dragDetailsEnabled ? "on" : "off"}</button>
    <button type="button" class="snap">Grid snap: off</button>
    <button type="button" class="reset">Reset positions</button>
    <button type="button" class="clear">Clear log</button>
  </div>
  <div class="drag-stats">
    <span>Status: <strong class="status">initializing</strong></span>
    <span>Active pointers: <strong class="pointers">0</strong></span>
    <span>Drag events: <strong class="drag-count">0</strong></span>
    <span>Surface: <strong class="surface-status">-</strong></span>
    <span>Last surface detail: <strong class="detail-status">-</strong></span>
  </div>
  <pre class="log" aria-live="polite">Press and move a colored object.</pre>
`;
document.body.append(panel);
const diagnosticsPanel = document.createElement("section");
diagnosticsPanel.className = "panel diagnostics-panel";
diagnosticsPanel.setAttribute("aria-label", "Interaction diagnostics");
diagnosticsPanel.innerHTML = `
  <h2>Interaction diagnostics</h2>
  <p>Live scheduler pressure and asynchronous pick timings.</p>
  <div class="diagnostics-grid">
    <span>In flight</span><strong class="diag-flight">idle</strong>
    <span>Queued discrete</span><strong class="diag-discrete">0</strong>
    <span>Queued drag</span><strong class="diag-drag">0</strong>
    <span>Queued hover</span><strong class="diag-hover">0</strong>
    <span>Completed picks</span><strong class="diag-completed">0</strong>
    <span>Failed picks</span><strong class="diag-failed">0</strong>
    <span>Coalesced drag</span><strong class="diag-coalesced-drag">0</strong>
    <span>Coalesced hover</span><strong class="diag-coalesced-hover">0</strong>
    <span>Scheduler wait</span><strong class="diag-wait">-</strong>
    <span>Last pick</span><strong class="diag-last">-</strong>
    <span>Average pick</span><strong class="diag-average">-</strong>
    <span>Maximum pick</span><strong class="diag-maximum">-</strong>
  </div>
  <p class="diagnostics-note">Timings exclude application listener and render cost.</p>
`;
document.body.append(diagnosticsPanel);
for (const type of ["pointerdown", "pointerup", "pointermove", "contextmenu"] as const) {
  for (const overlay of [panel, diagnosticsPanel]) {
    overlay.addEventListener(type, (event) => event.stopPropagation());
  }
}

const status = panel.querySelector<HTMLElement>(".status")!;
const pointers = panel.querySelector<HTMLElement>(".pointers")!;
const dragCount = panel.querySelector<HTMLElement>(".drag-count")!;
const surfaceStatus = panel.querySelector<HTMLElement>(".surface-status")!;
const detailStatus = panel.querySelector<HTMLElement>(".detail-status")!;
const log = panel.querySelector<HTMLElement>(".log")!;
const toggle = panel.querySelector<HTMLButtonElement>(".toggle")!;
const details = panel.querySelector<HTMLButtonElement>(".details")!;
const snap = panel.querySelector<HTMLButtonElement>(".snap")!;
const reset = panel.querySelector<HTMLButtonElement>(".reset")!;
const clear = panel.querySelector<HTMLButtonElement>(".clear")!;
const diagnosticElements = {
  flight: diagnosticsPanel.querySelector<HTMLElement>(".diag-flight")!,
  discrete: diagnosticsPanel.querySelector<HTMLElement>(".diag-discrete")!,
  drag: diagnosticsPanel.querySelector<HTMLElement>(".diag-drag")!,
  hover: diagnosticsPanel.querySelector<HTMLElement>(".diag-hover")!,
  completed: diagnosticsPanel.querySelector<HTMLElement>(".diag-completed")!,
  failed: diagnosticsPanel.querySelector<HTMLElement>(".diag-failed")!,
  coalescedDrag: diagnosticsPanel.querySelector<HTMLElement>(".diag-coalesced-drag")!,
  coalescedHover: diagnosticsPanel.querySelector<HTMLElement>(".diag-coalesced-hover")!,
  wait: diagnosticsPanel.querySelector<HTMLElement>(".diag-wait")!,
  last: diagnosticsPanel.querySelector<HTMLElement>(".diag-last")!,
  average: diagnosticsPanel.querySelector<HTMLElement>(".diag-average")!,
  maximum: diagnosticsPanel.querySelector<HTMLElement>(".diag-maximum")!
};

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
addToScene(scene, createHemisphericLight([0, 1, 0], 1.3));

const ground = createGround(engine, {
  width: FLOOR_WIDTH,
  height: FLOOR_DEPTH,
  subdivisions: 2,
  uvScale: [6, 4.5]
});
ground.name = "floor";
ground.material = material([0.1, 0.16, 0.24], [0.04, 0.04, 0.04]);
addToScene(scene, ground);

const wall = createGround(engine, {
  width: WALL_WIDTH,
  height: WALL_HEIGHT,
  subdivisions: 2,
  uvScale: [6, 2.75]
});
wall.name = "wall";
wall.rotation.x = -Math.PI / 2;
wall.position.y = WALL_HEIGHT / 2;
wall.position.z = WALL_Z;
wall.material = material([0.3, 0.25, 0.46], [0.1, 0.1, 0.12]);
addToScene(scene, wall);

const surfaceExtents = new Map<Mesh, SurfaceExtents>();
const draggable = [
  makeBox("Azure crate", -3.3, -2.2, [0.12, 0.58, 0.95]),
  makeCylinder("Coral cylinder", 0, -2.2, [0.96, 0.34, 0.28]),
  makeBox("Lime crate", 3.3, -2.2, [0.48, 0.88, 0.3]),
  makeCylinder("Violet cylinder", -2.2, 1.7, [0.68, 0.38, 0.95]),
  makeBox("Gold crate", 1.1, 1.7, [0.96, 0.7, 0.2])
];
const starts = new Map<Mesh, StartPosition>(
  draggable.map((mesh) => [mesh, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }])
);
const outliner = createThinInstanceOutliner(engine, scene);
const outlines = new Map(
  draggable.map((mesh) => [
    mesh,
    outliner.attach(mesh, {
      thickness: 0.045,
      color: FLOOR_OUTLINE_COLOR,
      smoothNormals: true
    })
  ])
);

const activeDrags = new Map<number, Mesh>();
const activeSurfaces = new Map<number, Mesh | null>();
let snapEnabled = false;
let dragEvents = 0;
const offsets = new Map<number, DragOffset>();
const lines: string[] = [];

const interactions = createInteractionManager({
  scene,
  canvas,
  detailedPicking: {
    discrete: true,
    drag: dragDetailsEnabled,
    hover: false
  },
  drag: {
    startDistance: 5,
    capturePointer: true,
    ignoreTarget: true,
    surfaceFilter: (mesh) => mesh === ground || mesh === wall
  },
  preventPointerDefault: true,
  onError(error, context) {
    status.textContent = "error";
    write(`${context.phase}: ${String(error)}`);
  }
});

for (const mesh of draggable) registerMesh(interactions, mesh);

onInteractionEvent(interactions, "pointerdown", (event) => {
  pointers.textContent = String(getActivePointers(interactions).length);
  write(`down       ${event.mesh.name} pointer=${event.pointerId}`);
});

onInteractionEvent(interactions, "dragstart", (event) => {
  activeDrags.set(event.pointerId, event.mesh);
  activeSurfaces.set(event.pointerId, null);
  outlines.get(event.mesh)?.highlight(0);
  const point = event.pickedPoint;
  offsets.set(event.pointerId, {
    x: point ? event.mesh.position.x - point[0] : 0,
    y: point ? event.mesh.position.y - point[1] : 0,
    z: point ? event.mesh.position.z - point[2] : 0
  });
  status.textContent = `dragging ${event.mesh.name}`;
  write(`dragstart  ${event.mesh.name} targetSlot=${event.thinInstanceIndex}`);
});

onInteractionEvent(interactions, "drag", (event) => {
  dragEvents += 1;
  dragCount.textContent = String(dragEvents);
  detailStatus.textContent = event.pickDetailsStatus;
  surfaceStatus.textContent = event.pickedMesh?.name ?? "miss";
  if (activeSurfaces.get(event.pointerId) !== event.pickedMesh) {
    activeSurfaces.set(event.pointerId, event.pickedMesh);
    refreshDragOutline(event.mesh);
  }
  const point = event.pickedPoint;
  const offset = offsets.get(event.pointerId);
  if (point && offset) {
    moveOnSurface(event.mesh, event.pickedMesh, point, offset);
  }
  if (dragEvents % 4 === 1) writeDrag(event);
});

onInteractionEvent(interactions, "dragend", (event) => {
  activeDrags.delete(event.pointerId);
  activeSurfaces.delete(event.pointerId);
  refreshDragOutline(event.mesh);
  offsets.delete(event.pointerId);
  // dragend is dispatched just before Interacter removes the released pointer.
  pointers.textContent = String(Math.max(0, getActivePointers(interactions).length - 1));
  status.textContent = "ready";
  surfaceStatus.textContent = "-";
  write(`dragend    ${event.mesh.name} reason=${event.dragEndReason} at ${formatPosition(event.mesh)}`);
});

onInteractionEvent(interactions, "click", (event) => {
  write(`click      ${event.mesh.name} (movement stayed below drag threshold)`);
});

const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 3.2, 15, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
attachControl(camera, canvas, scene, {
  isExternalDragActive: () => activeDrags.size > 0
});

toggle.addEventListener("click", () => {
  setInteractionEnabled(interactions, !isInteractionEnabled(interactions));
  const enabled = isInteractionEnabled(interactions);
  toggle.textContent = enabled ? "Disable interaction" : "Enable interaction";
  status.textContent = enabled ? "ready" : "disabled";
  activeDrags.clear();
  activeSurfaces.clear();
  offsets.clear();
  for (const outline of outlines.values()) outline.clearAll();
});

details.addEventListener("click", () => {
  const url = new URL(window.location.href);
  if (dragDetailsEnabled) url.searchParams.delete("dragDetails");
  else url.searchParams.set("dragDetails", "1");
  window.location.assign(url.href);
});

snap.addEventListener("click", () => {
  snapEnabled = !snapEnabled;
  snap.textContent = `Grid snap: ${snapEnabled ? "0.5" : "off"}`;
  write(`grid snap ${snapEnabled ? "enabled" : "disabled"}`);
});

reset.addEventListener("click", () => {
  for (const mesh of draggable) {
    const start = starts.get(mesh)!;
    mesh.position.x = start.x;
    mesh.position.y = start.y;
    mesh.position.z = start.z;
  }
  surfaceStatus.textContent = "-";
  write("positions reset");
});

clear.addEventListener("click", () => {
  lines.length = 0;
  log.textContent = "Log cleared.";
});

await registerScene(scene);
status.textContent = "ready";
refreshDiagnostics();
await startEngine(engine);

function makeBox(name: string, x: number, z: number, color: readonly [number, number, number]): Mesh {
  const mesh = createBox(engine, 1.25);
  surfaceExtents.set(mesh, { halfWidth: 0.625, floorY: 0.625, wallDepth: 0.625 });
  return place(mesh, name, x, 0.625, z, color);
}

function makeCylinder(name: string, x: number, z: number, color: readonly [number, number, number]): Mesh {
  const mesh = createCylinder(engine, { height: 1.35, diameter: 1.15, tessellation: 32 });
  surfaceExtents.set(mesh, { halfWidth: 0.575, floorY: 0.675, wallDepth: 0.575 });
  return place(mesh, name, x, 0.675, z, color);
}

function place(
  mesh: Mesh,
  name: string,
  x: number,
  y: number,
  z: number,
  color: readonly [number, number, number]
): Mesh {
  mesh.name = name;
  mesh.position.x = x;
  mesh.position.y = y;
  mesh.position.z = z;
  mesh.material = material(color, [0.12, 0.12, 0.12]);
  addToScene(scene, mesh);
  return mesh;
}

function material(
  diffuseColor: readonly [number, number, number],
  specularColor: readonly [number, number, number]
): StandardMaterialProps {
  const result = createStandardMaterial();
  result.diffuseColor = [...diffuseColor];
  result.specularColor = [...specularColor];
  return result;
}

function snapped(value: number): number {
  return snapEnabled ? Math.round(value * 2) / 2 : value;
}

function moveOnSurface(
  mesh: Mesh,
  surface: Mesh | null,
  point: readonly [number, number, number],
  offset: DragOffset
): void {
  const extents = surfaceExtents.get(mesh) ?? { halfWidth: 0.625, floorY: 0.625, wallDepth: 0.625 };
  if (surface === ground) {
    mesh.position.x = clamp(
      snapped(point[0] + offset.x),
      -FLOOR_WIDTH / 2 + extents.halfWidth,
      FLOOR_WIDTH / 2 - extents.halfWidth
    );
    mesh.position.y = extents.floorY;
    mesh.position.z = clamp(
      snapped(point[2] + offset.z),
      -FLOOR_DEPTH / 2 + extents.wallDepth,
      FLOOR_DEPTH / 2 - extents.wallDepth
    );
    return;
  }
  if (surface === wall) {
    mesh.position.x = clamp(
      snapped(point[0] + offset.x),
      -WALL_WIDTH / 2 + extents.halfWidth,
      WALL_WIDTH / 2 - extents.halfWidth
    );
    mesh.position.y = clamp(
      snapped(point[1] + offset.y),
      extents.floorY,
      WALL_HEIGHT - extents.floorY
    );
    mesh.position.z = WALL_Z - extents.wallDepth;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function refreshDragOutline(mesh: Mesh): void {
  const activePointerIds = [...activeDrags]
    .filter(([, activeMesh]) => activeMesh === mesh)
    .map(([pointerId]) => pointerId);
  const outline = outlines.get(mesh);
  if (!outline) return;
  if (activePointerIds.length === 0) {
    outline.clear(0);
    return;
  }
  const onWall = activePointerIds.some((pointerId) => activeSurfaces.get(pointerId) === wall);
  outline.highlight(0, { color: onWall ? WALL_OUTLINE_COLOR : FLOOR_OUTLINE_COLOR });
}

function writeDrag(event: InteractionEvent): void {
  const point = event.pickedPoint;
  const barycentric = event.pickDetails?.barycentric;
  write(
    `drag       ${event.mesh.name}\n` +
    `           surface=${event.pickedMesh?.name ?? "miss"} point=${point?.map(fixed).join(",") ?? "-"}\n` +
    `           face=${event.pickDetails?.faceId ?? "-"} bary=${barycentric?.map(fixed).join(",") ?? "-"}`
  );
}

function write(value: string): void {
  lines.unshift(value);
  log.textContent = lines.slice(0, 16).join("\n");
}

function formatPosition(mesh: Mesh): string {
  return `${fixed(mesh.position.x)}, ${fixed(mesh.position.y)}, ${fixed(mesh.position.z)}`;
}

function fixed(value: number): string {
  return value.toFixed(2);
}

function refreshDiagnostics(): void {
  const current = getInteractionDiagnostics(interactions);
  diagnosticElements.flight.textContent = current.inFlightKind ?? "idle";
  diagnosticElements.discrete.textContent = String(current.queuedDiscrete);
  diagnosticElements.drag.textContent = String(current.queuedDrag);
  diagnosticElements.hover.textContent = String(current.queuedHover);
  diagnosticElements.completed.textContent = String(current.completedPicks);
  diagnosticElements.failed.textContent = String(current.failedPicks);
  diagnosticElements.coalescedDrag.textContent = String(current.coalescedDragSamples);
  diagnosticElements.coalescedHover.textContent = String(current.coalescedHoverSamples);
  diagnosticElements.wait.textContent = milliseconds(current.lastSchedulerWaitMs);
  diagnosticElements.last.textContent = milliseconds(current.lastPickDurationMs);
  diagnosticElements.average.textContent = milliseconds(current.averagePickDurationMs);
  diagnosticElements.maximum.textContent = milliseconds(current.maximumPickDurationMs);
  requestAnimationFrame(refreshDiagnostics);
}

function milliseconds(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} ms`;
}
