import {
  addToScene,
  attachControl,
  createDefaultCamera,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  loadEnvironment,
  onBeforeRender,
  registerScene,
  startEngine,
  type ArcRotateCamera,
  type EngineContext,
  type SceneContext
} from "@babylonjs/lite";
import type { Animator } from "@litools/animator";
import "./styles.css";

const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL =
  "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";

export interface ExampleApp {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly camera: ArcRotateCamera;
  readonly panel: ExamplePanel;
  start(): Promise<void>;
  watchAnimator(getAnimator: () => Animator | undefined): void;
}

export interface ExamplePanel {
  readonly root: HTMLElement;
  set(key: string, value: unknown): void;
  button(label: string, action: () => unknown): HTMLButtonElement;
  range(
    label: string,
    minimum: number,
    maximum: number,
    step: number,
    value: number,
    action: (value: number) => void
  ): HTMLInputElement;
  log(message: string): void;
}

export async function createExampleApp(
  title: string,
  description: string
): Promise<ExampleApp> {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) throw new Error("Missing #app");
  const canvas = document.createElement("canvas");
  root.append(canvas);
  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  scene.clearColor = { r: 0.02, g: 0.025, b: 0.04, a: 1 };
  addToScene(scene, createHemisphericLight([0, 1, 0], 1.2));
  const camera = createDefaultCamera(scene);
  attachControl(camera, canvas, scene);
  const panel = createPanel(title, description);
  document.body.append(panel.root);
  panel.set("status", "loading");
  await loadEnvironment(scene, ENVIRONMENT_URL, { brdfUrl: BRDF_URL });

  return {
    engine,
    scene,
    camera,
    panel,
    async start() {
      await registerScene(scene);
      panel.set("status", "running");
      await startEngine(engine);
    },
    watchAnimator(getAnimator) {
      let elapsed = 0;
      onBeforeRender(scene, (deltaMs) => {
        elapsed += deltaMs;
        if (elapsed < 120) return;
        elapsed = 0;
        const animator = getAnimator();
        if (!animator) return;
        import("@litools/animator").then(({ getAnimatorSnapshot }) => {
          const snapshot = getAnimatorSnapshot(animator);
          panel.set(
            "playbacks",
            snapshot.activePlaybacks
              .map(
                (playback) =>
                  `${playback.clipId} ${playback.time.toFixed(2)}s w=${playback.weight.toFixed(2)}`
              )
              .join(" · ") || "none"
          );
          panel.set(
            "transition",
            snapshot.transition
              ? `${snapshot.transition.sources.join("+")} → ${snapshot.transition.destinationClipId} ${Math.round(snapshot.transition.progress * 100)}%`
              : "none"
          );
        });
      });
    }
  };
}

function createPanel(title: string, description: string): ExamplePanel {
  const root = document.createElement("section");
  root.className = "panel";
  const home = document.createElement("a");
  home.href = "../";
  home.textContent = "← Animator examples";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  const values = document.createElement("dl");
  const controls = document.createElement("div");
  controls.className = "controls";
  const log = document.createElement("pre");
  log.textContent = "Event log";
  const outputs = new Map<string, HTMLElement>();
  root.append(home, heading, copy, values, controls, log);
  for (const name of ["pointerdown", "pointerup", "click"]) {
    root.addEventListener(name, (event) => event.stopPropagation());
  }
  const writeLog = (message: string): void => {
    const time = new Date().toLocaleTimeString();
    log.textContent = `${time}  ${message}\n${log.textContent}`.slice(0, 5000);
  };
  return {
    root,
    set(key, value) {
      let output = outputs.get(key);
      if (!output) {
        const term = document.createElement("dt");
        output = document.createElement("dd");
        term.textContent = key;
        values.append(term, output);
        outputs.set(key, output);
      }
      output.textContent = String(value);
    },
    button(label, action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        Promise.resolve(action()).catch((error) => writeLog(`ERROR ${String(error)}`));
      });
      controls.append(button);
      return button;
    },
    range(label, minimum, maximum, step, value, action) {
      const row = document.createElement("label");
      const name = document.createElement("span");
      const input = document.createElement("input");
      const output = document.createElement("output");
      name.textContent = label;
      input.type = "range";
      input.min = String(minimum);
      input.max = String(maximum);
      input.step = String(step);
      input.value = String(value);
      output.value = String(value);
      input.addEventListener("input", () => {
        output.value = input.value;
        action(Number(input.value));
      });
      row.append(name, input, output);
      root.insertBefore(row, log);
      return input;
    },
    log: writeLog
  };
}
