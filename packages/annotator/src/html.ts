import { AnnotatorError } from "./error.js";
import type {
  AnnotationBackend,
  AnnotationId,
  AnnotationStyle,
  AnnotationViewport,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  BackendBounds
} from "./types.js";

export interface HtmlAnnotationBackendOptions {
  container: HTMLElement;
  rootClassName?: string;
  /** Makes label elements pointer/keyboard activatable in the HTML backend. */
  onLabelActivate?: (
    annotationId: AnnotationId,
    event: MouseEvent | KeyboardEvent
  ) => void;
}

interface HtmlResource {
  readonly element: HTMLElement;
  leaderLine: SVGLineElement | undefined;
  className: string | undefined;
  screenPosition: Readonly<{ x: number; y: number }> | null;
  measurementDirty: boolean;
  measuredWidth: number;
  measuredHeight: number;
  measuredOffsetX: number;
  measuredOffsetY: number;
  interactive: boolean;
  disposed: boolean;
}

/** Create the browser DOM backend. The caller retains ownership of `container`. */
export function createHtmlAnnotationBackend(options: HtmlAnnotationBackendOptions): AnnotationBackend {
  const document = options.container.ownerDocument;
  const root = document.createElement("div");
  root.className = options.rootClassName
    ? `litools-annotator-root ${options.rootClassName}`
    : "litools-annotator-root";
  Object.assign(root.style, {
    position: "absolute",
    overflow: "hidden",
    pointerEvents: "none",
    margin: "0",
    padding: "0",
    border: "0",
    boxSizing: "border-box",
    isolation: "isolate"
  });
  const leaderLineLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaderLineLayer.setAttribute("aria-hidden", "true");
  leaderLineLayer.setAttribute("width", "100%");
  leaderLineLayer.setAttribute("height", "100%");
  Object.assign(leaderLineLayer.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "-2147483648"
  });
  root.append(leaderLineLayer);
  options.container.append(root);
  const resources = new Set<HtmlResource>();
  let disposed = false;
  let viewportWidth = -1;
  let viewportHeight = -1;

  return {
    create(definition) {
      assertUsable();
      const element = document.createElement(definition.type === "label" ? "div" : "span");
      element.dataset.annotationId = String(definition.id);
      element.dataset.annotationType = definition.type;
      Object.assign(element.style, {
        position: "absolute",
        left: "0",
        top: "0",
        boxSizing: "border-box",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        transformOrigin: "center",
        whiteSpace: "nowrap"
      });
      const resource: HtmlResource = {
        element,
        leaderLine: undefined,
        className: undefined,
        screenPosition: null,
        measurementDirty: true,
        measuredWidth: 0,
        measuredHeight: 0,
        measuredOffsetX: 0,
        measuredOffsetY: 0,
        interactive: definition.type === "label" && options.onLabelActivate !== undefined,
        disposed: false
      };
      resources.add(resource);
      root.append(element);
      applyDefinition(resource, definition);
      applyLeaderLineDefinition(resource, definition, document, leaderLineLayer);
      if (resource.interactive) {
        element.style.pointerEvents = "auto";
        element.style.cursor = "pointer";
        element.tabIndex = 0;
        element.addEventListener("click", (event) => {
          options.onLabelActivate?.(definition.id, event as MouseEvent);
        });
        element.addEventListener("keydown", (event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
          keyboardEvent.preventDefault();
          options.onLabelActivate?.(definition.id, keyboardEvent);
        });
      }
      element.hidden = true;
      return resource;
    },
    update(resource, update) {
      assertUsable();
      const html = requireResource(resource);
      if (update.definitionChanged) {
        applyDefinition(html, update);
        applyLeaderLineDefinition(html, update, document, leaderLineLayer);
        html.measurementDirty = true;
      }
      html.element.hidden = !update.rendered;
      html.screenPosition = update.screenPosition;
      if (update.rendered && update.screenPosition) {
        html.element.style.left = `${update.screenPosition.x}px`;
        html.element.style.top = `${update.screenPosition.y}px`;
      }
      applyLeaderLineGeometry(html, update.rendered ? update.leaderLineGeometry ?? null : null);
    },
    measure(resource): BackendBounds | null {
      assertUsable();
      const html = requireResource(resource);
      const position = html.screenPosition;
      if (html.element.hidden || !position) return null;
      if (html.measurementDirty) {
        const elementRect = html.element.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        html.measuredWidth = elementRect.width;
        html.measuredHeight = elementRect.height;
        html.measuredOffsetX = elementRect.left - rootRect.left - position.x;
        html.measuredOffsetY = elementRect.top - rootRect.top - position.y;
        html.measurementDirty = false;
      }
      return {
        x: position.x + html.measuredOffsetX,
        y: position.y + html.measuredOffsetY,
        width: html.measuredWidth,
        height: html.measuredHeight
      };
    },
    setViewport(viewport) {
      assertUsable();
      if (viewport.width !== viewportWidth || viewport.height !== viewportHeight) {
        viewportWidth = viewport.width;
        viewportHeight = viewport.height;
        for (const resource of resources) resource.measurementDirty = true;
      }
      alignRoot(options.container, root, viewport);
    },
    disposeResource(resource) {
      if (!isResource(resource) || resource.disposed) return;
      resource.leaderLine?.remove();
      resource.element.remove();
      resource.disposed = true;
      resources.delete(resource);
    },
    dispose() {
      if (disposed) return;
      for (const resource of resources) {
        resource.leaderLine?.remove();
        resource.element.remove();
        resource.disposed = true;
      }
      resources.clear();
      root.remove();
      disposed = true;
    }
  };

  function assertUsable(): void {
    if (disposed) throw new AnnotatorError("HTML annotation backend has been disposed");
  }
}

function alignRoot(container: HTMLElement, root: HTMLElement, viewport: AnnotationViewport): void {
  const containerRect = container.getBoundingClientRect();
  root.style.left = `${viewport.left - containerRect.left + container.scrollLeft - container.clientLeft}px`;
  root.style.top = `${viewport.top - containerRect.top + container.scrollTop - container.clientTop}px`;
  root.style.width = `${viewport.width}px`;
  root.style.height = `${viewport.height}px`;
}

function applyDefinition(resource: HtmlResource, definition: BackendAnnotationDefinition | BackendAnnotationUpdate): void {
  const element = resource.element;
  if (definition.type === "label") {
    element.textContent = definition.text ?? "";
  } else {
    element.textContent = "";
    element.dataset.markerShape = definition.shape ?? "dot";
    const size = definition.size ?? 12;
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.borderRadius = "50%";
    if (definition.shape === "ring") {
      element.style.backgroundColor = "transparent";
      element.style.borderStyle = "solid";
      element.style.borderWidth = `${definition.style.borderWidth ?? 2}px`;
      element.style.borderColor = definition.style.borderColor ?? definition.style.color ?? "#ffffff";
    } else {
      element.style.borderStyle = definition.style.borderWidth ? "solid" : "none";
      element.style.backgroundColor = definition.style.backgroundColor ?? definition.style.color ?? "#ffffff";
    }
  }
  element.style.zIndex = String(definition.zIndex);
  applyStyle(element, definition.style);
  applyClassName(resource, definition.style.className);
  if (definition.ariaLabel !== undefined) element.setAttribute("aria-label", definition.ariaLabel);
  else element.removeAttribute("aria-label");
  if (definition.role !== undefined) element.setAttribute("role", definition.role);
  else if (resource.interactive) element.setAttribute("role", "button");
  else element.removeAttribute("role");
}

function applyLeaderLineDefinition(
  resource: HtmlResource,
  definition: BackendAnnotationDefinition | BackendAnnotationUpdate,
  document: Document,
  layer: SVGSVGElement
): void {
  const options = definition.type === "label" ? definition.leaderLine : undefined;
  if (!options) {
    resource.leaderLine?.remove();
    resource.leaderLine = undefined;
    return;
  }
  const line = resource.leaderLine ?? document.createElementNS("http://www.w3.org/2000/svg", "line");
  if (!resource.leaderLine) {
    line.dataset.annotationLeaderLine = String(definition.id);
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("stroke-linecap", "round");
    line.style.display = "none";
    layer.append(line);
    resource.leaderLine = line;
  }
  line.setAttribute("stroke", options.color ?? definition.style.borderColor ?? definition.style.color ?? "#ffffff");
  line.setAttribute("stroke-width", String(options.width ?? 1));
  line.setAttribute("opacity", String(options.opacity ?? 1));
}

function applyLeaderLineGeometry(
  resource: HtmlResource,
  geometry: BackendAnnotationUpdate["leaderLineGeometry"] | null
): void {
  const line = resource.leaderLine;
  if (!line || !geometry) {
    if (line) line.style.display = "none";
    return;
  }
  line.setAttribute("x1", String(geometry.start.x));
  line.setAttribute("y1", String(geometry.start.y));
  line.setAttribute("x2", String(geometry.end.x));
  line.setAttribute("y2", String(geometry.end.y));
  line.style.display = "";
}

function applyStyle(element: HTMLElement, style: Readonly<AnnotationStyle>): void {
  element.style.color = style.color ?? "";
  if (element.dataset.annotationType === "label") element.style.backgroundColor = style.backgroundColor ?? "";
  element.style.opacity = style.opacity === undefined ? "" : String(style.opacity);
  element.style.transitionProperty = style.opacityTransitionDuration ? "opacity" : "";
  element.style.transitionDuration =
    style.opacityTransitionDuration === undefined ? "" : `${style.opacityTransitionDuration}ms`;
  element.style.transitionTimingFunction = style.opacityTransitionDuration ? "ease" : "";
  element.style.fontSize = style.fontSize === undefined ? "" : `${style.fontSize}px`;
  element.style.fontWeight = style.fontWeight === undefined ? "" : String(style.fontWeight);
  if (element.dataset.annotationType === "label") {
    element.style.borderColor = style.borderColor ?? "";
    element.style.borderStyle = style.borderWidth ? "solid" : "";
    element.style.borderWidth = style.borderWidth === undefined ? "" : `${style.borderWidth}px`;
  }
  if (element.dataset.annotationType === "label" || style.borderRadius !== undefined) {
    element.style.borderRadius = style.borderRadius === undefined ? "" : `${style.borderRadius}px`;
  }
  if (element.dataset.annotationType === "label" || style.padding !== undefined) {
    element.style.padding = style.padding === undefined ? "" : `${style.padding}px`;
  }
}

function applyClassName(resource: HtmlResource, next: string | undefined): void {
  if (resource.className) {
    for (const className of resource.className.split(/\s+/).filter(Boolean)) resource.element.classList.remove(className);
  }
  if (next) {
    for (const className of next.split(/\s+/).filter(Boolean)) resource.element.classList.add(className);
  }
  resource.className = next;
}

function requireResource(resource: unknown): HtmlResource {
  if (!isResource(resource) || resource.disposed) throw new AnnotatorError("Unknown or disposed HTML annotation resource");
  return resource;
}

function isResource(resource: unknown): resource is HtmlResource {
  return typeof resource === "object" && resource !== null && "element" in resource && "disposed" in resource;
}
