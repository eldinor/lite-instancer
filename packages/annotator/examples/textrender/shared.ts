import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  loadFont,
  onBeforeRender,
  registerScene,
  startEngine,
  vec3,
  type ArcRotateCamera,
  type EngineContext,
  type Mesh,
  type SceneContext
} from "@babylonjs/lite";
import {
  createAnnotationLayer,
  disposeAnnotationLayer,
  updateAnnotationLayer,
  type AnnotationLayer
} from "@litools/annotator";
import {
  createTextRendererAnnotationBackend,
  type TextRendererAnnotationBackend,
  type TextRendererMarkerShapeRasterizer,
  type TextRendererShapingMode
} from "@litools/annotator/textrender";
import "../shared/styles.css";
import { createDemoNavigation } from "../shared/navigation.js";

export interface TextDemoContext {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly camera: ArcRotateCamera;
  readonly canvas: HTMLCanvasElement;
  readonly panel: TextDemoPanel;
  readonly layer: AnnotationLayer;
  readonly backend: TextRendererAnnotationBackend;
  recreateLayer(mode?: TextRendererShapingMode, updateMode?: "scene" | "manual"): AnnotationLayer;
  addBox(name: string, position: readonly [number, number, number], color: readonly [number, number, number], size?: number): Mesh;
  frame(callback: (deltaMs: number) => void): void;
}

export interface TextDemoPanel {
  describe(value: string): void;
  status(value: string): void;
  button(label: string, callback: () => void): HTMLButtonElement;
  output(value: string): HTMLTextAreaElement;
}

const demo = document.body.dataset.demo;
const app = document.querySelector<HTMLDivElement>("#app");
if (!demo || !app) throw new Error("TextRenderer example is missing its demo name or app root");

createDemoNavigation(document, `textrender-${demo}`, new URL("../../", window.location.href));

const canvas = document.createElement("canvas");
canvas.setAttribute("aria-label", `${document.title} 3D viewport`);
app.className = "demo-stage";
app.append(canvas);
const panel = createPanel(document.title);

const engine = await createEngine(canvas).catch((error: unknown) => {
  panel.status("WebGPU unavailable");
  panel.describe("These examples require a browser with WebGPU enabled.");
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
  floor.position.y = -1.55;
  floor.scaling.x = 12;
  floor.scaling.y = 0.18;
  floor.scaling.z = 8;
  floor.material = material([0.07, 0.12, 0.105]);
  addToScene(scene, floor);

  await registerScene(scene);
  const font = await loadFont(new URL("./assets/InterVariable.ttf", import.meta.url).href);
  let activeLayer: AnnotationLayer | undefined;
  let activeBackend: TextRendererAnnotationBackend | undefined;
  let sceneUpdatesLayer = true;

  const recreateLayer = (mode: TextRendererShapingMode = "public", updateMode: "scene" | "manual" = "scene") => {
    if (activeLayer) disposeAnnotationLayer(activeLayer);
    activeBackend = createTextRendererAnnotationBackend({
      surface: scene.surface,
      font,
      shapingMode: mode,
      coverageGamma: 1.9,
      shapeCacheSize: 512,
      markerShapes: { "demo/star": rasterizeStar }
    });
    sceneUpdatesLayer = updateMode === "scene";
    activeLayer = createAnnotationLayer({ scene, camera, canvas, backend: activeBackend, updateMode: "manual", viewportPadding: 12 });
    return activeLayer;
  };
  recreateLayer();
  // Camera controls update during Lite's pre-render phase. Project after that
  // update so GPU text and scene geometry use the exact same camera matrix.
  onBeforeRender(scene, () => {
    if (sceneUpdatesLayer && activeLayer) updateAnnotationLayer(activeLayer);
  });

  const context: TextDemoContext = {
    engine,
    scene,
    camera,
    canvas,
    panel,
    get layer() {
      if (!activeLayer) throw new Error("TextRenderer annotation layer is not initialized");
      return activeLayer;
    },
    get backend() {
      if (!activeBackend) throw new Error("TextRenderer annotation backend is not initialized");
      return activeBackend;
    },
    recreateLayer,
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
    frame(callback) { onBeforeRender(scene, callback); }
  };

  await configureDemo(demo, context);
  panel.status("running");
  document.body.dataset.ready = "true";
  await startEngine(engine);
  window.addEventListener("beforeunload", () => {
    if (activeLayer) disposeAnnotationLayer(activeLayer);
  }, { once: true });
}

async function configureDemo(name: string, context: TextDemoContext): Promise<void> {
  if (name === "basic") return (await import("./basic/main.js")).configureBasicText(context);
  if (name === "callouts") return (await import("./callouts/main.js")).configureGpuCallouts(context);
  if (name === "animated-markers") return (await import("./animated-markers/main.js")).configureAnimatedGpuMarkers(context);
  if (name === "marker-shapes") return (await import("./marker-shapes/main.js")).configureGpuMarkerShapes(context);
  if (name === "marker-benchmark") return (await import("./marker-benchmark/main.js")).configureGpuMarkerBenchmark(context);
  if (name === "dynamic") return (await import("./dynamic/main.js")).configureDynamicText(context);
  if (name === "collisions") return (await import("./collisions/main.js")).configureTextCollisions(context);
  if (name === "stress") return (await import("./stress/main.js")).configureTextStress(context);
  throw new Error(`Unknown TextRenderer example '${name}'`);
}

function rasterizeStar({
  frameSize,
  fill
}: Parameters<TextRendererMarkerShapeRasterizer>[0]): Uint8Array {
  const pixels = new Uint8Array(frameSize * frameSize * 4);
  const vertices = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 0.46 : 0.2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  });
  for (let y = 0; y < frameSize; y++) {
    for (let x = 0; x < frameSize; x++) {
      const px = (x + 0.5) / frameSize - 0.5;
      const py = (y + 0.5) / frameSize - 0.5;
      let inside = false;
      for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
        const a = vertices[index]!;
        const b = vertices[previous]!;
        if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) {
          inside = !inside;
        }
      }
      if (!inside) continue;
      const offset = (y * frameSize + x) * 4;
      pixels[offset] = Math.round(fill[0] * fill[3] * 255);
      pixels[offset + 1] = Math.round(fill[1] * fill[3] * 255);
      pixels[offset + 2] = Math.round(fill[2] * fill[3] * 255);
      pixels[offset + 3] = Math.round(fill[3] * 255);
    }
  }
  return pixels;
}

function material(color: readonly [number, number, number]) {
  const result = createStandardMaterial();
  result.diffuseColor = [color[0], color[1], color[2]];
  result.specularColor = [0.05, 0.08, 0.07];
  return result;
}

function createPanel(title: string): TextDemoPanel {
  const root = document.createElement("section");
  root.className = "demo-panel";
  root.innerHTML = `
    <h1></h1><p class="description"></p>
    <div class="status-row">Status: <span class="status">initializing</span></div>
    <div class="controls"></div>`;
  root.querySelector("h1")!.textContent = title;
  document.body.append(root);
  const description = root.querySelector<HTMLElement>(".description")!;
  const status = root.querySelector<HTMLElement>(".status")!;
  const controls = root.querySelector<HTMLElement>(".controls")!;
  return {
    describe(value) { description.textContent = value; },
    status(value) { status.textContent = value; },
    button(label, callback) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", callback);
      controls.append(button);
      return button;
    },
    output(value) {
      let output = root.querySelector<HTMLTextAreaElement>(".benchmark-output");
      if (!output) {
        output = document.createElement("textarea");
        output.className = "benchmark-output";
        output.readOnly = true;
        output.setAttribute("aria-label", "Benchmark JSON");
        root.append(output);
      }
      output.value = value;
      output.hidden = false;
      return output;
    }
  };
}
