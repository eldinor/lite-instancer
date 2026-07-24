import { AnnotatorError } from "./error.js";
import type {
  AnnotationBackend,
  AnnotationStyle,
  AnnotationViewport,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  BackendBounds
} from "./types.js";

export interface HtmlAnnotationBackendOptions {
  container: HTMLElement;
  rootClassName?: string;
}

interface HtmlResource {
  readonly element: HTMLElement;
  className: string | undefined;
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
    boxSizing: "border-box"
  });
  options.container.append(root);
  const resources = new Set<HtmlResource>();
  let disposed = false;

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
      const resource: HtmlResource = { element, className: undefined, disposed: false };
      resources.add(resource);
      root.append(element);
      applyDefinition(resource, definition);
      element.hidden = true;
      return resource;
    },
    update(resource, update) {
      assertUsable();
      const html = requireResource(resource);
      if (update.definitionChanged) applyDefinition(html, update);
      html.element.hidden = !update.rendered;
      if (update.rendered && update.screenPosition) {
        html.element.style.left = `${update.screenPosition.x}px`;
        html.element.style.top = `${update.screenPosition.y}px`;
      }
    },
    measure(resource): BackendBounds | null {
      assertUsable();
      const html = requireResource(resource);
      if (html.element.hidden) return null;
      const elementRect = html.element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        x: elementRect.left - rootRect.left,
        y: elementRect.top - rootRect.top,
        width: elementRect.width,
        height: elementRect.height
      };
    },
    setViewport(viewport) {
      assertUsable();
      alignRoot(options.container, root, viewport);
    },
    disposeResource(resource) {
      if (!isResource(resource) || resource.disposed) return;
      resource.element.remove();
      resource.disposed = true;
      resources.delete(resource);
    },
    dispose() {
      if (disposed) return;
      for (const resource of resources) {
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
  else element.removeAttribute("role");
}

function applyStyle(element: HTMLElement, style: Readonly<AnnotationStyle>): void {
  element.style.color = style.color ?? "";
  if (element.dataset.annotationType === "label") element.style.backgroundColor = style.backgroundColor ?? "";
  element.style.opacity = style.opacity === undefined ? "" : String(style.opacity);
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
