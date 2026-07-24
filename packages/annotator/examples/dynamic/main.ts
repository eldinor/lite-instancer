import {
  createLabel,
  invalidateAnnotation,
  updateAnnotationLayer
} from "@litools/annotator";
import type { DemoContext } from "../shared/demo.js";

export function configureDynamic(ctx: DemoContext): void {
  const layer = ctx.recreateLayer("manual");
  ctx.panel.describe("Callback text is refreshed explicitly. Manual layer updates run inside the scene frame callback.");

  const motor = ctx.addBox("Motor M-4", [-2.2, -0.2, 0], [0.12, 0.5, 0.42], 2.5);
  const controller = ctx.addBox("Controller", [2.2, -0.45, 0], [0.28, 0.35, 0.65], 2);
  let temperature = 68.4;
  let load = 42;
  let paused = false;

  const temperatureLabel = createLabel(layer, {
    anchor: { kind: "mesh", mesh: motor, point: [0, 1.45, 0] },
    text: () => `${temperature.toFixed(1)} °C`,
    screenOffset: [0, -8],
    style: {
      color: "#f2fffb",
      backgroundColor: "#0b1815ee",
      borderColor: "#5bf0bd",
      borderWidth: 1,
      borderRadius: 7,
      padding: 8,
      className: "annotation-label annotation-label--live"
    }
  });
  const loadLabel = createLabel(layer, {
    anchor: { kind: "mesh", mesh: controller, point: [0, 1.2, 0] },
    text: () => `Load ${load.toFixed(0)}%`,
    screenOffset: [0, -8],
    style: {
      color: "#e6f7ff",
      backgroundColor: "#0b151bee",
      borderColor: "#71d7ff",
      borderWidth: 1,
      borderRadius: 7,
      padding: 8,
      className: "annotation-label annotation-label--cyan"
    }
  });
  ctx.panel.button("Pause / resume data", () => {
    paused = !paused;
    ctx.panel.status(paused ? "data paused" : "live updates");
  });
  ctx.panel.button("Add heat spike", () => {
    temperature += 12;
    invalidateAnnotation(temperatureLabel);
    ctx.panel.status("temperature spike injected");
  });

  let elapsed = 0;
  let refreshElapsed = 0;
  ctx.frame((deltaMs) => {
    elapsed += deltaMs / 1000;
    refreshElapsed += deltaMs;
    motor.rotation.y += deltaMs * 0.00015;
    controller.position.y = -0.45 + Math.sin(elapsed * 1.3) * 0.1;
    if (!paused && refreshElapsed >= 120) {
      refreshElapsed = 0;
      temperature += (70 + Math.sin(elapsed * 1.7) * 7 - temperature) * 0.18;
      load = 52 + Math.sin(elapsed * 1.05) * 31;
      invalidateAnnotation(temperatureLabel);
      invalidateAnnotation(loadLabel);
    }
    updateAnnotationLayer(layer);
  });
}
