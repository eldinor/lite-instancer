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
  type ArcRotateCamera,
  type EngineContext,
  type Mesh,
  type SceneContext,
  type StandardMaterialProps
} from "@babylonjs/lite";
import {
  createAnnotationLayer,
  disposeAnnotationLayer,
  type AnnotationLayer,
  type AnnotationOcclusionProvider
} from "@litools/annotator";
import {
  createHtmlAnnotationBackend,
  type HtmlAnnotationBackendOptions
} from "@litools/annotator/html";
import "./styles.css";

export interface DemoPanel {
  readonly root: HTMLElement;
  describe(value: string): void;
  status(value: string): void;
  button(label: string, callback: () => void): HTMLButtonElement;
}

export interface DemoContext {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly camera: ArcRotateCamera;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly panel: DemoPanel;
  readonly layer: AnnotationLayer | undefined;
  recreateLayer(
    updateMode?: "manual" | "raf",
    onLabelActivate?: HtmlAnnotationBackendOptions["onLabelActivate"],
    occlusionProvider?: AnnotationOcclusionProvider
  ): AnnotationLayer;
  disposeLayer(): void;
  addBox(name: string, position: readonly [number, number, number], color: readonly [number, number, number], size?: number): Mesh;
  frame(callback: (deltaMs: number) => void): void;
  cleanup(callback: () => void): void;
}

const demo = document.body.dataset.demo;
const app = document.querySelector<HTMLDivElement>("#app");
if (!demo || !app) throw new Error("Example page is missing its demo name or app root.");

const canvas = document.createElement("canvas");
const overlay = document.createElement("div");
canvas.setAttribute("aria-label", `${document.title} 3D viewport`);
overlay.className = "annotation-overlay";
app.className = "demo-stage";
app.append(canvas, overlay);

const panel = createPanel(document.title);
document.body.append(panel.root);
const hint = document.createElement("div");
hint.className = "demo-hint";
hint.textContent = "Drag to orbit · Scroll to zoom";
document.body.append(hint);

const engine = await createEngine(canvas).catch((error: unknown) => {
  panel.status("WebGPU unavailable");
  panel.describe("These live examples require a browser with WebGPU enabled.");
  document.body.dataset.ready = "unsupported";
  document.body.dataset.error = String(error);
  return undefined;
});

if (engine) {
  const scene = createSceneContext(engine);
  scene.clearColor = { r: 0.018, g: 0.04, b: 0.037, a: 1 };
  const camera = createArcRotateCamera(-Math.PI / 2.25, Math.PI / 2.75, 14, vec3(0, 0.2, 0));
  scene.camera = camera;
  addToScene(scene, camera);
  addToScene(scene, createHemisphericLight([0.25, 1, 0.35], 1.25));
  attachControl(camera, canvas, scene);

  const floor = createBox(engine, 1);
  floor.name = "Floor";
  floor.position.y = -1.55;
  floor.scaling.x = 12;
  floor.scaling.y = 0.18;
  floor.scaling.z = 8;
  floor.material = material([0.07, 0.12, 0.105]);
  addToScene(scene, floor);

  let activeLayer: AnnotationLayer | undefined;
  const cleanupCallbacks: Array<() => void> = [];

  const context: DemoContext = {
    engine,
    scene,
    camera,
    canvas,
    overlay,
    panel,
    get layer() {
      return activeLayer;
    },
    recreateLayer(updateMode = "raf", onLabelActivate, occlusionProvider) {
      if (activeLayer) disposeAnnotationLayer(activeLayer);
      activeLayer = createAnnotationLayer({
        scene,
        camera,
        canvas,
        backend: createHtmlAnnotationBackend({
          container: overlay,
          ...(onLabelActivate ? { onLabelActivate } : {})
        }),
        ...(occlusionProvider ? { occlusionProvider } : {}),
        updateMode,
        viewportPadding: 12
      });
      return activeLayer;
    },
    disposeLayer() {
      if (!activeLayer) return;
      disposeAnnotationLayer(activeLayer);
      activeLayer = undefined;
    },
    addBox(name, position, color, size = 1.8) {
      const mesh = createBox(engine, size);
      mesh.name = name;
      mesh.position.x = position[0];
      mesh.position.y = position[1];
      mesh.position.z = position[2];
      mesh.material = material(color);
      addToScene(scene, mesh);
      return mesh;
    },
    frame(callback) {
      onBeforeRender(scene, callback);
    },
    cleanup(callback) {
      cleanupCallbacks.push(callback);
    }
  };

  context.recreateLayer();
  await configureDemo(demo, context);
  await registerScene(scene);
  panel.status("running");
  document.body.dataset.ready = "true";
  await startEngine(engine);

  window.addEventListener("beforeunload", () => {
    for (const callback of cleanupCallbacks.reverse()) callback();
    context.disposeLayer();
  }, { once: true });
}

async function configureDemo(name: string, ctx: DemoContext): Promise<void> {
  if (name === "labels") {
    const { configureLabels } = await import("../labels/main.js");
    configureLabels(ctx);
    return;
  }
  if (name === "markers") {
    const { configureMarkers } = await import("../markers/main.js");
    configureMarkers(ctx);
    return;
  }
  if (name === "dynamic") {
    const { configureDynamic } = await import("../dynamic/main.js");
    configureDynamic(ctx);
    return;
  }
  if (name === "instancer") {
    const { configureInstancer } = await import("../instancer/main.js");
    configureInstancer(ctx);
    return;
  }
  if (name === "lifecycle") {
    const { configureLifecycle } = await import("../lifecycle/main.js");
    configureLifecycle(ctx);
    return;
  }
  if (name === "collisions") {
    const { configureCollisions } = await import("../collisions/main.js");
    configureCollisions(ctx);
    return;
  }
  if (name === "collision-stress") {
    const { configureCollisionStress } = await import("../collision-stress/main.js");
    configureCollisionStress(ctx);
    return;
  }
  if (name === "occlusion") {
    const { configureOcclusion } = await import("../occlusion/main.js");
    configureOcclusion(ctx);
    return;
  }
  throw new Error(`Unknown Annotator example '${name}'.`);
}

function material(color: readonly [number, number, number]): StandardMaterialProps {
  const value = createStandardMaterial();
  value.diffuseColor = [color[0], color[1], color[2]];
  value.specularColor = [0.05, 0.08, 0.07];
  return value;
}

function createPanel(title: string): DemoPanel {
  const root = document.createElement("section");
  root.className = "demo-panel";
  root.innerHTML = `
    <a class="back" href="../">← Annotator examples</a>
    <h1></h1>
    <p class="description"></p>
    <div class="status-row">Status: <span class="status">initializing</span></div>
    <div class="controls"></div>
  `;
  root.querySelector("h1")!.textContent = title;
  const description = root.querySelector<HTMLElement>(".description")!;
  const status = root.querySelector<HTMLElement>(".status")!;
  const controls = root.querySelector<HTMLElement>(".controls")!;
  for (const eventName of ["pointerdown", "pointerup", "wheel"] as const) {
    root.addEventListener(eventName, (event) => event.stopPropagation());
  }
  return {
    root,
    describe(value) {
      description.textContent = value;
    },
    status(value) {
      status.textContent = value;
    },
    button(label, callback) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", callback);
      controls.append(button);
      return button;
    }
  };
}
