import {
  addToScene,
  createArcRotateCamera,
  createBox,
  createEngine,
  createFreeCamera,
  createGeospatialCamera,
  createHemisphericLight,
  createSceneContext,
  createSphere,
  createStandardMaterial,
  disposeEngine,
  setGeospatialOrientation,
  startEngine,
  vec3,
  type EngineContext,
  type ArcRotateCamera,
  type SceneContext,
  type StandardMaterialProps
} from "@babylonjs/lite";
import {
  activateStage,
  beginStageNavigation,
  createStageManager,
  defineStage,
  disposeStage,
  disposeStageManager,
  getActiveStage,
  getStageInstance,
  getStageManagerSnapshot,
  isStageAbortError,
  navigateToStage,
  onStageProgress,
  onStageStateChanged,
  preloadStage,
  type StageManager
} from "@litools/stager";
import {
  arcRotateCameraControls,
  createBabylonStageHost,
  defineBabylonStage,
  freeCameraControls,
  geospatialCameraControls,
  type BabylonStageDefinition
} from "@litools/stager/babylon";
import { htmlFadeTransition } from "@litools/stager/dom";

interface DemoSceneData {
  label: string;
  sharedName?: string;
}

interface DemoPanel {
  root: HTMLElement;
  status(value: string): void;
  describe(value: string): void;
  log(value: string): void;
  clearLog(): void;
  button(label: string, callback: () => void | Promise<void>): HTMLButtonElement;
  progress(value: number): void;
}

const demo = document.body.dataset.demo;
const app = document.querySelector<HTMLDivElement>("#app");
if (!demo || !app) throw new Error("The example page is missing its demo name or app root.");

app.className = "demo-stage";
const canvas = document.createElement("canvas");
canvas.setAttribute("aria-label", `${document.title} 3D viewport`);
const overlay = document.createElement("div");
overlay.className = "transition-overlay";
app.append(canvas, overlay);
const babylonHost = createBabylonStageHost({ canvas });

const panel = createPanel(document.title);
document.body.append(panel.root);

const engine = await createEngine(canvas).catch((error: unknown) => {
  panel.status("WebGPU unavailable");
  panel.describe("These examples require a browser with WebGPU enabled.");
  panel.log(String(error));
  document.body.dataset.ready = "unsupported";
  return undefined;
});

if (engine) {
  const manager = createStageManager(
    demo === "dom-fade"
      ? {
          defaultTransition: htmlFadeTransition({
            host: overlay,
            duration: 320,
            color: "#05070c",
            blockPointerInput: true,
            respectReducedMotion: true
          })
        }
      : {}
  );

  onStageStateChanged(manager, ({ stageId, previous, state }) => {
    panel.log(`${stageId.padEnd(12)} ${previous ?? "defined"} → ${state}`);
  });
  onStageProgress(manager, (event) => {
    panel.progress(event.ratio ?? 0);
    panel.status(`${event.phase}: ${event.ratio === null ? "working" : `${Math.round(event.ratio * 100)}%`}`);
  });

  await configureDemo(demo, engine, manager, panel);
  document.body.dataset.ready = "true";
  await startEngine(engine);

  window.addEventListener(
    "beforeunload",
    () => {
      void disposeStageManager(manager).finally(() => disposeEngine(engine));
    },
    { once: true }
  );
}

async function configureDemo(
  name: string,
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  switch (name) {
    case "navigation":
      await configureNavigation(engine, manager, panel);
      return;
    case "preload-progress":
      await configurePreload(engine, manager, panel);
      return;
    case "cancellation-failure":
      await configureCancellation(engine, manager, panel);
      return;
    case "resource-ownership":
      await configureResources(engine, manager, panel);
      return;
    case "dom-fade":
      await configureFade(engine, manager, panel);
      return;
    case "free-camera":
      await configureFreeCamera(engine, manager, panel);
      return;
    case "geospatial-camera":
      await configureGeospatialCamera(engine, manager, panel);
      return;
    case "activation-rollback":
      await configureActivationRollback(engine, manager, panel);
      return;
    default:
      throw new Error(`Unknown Stager example "${name}".`);
  }
}

async function configureNavigation(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Switch between two retained scenes, then dispose whichever stage is inactive.");
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "menu", [0.08, 0.5, 0.65], "box"));
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "viewer", [0.58, 0.34, 0.9], "sphere"));
  await navigateToStage(manager, "menu");
  panel.status("menu active");

  panel.button("Go to viewer", async () => {
    await navigateToStage(manager, "viewer");
    panel.status("viewer active; menu remains loaded");
  });
  panel.button("Return to menu", async () => {
    await navigateToStage(manager, "menu");
    panel.status("menu active; viewer remains loaded");
  });
  panel.button("Dispose inactive", async () => {
    const inactive = getActiveStage(manager)?.id === "menu" ? "viewer" : "menu";
    if (!getStageInstance(manager, inactive)) {
      panel.status(`${inactive} is already disposed`);
      return;
    }
    await disposeStage(manager, inactive);
    panel.status(`${inactive} disposed deterministically`);
  });
}

async function configurePreload(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Preload a simulated heavy viewer while the home scene remains visible, then activate it instantly.");
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "home", [0.08, 0.42, 0.46], "box"));
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "editor", [0.85, 0.43, 0.16], "sphere", 900));
  await navigateToStage(manager, "home");
  const activate = panel.button("Activate preloaded", async () => {
    await activateStage(manager, "editor");
    panel.status("editor active; no second load");
  });
  activate.disabled = true;

  panel.button("Preload editor", async () => {
    if (!getStageInstance(manager, "editor")) {
      panel.progress(0);
      await preloadStage(manager, "editor");
    }
    activate.disabled = false;
    panel.progress(1);
    panel.status("editor loaded and inactive");
  });
  panel.button("Return home", async () => {
    await navigateToStage(manager, "home");
    panel.status("home active");
  });
}

async function configureCancellation(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Start slow work, cancel it explicitly or supersede it, and prove a failed load cannot replace the safe stage.");
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "safe", [0.08, 0.55, 0.34], "box"));
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "slow", [0.25, 0.55, 0.92], "sphere", 1800));
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "newest", [0.67, 0.39, 0.9], "box"));
  defineStage(manager, {
    id: "broken",
    async load({ signal, reportProgress }) {
      reportProgress({ phase: "validation", completed: 0, total: 1 });
      await delay(450, signal);
      throw new Error("Intentional example load failure");
    }
  });
  await navigateToStage(manager, "safe");
  let slowOperation: ReturnType<typeof beginStageNavigation> | undefined;

  panel.button("Start slow load", () => {
    slowOperation = beginStageNavigation(manager, "slow");
    panel.status("slow navigation running");
    void slowOperation.promise.catch((error: unknown) => {
      panel.status(isStageAbortError(error) ? "slow navigation cancelled; safe preserved" : String(error));
    });
  });
  panel.button("Cancel slow", () => {
    slowOperation?.cancel();
  });
  panel.button("Newer navigation wins", async () => {
    await navigateToStage(manager, "newest");
    panel.status("newest active; obsolete work cannot commit");
  });
  panel.button("Try broken stage", async () => {
    const before = getActiveStage(manager)?.id;
    try {
      await navigateToStage(manager, "broken");
    } catch (error) {
      panel.status(`failed as expected; ${before} remains active`);
      panel.log(`caught: ${String(error)}`);
    }
  });
}

async function configureResources(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Both stages lease one shared environment. Explicit disposal releases leases and cleans owned resources last-in, first-out.");
  let sharedLoads = 0;
  const sharedFactory = async (): Promise<{ name: string }> => {
    sharedLoads++;
    await Promise.resolve();
    panel.log(`shared environment loaded (${sharedLoads} factory call)`);
    return { name: "studio-environment" };
  };

  for (const [id, color, shape] of [
    ["overview", [0.08, 0.5, 0.65], "box"],
    ["detail", [0.65, 0.35, 0.86], "sphere"]
  ] as const) {
    const base = sceneStage(engine, id, color, shape);
    defineBabylonStage(manager, babylonHost, {
      id,
      async load(context) {
        const result = await base.load(context);
        const environment = await context.shared.acquire("studio-environment", sharedFactory, {
          dispose: (value) => panel.log(`shared disposed: ${value.name}`)
        });
        context.resources.own(`${id}:first`, (value) => panel.log(`owned disposed: ${value}`));
        context.resources.own(`${id}:second`, (value) => panel.log(`owned disposed: ${value}`));
        return {
          ...result,
          data: { ...result.data, sharedName: environment.name }
        };
      }
    });
  }

  await navigateToStage(manager, "overview");
  reportResources(manager, panel);
  panel.button("Load detail", async () => {
    await navigateToStage(manager, "detail");
    reportResources(manager, panel);
  });
  panel.button("Return overview", async () => {
    await navigateToStage(manager, "overview");
    reportResources(manager, panel);
  });
  panel.button("Dispose inactive", async () => {
    const inactive = getActiveStage(manager)?.id === "overview" ? "detail" : "overview";
    if (getStageInstance(manager, inactive)) await disposeStage(manager, inactive);
    reportResources(manager, panel);
  });
}

async function configureFade(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("The optional DOM transition covers the canvas while Stager commits a scene handoff. Enable reduced motion in your OS to skip animation.");
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "blue", [0.05, 0.44, 0.8], "box"));
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "violet", [0.58, 0.28, 0.85], "sphere"));
  await navigateToStage(manager, "blue");
  panel.status("blue active");

  panel.button("Fade to violet", async () => {
    await navigateToStage(manager, "violet");
    panel.status("violet active");
  });
  panel.button("Fade to blue", async () => {
    await navigateToStage(manager, "blue");
    panel.status("blue active");
  });
}

async function configureFreeCamera(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Move with WASD or arrow keys and drag to look. Each retained stage keeps an independent Free Camera while only the active one owns input.");
  defineBabylonStage(manager, babylonHost, freeCameraStage(engine, "hangar", [0.12, 0.5, 0.85]));
  defineBabylonStage(manager, babylonHost, freeCameraStage(engine, "workshop", [0.72, 0.34, 0.16]));
  await navigateToStage(manager, "hangar");
  panel.status("hangar active; click the canvas before using keys");

  panel.button("Enter workshop", async () => {
    await navigateToStage(manager, "workshop");
    panel.status("workshop camera active");
  });
  panel.button("Return to hangar", async () => {
    await navigateToStage(manager, "hangar");
    panel.status("hangar camera restored to its own view");
  });
}

async function configureGeospatialCamera(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("Drag to pan over each generated planet, right-drag to tilt, and scroll to zoom. Camera state remains isolated per stage.");
  defineBabylonStage(manager, babylonHost, geospatialStage(engine, "azure", [0.08, 0.42, 0.82], 3));
  defineBabylonStage(manager, babylonHost, geospatialStage(engine, "ember", [0.78, 0.25, 0.09], 2.4));
  await navigateToStage(manager, "azure");
  panel.status("azure planet active");

  panel.button("Visit ember", async () => {
    await navigateToStage(manager, "ember");
    panel.status("ember controls active");
  });
  panel.button("Return to azure", async () => {
    await navigateToStage(manager, "azure");
    panel.status("azure view restored");
  });
}

async function configureActivationRollback(
  engine: EngineContext,
  manager: StageManager,
  panel: DemoPanel
): Promise<void> {
  panel.describe("The incoming scene registers successfully, then its user enter hook throws. The adapter restores the outgoing scene and camera controls.");
  defineBabylonStage(manager, babylonHost, sceneStage(engine, "stable", [0.08, 0.55, 0.34], "box"));
  defineBabylonStage(manager, babylonHost, {
    ...sceneStage(engine, "broken-enter", [0.8, 0.16, 0.18], "sphere"),
    enter() {
      throw new Error("Intentional enter failure");
    }
  });
  await navigateToStage(manager, "stable");
  panel.status("stable stage active");

  panel.button("Attempt broken activation", async () => {
    try {
      await navigateToStage(manager, "broken-enter");
    } catch (error) {
      panel.log(`caught: ${String(error)}`);
      panel.status(`${getActiveStage(manager)?.id ?? "none"} restored after enter failure`);
    }
  });
}

function sceneStage(
  engine: EngineContext,
  id: string,
  color: readonly [number, number, number],
  shape: "box" | "sphere",
  loadDuration = 0
): BabylonStageDefinition<unknown, DemoSceneData> {
  return {
    id,
    async load({ signal, reportProgress }) {
      if (loadDuration > 0) {
        for (let step = 1; step <= 5; step++) {
          await delay(loadDuration / 5, signal);
          reportProgress({ phase: "scene", completed: step, total: 5 });
        }
      }
      const created = createDemoScene(engine, id, color, shape);
      return {
        scene: created.scene,
        controls: arcRotateCameraControls(created.camera),
        data: { label: id }
      };
    }
  };
}

function createDemoScene(
  engine: EngineContext,
  name: string,
  color: readonly [number, number, number],
  shape: "box" | "sphere"
): { scene: SceneContext; camera: ArcRotateCamera } {
  const scene = createSceneContext(engine);
  scene.clearColor = { r: color[0] * 0.07, g: color[1] * 0.07, b: color[2] * 0.09, a: 1 };
  const camera = createArcRotateCamera(-Math.PI / 2.2, Math.PI / 2.8, 10, vec3(0, 0, 0));
  scene.camera = camera;
  addToScene(scene, camera);
  addToScene(scene, createHemisphericLight([0.2, 1, 0.3], 1.35));

  const object = shape === "box" ? createBox(engine, 2.5) : createSphere(engine, { diameter: 3 });
  object.name = `${name}-${shape}`;
  object.material = material(color);
  addToScene(scene, object);

  const floor = createBox(engine, 1);
  floor.name = `${name}-floor`;
  floor.position.y = -1.9;
  floor.scaling.x = 11;
  floor.scaling.y = 0.18;
  floor.scaling.z = 7;
  floor.material = material([color[0] * 0.18, color[1] * 0.18, color[2] * 0.18]);
  addToScene(scene, floor);
  return { scene, camera };
}

function freeCameraStage(
  engine: EngineContext,
  id: string,
  color: readonly [number, number, number]
): BabylonStageDefinition<unknown, DemoSceneData> {
  return {
    id,
    load() {
      const scene = createSceneContext(engine);
      scene.clearColor = { r: color[0] * 0.06, g: color[1] * 0.06, b: color[2] * 0.08, a: 1 };
      const camera = createFreeCamera(vec3(0, 1.1, -11), vec3(0, 0, 0));
      scene.camera = camera;
      addToScene(scene, camera);
      addToScene(scene, createHemisphericLight([0.2, 1, 0.25], 1.35));

      for (let index = 0; index < 9; index++) {
        const box = createBox(engine, 1.25);
        box.position.x = (index % 3) * 3 - 3;
        box.position.y = Math.floor(index / 3) * 1.7 - 1.4;
        box.position.z = (index % 2) * 1.4;
        box.material = material([
          Math.min(1, color[0] + index * 0.035),
          Math.min(1, color[1] + index * 0.02),
          Math.min(1, color[2] + index * 0.015)
        ]);
        addToScene(scene, box);
      }

      return {
        scene,
        controls: freeCameraControls(camera),
        data: { label: id }
      };
    }
  };
}

function geospatialStage(
  engine: EngineContext,
  id: string,
  color: readonly [number, number, number],
  planetRadius: number
): BabylonStageDefinition<unknown, DemoSceneData> {
  return {
    id,
    load() {
      const scene = createSceneContext(engine);
      scene.clearColor = { r: 0.004, g: 0.008, b: 0.018, a: 1 };
      const camera = createGeospatialCamera({ planetRadius });
      setGeospatialOrientation(camera, {
        center: vec3(0, planetRadius, 0),
        yaw: 0.25,
        pitch: 0.38,
        radius: planetRadius * 2.1
      });
      camera.nearPlane = 0.05;
      camera.farPlane = planetRadius * 20;
      scene.camera = camera;
      addToScene(scene, camera);
      addToScene(scene, createHemisphericLight([0.35, 1, 0.2], 1.6));

      const planet = createSphere(engine, { diameter: planetRadius * 2, segments: 48 });
      planet.name = `${id}-planet`;
      planet.material = material(color);
      addToScene(scene, planet);

      return {
        scene,
        controls: geospatialCameraControls(camera, {
          zoomToCursor: true,
          checkCollisions: true
        }),
        data: { label: id }
      };
    }
  };
}

function material(color: readonly [number, number, number]): StandardMaterialProps {
  const value = createStandardMaterial();
  value.diffuseColor = [color[0], color[1], color[2]];
  value.specularColor = [0.08, 0.1, 0.14];
  return value;
}

function reportResources(manager: StageManager, panel: DemoPanel): void {
  const snapshot = getStageManagerSnapshot(manager);
  const shared = snapshot.sharedResources[0];
  panel.status(
    shared
      ? `${shared.key}: ${shared.references} lease${shared.references === 1 ? "" : "s"}`
      : "no shared resources retained"
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function createPanel(title: string): DemoPanel {
  const root = document.createElement("section");
  root.className = "demo-panel";
  root.innerHTML = `
    <a class="back" href="../">← Stager examples</a>
    <h1></h1>
    <p class="description"></p>
    <div class="status-row">Status: <span class="status">initializing</span></div>
    <div class="progress-track"><div class="progress-bar"></div></div>
    <div class="controls"></div>
    <pre class="log" aria-live="polite"></pre>
  `;
  root.querySelector("h1")!.textContent = title;
  const description = root.querySelector<HTMLElement>(".description")!;
  const status = root.querySelector<HTMLElement>(".status")!;
  const controls = root.querySelector<HTMLElement>(".controls")!;
  const log = root.querySelector<HTMLElement>(".log")!;
  const progress = root.querySelector<HTMLElement>(".progress-bar")!;

  return {
    root,
    status(value) {
      status.textContent = value;
    },
    describe(value) {
      description.textContent = value;
    },
    log(value) {
      log.textContent = `${value}\n${log.textContent ?? ""}`.slice(0, 5000);
    },
    clearLog() {
      log.textContent = "";
    },
    button(label, callback) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        button.disabled = true;
        Promise.resolve(callback())
          .catch((error: unknown) => {
            status.textContent = isStageAbortError(error) ? "operation cancelled" : "operation failed";
            log.textContent = `${String(error)}\n${log.textContent ?? ""}`;
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      controls.append(button);
      return button;
    },
    progress(value) {
      progress.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    }
  };
}
