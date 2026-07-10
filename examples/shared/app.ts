import * as liteRuntime from "@babylonjs/lite";
import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createEngine,
  createGpuPicker,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  pickAsync,
  registerScene,
  startEngine,
  vec3,
  type EngineContext,
  type GpuPicker,
  type Mesh,
  type SceneContext,
  type SceneNode,
  type StandardMaterialProps
} from "@babylonjs/lite";
import { showLiteExplorer, type LiteExplorerHandle } from "babylon-lite-explorer";
import { PickingRegistry, type InstancePick } from "../../src/index.js";
import "./styles.css";

export interface ExampleContext {
  canvas: HTMLCanvasElement;
  engine: EngineContext;
  scene: SceneContext;
  picker: GpuPicker;
  registry: PickingRegistry;
  panel: DebugPanel;
}

export interface DebugPanel {
  root: HTMLElement;
  set(key: string, value: unknown): void;
  button(label: string, onClick: () => void): HTMLButtonElement;
}

export async function createExample(title: string): Promise<ExampleContext> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app");
  }

  const canvas = document.createElement("canvas");
  app.append(canvas);

  const panel = createPanel(title);
  document.body.append(panel.root);

  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  scene.clearColor = { r: 0.025, g: 0.028, b: 0.034, a: 1 };

  const camera = createArcRotateCamera(-Math.PI / 4, Math.PI / 3.2, 34, vec3(0, 0, 0));
  scene.camera = camera;
  addToScene(scene, camera);
  attachControl(camera, canvas, scene);
  addToScene(scene, createHemisphericLight([0, 1, 0], 1.1));

  const picker = createGpuPicker(scene);
  const registry = new PickingRegistry();

  panel.set("status", "initializing");
  panel.set("selected", "-");

  return { canvas, engine, scene, picker, registry, panel };
}

export async function runExample(ctx: ExampleContext): Promise<void> {
  await registerScene(ctx.scene);
  const explorer = showLiteExplorer(
    { engine: ctx.engine, scene: ctx.scene, canvas: ctx.canvas, lite: liteRuntime },
    {
      mode: "overlay",
      layout: "single",
      theme: "dark",
      initiallyOpen: false,
      notificationsEnabled: false,
      features: { focusSelected: true, canvasPicking: false },
      title: "Lite Explorer"
    }
  );
  attachExplorerButton(ctx.panel, explorer);
  ctx.panel.set("status", "running");
  await startEngine(ctx.engine);
}

function attachExplorerButton(panel: DebugPanel, explorer: LiteExplorerHandle): void {
  let open = false;
  panel.button("explorer", () => {
    open = !open;
    if (open) {
      explorer.show();
      void explorer.refresh();
      return;
    }
    explorer.hide();
  });
}

export function createPanel(title: string): DebugPanel {
  const root = document.createElement("section");
  root.className = "panel";
  const homeLink = document.createElement("a");
  homeLink.className = "panel-home";
  homeLink.href = "/";
  homeLink.textContent = "Examples";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const list = document.createElement("dl");
  const controls = document.createElement("div");
  controls.className = "controls";
  const values = new Map<string, HTMLElement>();

  root.append(homeLink, heading, list, controls);
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("pointerup", (event) => event.stopPropagation());
  root.addEventListener("click", (event) => event.stopPropagation());

  return {
    root,
    set(key, value) {
      let output = values.get(key);
      if (!output) {
        const label = document.createElement("dt");
        output = document.createElement("dd");
        label.textContent = key;
        list.append(label, output);
        values.set(key, output);
      }
      output.textContent = String(value);
    },
    button(label, onClick) {
      const button = document.createElement("button");
      button.textContent = label;
      button.type = "button";
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      controls.append(button);
      return button;
    }
  };
}

export function material(color: readonly [number, number, number]): StandardMaterialProps {
  const mat = createStandardMaterial();
  mat.diffuseColor = [color[0], color[1], color[2]];
  mat.specularColor = [0.08, 0.08, 0.08];
  return mat;
}

export function addMesh(scene: SceneContext, mesh: Mesh, color: readonly [number, number, number]): Mesh {
  mesh.material = material(color);
  addToScene(scene, mesh);
  return mesh;
}

export function collectMeshes(root: SceneNode): Mesh[] {
  const meshes: Mesh[] = [];
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (isMesh(node)) {
      meshes.push(node);
    }
    stack.push(...node.children);
  }
  return meshes;
}

export function makeMatrix(
  x: number,
  y: number,
  z: number,
  scale: number | readonly [number, number, number] = 1,
  yaw = 0,
  pitch = 0,
  roll = 0
) {
  return {
    position: [x, y, z] as [number, number, number],
    rotationEuler: [pitch, yaw, roll] as [number, number, number],
    scale
  };
}

export function colorFromIndex(index: number, alpha = 1): [number, number, number, number] {
  const hue = (index * 0.61803398875) % 1;
  const [r, g, b] = hsvToRgb(hue, 0.62, 0.96);
  return [r, g, b, alpha];
}

export async function pickInstance(ctx: ExampleContext, event: PointerEvent): Promise<InstancePick | undefined> {
  const rect = ctx.canvas.getBoundingClientRect();
  const pick = await pickAsync(ctx.picker, event.clientX - rect.left, event.clientY - rect.top);
  const mesh = pick.pickedMesh && "material" in pick.pickedMesh ? pick.pickedMesh : null;
  return ctx.registry.fromPick({
    mesh,
    thinInstanceIndex: pick.thinInstanceIndex,
    hasThinInstance: pick.thinInstanceIndex >= 0
  });
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function isMesh(node: SceneNode): node is Mesh {
  return "_gpu" in node && "material" in node;
}
