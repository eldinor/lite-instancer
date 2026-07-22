import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  onBeforeRender,
  registerScene,
  startEngine,
  vec3,
  type Mesh
} from "@babylonjs/lite";
import {
  createInstanceSet,
  type ColoredInstanceSet,
  type InstanceId,
  type InstanceTransformInput
} from "../../../src/index.js";

interface SmokeMeta {
  label: string;
  ordinal: number;
}

interface ExpectedInstance {
  position: readonly [number, number, number];
  color: readonly [number, number, number, number];
  visible: boolean;
}

interface SmokePool {
  name: string;
  set: ColoredInstanceSet<SmokeMeta>;
  expected: Map<InstanceId, ExpectedInstance>;
  removed: Set<InstanceId>;
  nextOrdinal: number;
  z: number;
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const phase = requireElement<HTMLElement>("#phase");
const checks = requireElement<HTMLOListElement>("#checks");
const metrics = requireElement<HTMLElement>("#metrics");
const rerun = requireElement<HTMLButtonElement>("#rerun");

const checkNames = [
  "Create before the first rendered frame",
  "Create after the first rendered frame",
  "Hide/show with active-count",
  "Bulk create/remove",
  "Colored instance data",
  "Capacity growth and synchronized fallback",
  "dynamicDrawCount: false legacy path",
  "Stable IDs, slots, and final visual hold"
] as const;
const checkRows = checkNames.map((name) => {
  const row = document.createElement("li");
  row.textContent = name;
  checks.append(row);
  return row;
});

void run().catch((error: unknown) => failRun(error));
rerun.addEventListener("click", () => location.reload());

async function run(): Promise<void> {
  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  scene.clearColor = { r: 0.025, g: 0.035, b: 0.055, a: 1 };
  const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.65, 12.5, vec3(0, 0, 0));
  scene.camera = camera;
  addToScene(scene, camera);
  addToScene(scene, createHemisphericLight([0, 1, 0], 1.15));
  attachControl(camera, canvas, scene);

  const dynamic = createPool(createHostMesh(engine, scene, "dynamic-host"), "dynamic", -1.35, true);
  const legacy = createPool(createHostMesh(engine, scene, "legacy-host"), "legacy", 1.35, false);
  const pools = [dynamic, legacy];
  let renderedFrames = 0;
  let monitorEnabled = false;
  let monitorFailure: Error | undefined;
  const frameWaiters: Array<{ target: number; resolve(): void }> = [];

  onBeforeRender(scene, () => {
    renderedFrames++;
    if (monitorEnabled && !monitorFailure) {
      try {
        for (const pool of pools) validatePool(pool);
      } catch (error) {
        monitorFailure = toError(error);
      }
    }
    for (let index = frameWaiters.length - 1; index >= 0; index--) {
      const waiter = frameWaiters[index]!;
      if (renderedFrames >= waiter.target) {
        frameWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
    updateMetrics(pools, renderedFrames);
  });

  setCheck(0, "running");
  addMany(dynamic, 2);
  addMany(legacy, 2);
  for (const pool of pools) validatePool(pool);
  setCheck(0, "pass");

  phase.textContent = "Registering scene and submitting the first frame…";
  await registerScene(scene);
  await startEngine(engine);
  assert(renderedFrames >= 1, "The first rendered frame was not observed");
  monitorEnabled = true;

  setCheck(1, "running");
  phase.textContent = "Creating colored instances after the first rendered frame…";
  addMany(dynamic, 1);
  addMany(legacy, 1);
  await waitFrames(2);
  for (const pool of pools) validatePool(pool);
  setCheck(1, "pass");

  setCheck(2, "running");
  phase.textContent = "Packing active visibility and holding each state…";
  for (const pool of pools) {
    const first = firstId(pool);
    pool.set.setVisible(first, false);
    pool.expected.get(first)!.visible = false;
  }
  await waitFrames(12);
  for (const pool of pools) validatePool(pool);
  for (const pool of pools) {
    const first = firstId(pool);
    pool.set.setVisible(first, true);
    pool.expected.get(first)!.visible = true;
  }
  await waitFrames(12);
  for (const pool of pools) validatePool(pool);
  setCheck(2, "pass");

  setCheck(3, "running");
  setCheck(5, "running");
  phase.textContent = "Growing capacity with bulk creation, then removing swapped slots…";
  const initialCapacities = pools.map((pool) => pool.set.capacity);
  const bulkIds = pools.map((pool) => addMany(pool, 4));
  await waitFrames(3);
  pools.forEach((pool, index) => {
    assert(pool.set.capacity > initialCapacities[index]!, `${pool.name}: capacity did not grow`);
    validatePool(pool);
  });
  pools.forEach((pool, index) => {
    const live = Array.from(pool.expected.keys());
    const removeIds = [live[1]!, bulkIds[index]![1]!];
    assert(pool.set.removeMany(removeIds) === 2, `${pool.name}: bulk remove count mismatch`);
    for (const id of removeIds) {
      pool.expected.delete(id);
      pool.removed.add(id);
    }
    assert(pool.set.removeMany(removeIds) === 0, `${pool.name}: stale IDs were removed twice`);
  });
  await waitFrames(3);
  for (const pool of pools) validatePool(pool);
  setCheck(3, "pass");
  setCheck(5, "pass");

  setCheck(4, "running");
  for (const pool of pools) validateColors(pool);
  setCheck(4, "pass");

  setCheck(6, "running");
  validatePool(legacy);
  assert(legacy.set.count > 0 && legacy.set.visibleCount === legacy.set.count, "legacy path is not fully visible");
  setCheck(6, "pass");

  setCheck(7, "running");
  phase.textContent = "Visual stability hold: watch both rows for missing, stale, or flashing boxes…";
  await waitFrames(90);
  if (monitorFailure) throw monitorFailure;
  for (const pool of pools) validatePool(pool);
  setCheck(7, "pass");

  document.body.classList.add("passed");
  phase.textContent = `PASS · ${renderedFrames} frames observed · both paths stable`;
  rerun.disabled = false;

  function waitFrames(count: number): Promise<void> {
    return new Promise((resolve) => frameWaiters.push({ target: renderedFrames + count, resolve }));
  }
}

function createHostMesh(
  engine: Awaited<ReturnType<typeof createEngine>>,
  scene: ReturnType<typeof createSceneContext>,
  name: string
): Mesh {
  const mesh = createBox(engine, 0.72);
  mesh.name = name;
  const material = createStandardMaterial();
  material.diffuseColor = [1, 1, 1];
  material.specularColor = [0.08, 0.08, 0.08];
  mesh.material = material;
  addToScene(scene, mesh);
  return mesh;
}

function createPool(mesh: Mesh, name: string, z: number, dynamicDrawCount: boolean): SmokePool {
  return {
    name,
    set: createInstanceSet<SmokeMeta>(mesh, {
      capacity: 4,
      grow: "double",
      colors: true,
      visibleStrategy: "active-count",
      dynamicDrawCount
    }),
    expected: new Map(),
    removed: new Set(),
    nextOrdinal: 0,
    z
  };
}

function addMany(pool: SmokePool, count: number): InstanceId[] {
  const inputs: Array<{ transform: InstanceTransformInput; metadata: SmokeMeta }> = [];
  const expectations: ExpectedInstance[] = [];
  for (let offset = 0; offset < count; offset++) {
    const ordinal = pool.nextOrdinal++;
    const position = [xForOrdinal(ordinal), pool.z, 0] as const;
    const color = colorForOrdinal(ordinal, pool.name === "dynamic" ? 0 : 0.12);
    inputs.push({ transform: { position }, metadata: { label: `${pool.name}-${ordinal}`, ordinal } });
    expectations.push({ position, color, visible: true });
  }
  const ids = pool.set.createMany(inputs);
  ids.forEach((id, index) => {
    const expected = expectations[index]!;
    pool.set.setColor(id, expected.color);
    pool.expected.set(id, expected);
  });
  return ids;
}

function validatePool(pool: SmokePool): void {
  assert(pool.set.count === pool.expected.size, `${pool.name}: count ${pool.set.count} != ${pool.expected.size}`);
  const expectedVisible = Array.from(pool.expected.values()).filter((item) => item.visible).length;
  assert(pool.set.visibleCount === expectedVisible, `${pool.name}: visible count mismatch`);
  const ids = Array.from(pool.set.ids());
  assert(ids.length === pool.expected.size, `${pool.name}: ID iteration count mismatch`);
  const slots = new Set<number>();
  for (const [id, expected] of pool.expected) {
    assert(pool.set.has(id), `${pool.name}: missing live ID ${Number(id)}`);
    const slot = pool.set.getSlot(id);
    assert(slot !== undefined, `${pool.name}: ID ${Number(id)} has no slot`);
    assert(!slots.has(slot), `${pool.name}: duplicate slot ${slot}`);
    slots.add(slot);
    assert(pool.set.getIdForSlot(slot) === id, `${pool.name}: stale reverse slot mapping for ${Number(id)}`);
    assert(pool.set.getVisible(id) === expected.visible, `${pool.name}: visibility mismatch for ${Number(id)}`);
    const matrix = pool.set.getMatrix(id);
    assertClose(matrix[12] ?? 0, expected.position[0], `${pool.name}: stale X for ${Number(id)}`);
    assertClose(matrix[13] ?? 0, expected.position[1], `${pool.name}: stale Y for ${Number(id)}`);
    assertClose(matrix[14] ?? 0, expected.position[2], `${pool.name}: stale Z for ${Number(id)}`);
  }
  for (const id of pool.removed) assert(!pool.set.has(id), `${pool.name}: removed ID ${Number(id)} is live again`);
  validateColors(pool);
}

function validateColors(pool: SmokePool): void {
  const actual = new Float32Array(4);
  for (const [id, expected] of pool.expected) {
    pool.set.getColor(id, actual);
    for (let component = 0; component < 4; component++) {
      assertClose(actual[component] ?? 0, expected.color[component] ?? 0, `${pool.name}: color mismatch`);
    }
  }
}

function firstId(pool: SmokePool): InstanceId {
  const id = pool.expected.keys().next().value as InstanceId | undefined;
  if (id === undefined) throw new Error(`${pool.name}: no live ID`);
  return id;
}

function xForOrdinal(ordinal: number): number {
  return (ordinal - 3) * 1.15;
}

function colorForOrdinal(ordinal: number, hueOffset: number): readonly [number, number, number, number] {
  const hue = (ordinal * 0.17 + hueOffset) % 1;
  const angle = hue * Math.PI * 2;
  return [
    0.55 + Math.sin(angle) * 0.35,
    0.55 + Math.sin(angle + 2.1) * 0.35,
    0.55 + Math.sin(angle + 4.2) * 0.35,
    1
  ];
}

function updateMetrics(pools: SmokePool[], frames: number): void {
  metrics.replaceChildren();
  const values: Array<[string, string | number]> = [["rendered frames", frames]];
  for (const pool of pools) {
    values.push(
      [`${pool.name} count`, pool.set.count],
      [`${pool.name} visible`, pool.set.visibleCount],
      [`${pool.name} capacity`, pool.set.capacity]
    );
  }
  for (const [key, value] of values) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = key;
    description.textContent = String(value);
    metrics.append(term, description);
  }
}

function setCheck(index: number, state: "running" | "pass"): void {
  const row = checkRows[index]!;
  row.className = state;
  row.textContent = `${state === "pass" ? "✓" : "…"} ${checkNames[index]}`;
}

function failRun(error: unknown): void {
  const failure = toError(error);
  document.body.classList.add("failed");
  phase.textContent = `FAIL · ${failure.message}`;
  const running = checkRows.find((row) => row.classList.contains("running"));
  if (running) {
    running.className = "fail";
    running.textContent = `✕ ${running.textContent?.replace(/^…\s*/, "") ?? "check failed"}`;
  }
  rerun.disabled = false;
  console.error(failure);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-5) throw new Error(`${message}: ${actual} != ${expected}`);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
