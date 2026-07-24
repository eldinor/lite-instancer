import { createHtmlAnnotationBackend } from "../../../src/html.js";
import type { AnnotationBackend, BackendAnnotationDefinition } from "../../../src/types.js";

const container = document.querySelector<HTMLElement>("#container")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const backend = createHtmlAnnotationBackend({ container, rootClassName: "fixture-root" });

const labelDefinition: BackendAnnotationDefinition = {
  id: 1 as never,
  type: "label",
  text: "Pump A-12",
  zIndex: 4,
  style: {
    color: "#ffffff",
    backgroundColor: "#243447",
    padding: 4,
    borderRadius: 3,
    className: "fixture-label"
  },
  ariaLabel: "Pump A-12 status",
  role: "note"
};
const markerDefinition: BackendAnnotationDefinition = {
  id: 2 as never,
  type: "marker",
  shape: "ring",
  size: 18,
  zIndex: 3,
  style: { color: "#00ff88", borderWidth: 2 }
};
const label = backend.create(labelDefinition);
const marker = backend.create(markerDefinition);

function align(): void {
  const rect = canvas.getBoundingClientRect();
  backend.setViewport({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  backend.update(label, {
    ...labelDefinition,
    definitionChanged: true,
    rendered: true,
    screenPosition: { x: 100, y: 50 }
  });
  backend.update(marker, {
    ...markerDefinition,
    definitionChanged: true,
    rendered: true,
    screenPosition: { x: 30, y: 30 }
  });
}

align();

declare global {
  interface Window {
    annotatorFixture: {
      backend: AnnotationBackend;
      align(): void;
      dispose(): void;
    };
  }
}

window.annotatorFixture = {
  backend,
  align,
  dispose: () => backend.dispose()
};
