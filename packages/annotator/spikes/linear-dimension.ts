import type { Mat4 } from "@babylonjs/lite";
import { projectAnnotationPosition } from "../src/projection.js";
import type { AnnotationViewport, Vec3Like } from "../src/types.js";

/**
 * Non-shipping feasibility spike: compose two projected endpoints, a CSS line,
 * two arrowheads, and a text element without extending the 0.1 annotation model.
 */
export function renderLinearDimensionSpike(options: {
  container: HTMLElement;
  start: Vec3Like;
  end: Vec3Like;
  viewProjection: Mat4;
  viewport: AnnotationViewport;
  cameraPosition: Vec3Like;
  text: string;
}): () => void {
  const start = projectAnnotationPosition({
    position: options.start,
    viewProjection: options.viewProjection,
    viewport: options.viewport,
    cameraPosition: options.cameraPosition
  });
  const end = projectAnnotationPosition({
    position: options.end,
    viewProjection: options.viewProjection,
    viewport: options.viewport,
    cameraPosition: options.cameraPosition
  });
  const group = options.container.ownerDocument.createElement("div");
  const line = options.container.ownerDocument.createElement("div");
  const startArrow = options.container.ownerDocument.createElement("span");
  const endArrow = options.container.ownerDocument.createElement("span");
  const label = options.container.ownerDocument.createElement("span");
  const dx = end.screenPosition.x - start.screenPosition.x;
  const dy = end.screenPosition.y - start.screenPosition.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  Object.assign(group.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  Object.assign(line.style, {
    position: "absolute",
    left: `${start.screenPosition.x}px`,
    top: `${start.screenPosition.y}px`,
    width: `${length}px`,
    borderTop: "1px solid currentColor",
    transform: `rotate(${angle}rad)`,
    transformOrigin: "left center"
  });
  for (const [arrow, point, rotation] of [
    [startArrow, start.screenPosition, angle] as const,
    [endArrow, end.screenPosition, angle + Math.PI] as const
  ]) {
    arrow.textContent = "◀";
    Object.assign(arrow.style, {
      position: "absolute",
      left: `${point.x}px`,
      top: `${point.y}px`,
      transform: `translate(-50%, -50%) rotate(${rotation}rad)`
    });
  }
  label.textContent = options.text;
  Object.assign(label.style, {
    position: "absolute",
    left: `${(start.screenPosition.x + end.screenPosition.x) / 2}px`,
    top: `${(start.screenPosition.y + end.screenPosition.y) / 2}px`,
    transform: "translate(-50%, -50%)"
  });
  group.append(line, startArrow, endArrow, label);
  options.container.append(group);
  return () => group.remove();
}
