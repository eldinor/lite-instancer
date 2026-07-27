import { AnnotatorError } from "./error.js";
import {
  getInternalAnnotationHitRegion,
  observeAnnotationHitRegions,
  type InternalAnnotationHitRegion
} from "./core.js";
import type { AnnotationHandle, AnnotationLayer, MarkerShape } from "./types.js";

export type AnnotationInteractionEventType =
  | "pointerdown"
  | "pointerup"
  | "click"
  | "doubleclick"
  | "contextmenu"
  | "hoverstart"
  | "hovermove"
  | "hoverend";

export type AnnotationPointerType = "mouse" | "touch" | "pen";

export interface AnnotationClickThreshold {
  readonly maxDistance?: number;
  readonly maxDuration?: number;
}

export interface AnnotationInteractionManagerOptions {
  readonly layer: AnnotationLayer;
  readonly canvas: HTMLCanvasElement;
  /** Coalesce mouse/pen hover to the newest pointer sample per frame. @default true */
  readonly hover?: boolean;
  /** Uniform spatial-hash cell size in CSS pixels. @default 64 */
  readonly cellSize?: number;
  /** Default target hit expansion in CSS pixels. @default 0 */
  readonly hitSlop?: number;
  readonly click?: {
    readonly mouse?: AnnotationClickThreshold;
    readonly touch?: AnnotationClickThreshold;
    readonly pen?: AnnotationClickThreshold;
  };
  readonly doubleClickDelay?: number;
  readonly preventPointerDefault?: boolean;
  readonly preventContextMenu?: boolean;
  readonly onError?: (error: unknown, context: AnnotationInteractionErrorContext) => void;
}

export interface InteractiveAnnotationOptions {
  readonly enabled?: boolean;
  readonly hitSlop?: number;
}

export interface AnnotationInteractionErrorContext {
  readonly phase: "listener";
  readonly eventType: AnnotationInteractionEventType;
}

export interface AnnotationInteractionEvent {
  readonly type: AnnotationInteractionEventType;
  readonly target: InteractiveAnnotationTarget;
  readonly annotation: AnnotationHandle;
  readonly pointerId: number;
  readonly pointerType: AnnotationPointerType;
  readonly button: number;
  readonly buttons: number;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly timeStamp: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  stopPropagation(): void;
}

export type AnnotationInteractionListener = (event: AnnotationInteractionEvent) => void;

export interface AnnotationInteractionDiagnostics {
  readonly registeredTargets: number;
  readonly indexedTargets: number;
  readonly gridCells: number;
  readonly indexRebuilds: number;
  readonly incrementalIndexUpdates: number;
  readonly regionUpdates: number;
  readonly picks: number;
  readonly hits: number;
  readonly lastCandidates: number;
  readonly maximumCandidates: number;
  readonly candidateTests: number;
  readonly hoverSamples: number;
  readonly coalescedHoverSamples: number;
}

export interface AnnotationInteractionManager {
  readonly __annotationInteractionManagerBrand: never;
}

export interface InteractiveAnnotationTarget {
  readonly annotation: AnnotationHandle;
  readonly __interactiveAnnotationTargetBrand: never;
}

interface PointerSnapshot {
  pointerId: number;
  pointerType: AnnotationPointerType;
  button: number;
  buttons: number;
  x: number;
  y: number;
  timeStamp: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface PointerSession {
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  readonly downTarget: TargetImpl | null;
  maxDistanceSquared: number;
}

interface MutableRegion {
  active: boolean;
  rendered: boolean;
  type: "label" | "marker";
  shape: MarkerShape | null;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type ListenerMap = Map<AnnotationInteractionEventType, Set<AnnotationInteractionListener>>;

const DEFAULT_THRESHOLDS: Record<AnnotationPointerType, Required<AnnotationClickThreshold>> = {
  mouse: { maxDistance: 4, maxDuration: 500 },
  pen: { maxDistance: 4, maxDuration: 500 },
  touch: { maxDistance: 12, maxDuration: 700 }
};

class TargetImpl {
  readonly annotation: AnnotationHandle;
  readonly manager: ManagerImpl;
  readonly listeners: ListenerMap = new Map();
  readonly hitSlop: number;
  readonly region: MutableRegion;
  active = true;
  enabled: boolean;
  publicHandle: InteractiveAnnotationTarget | null = null;
  readonly cellKeys: string[] = [];
  indexed = false;

  constructor(manager: ManagerImpl, annotation: AnnotationHandle, options: InteractiveAnnotationOptions) {
    this.manager = manager;
    this.annotation = annotation;
    this.enabled = options.enabled ?? true;
    this.hitSlop = options.hitSlop ?? manager.defaultHitSlop;
    const source = getInternalAnnotationHitRegion(annotation);
    if (source.layer !== manager.options.layer) {
      throw new AnnotatorError("Interactive annotation belongs to a different annotation layer");
    }
    if (!source.active) throw new AnnotatorError("Disposed annotation cannot be registered for interaction");
    this.region = copyRegion(source);
  }
}

class ManagerImpl {
  readonly options: AnnotationInteractionManagerOptions;
  readonly defaultHitSlop: number;
  readonly cellSize: number;
  readonly targets = new Map<AnnotationHandle, TargetImpl>();
  readonly globalListeners: ListenerMap = new Map();
  readonly cells = new Map<string, TargetImpl[]>();
  readonly dirtyTargets = new Set<TargetImpl>();
  readonly pointers = new Map<number, PointerSession>();
  readonly #removeDomListeners: Array<() => void> = [];
  readonly #unobserve: () => void;
  enabled = true;
  disposed = false;
  indexDirty = true;
  indexedTargets = 0;
  hovered: { target: TargetImpl; snapshot: PointerSnapshot } | null = null;
  pendingHover: PointerSnapshot | null = null;
  hoverFrame: number | undefined;
  lastClick: { target: TargetImpl; x: number; y: number; timeStamp: number; pointerType: AnnotationPointerType } | null = null;
  indexRebuilds = 0;
  incrementalIndexUpdates = 0;
  regionUpdates = 0;
  picks = 0;
  hits = 0;
  lastCandidates = 0;
  maximumCandidates = 0;
  candidateTests = 0;
  hoverSamples = 0;
  coalescedHoverSamples = 0;

  constructor(options: AnnotationInteractionManagerOptions) {
    this.options = options;
    this.cellSize = options.cellSize ?? 64;
    this.defaultHitSlop = options.hitSlop ?? 0;
    assertPositive(this.cellSize, "Interaction cell size");
    assertNonNegative(this.defaultHitSlop, "Interaction hit slop");
    assertNonNegative(options.doubleClickDelay ?? 400, "Double-click delay");
    for (const pointerType of ["mouse", "touch", "pen"] as const) {
      const threshold = options.click?.[pointerType];
      if (threshold?.maxDistance !== undefined) {
        assertNonNegative(threshold.maxDistance, `${pointerType} click distance`);
      }
      if (threshold?.maxDuration !== undefined) {
        assertNonNegative(threshold.maxDuration, `${pointerType} click duration`);
      }
    }
    this.#unobserve = observeAnnotationHitRegions(options.layer, this.#onRegion);
    this.#listen("pointerdown", this.#onPointerDown);
    this.#listen("pointerup", this.#onPointerUp);
    this.#listen("pointermove", this.#onPointerMove);
    this.#listen("pointercancel", this.#onPointerCancel);
    this.#listen("pointerleave", this.#onPointerLeave);
    this.#listen("contextmenu", this.#onContextMenu);
  }

  register(annotation: AnnotationHandle, options: InteractiveAnnotationOptions): TargetImpl {
    this.#assertUsable();
    if (this.targets.has(annotation)) throw new AnnotatorError("Annotation is already registered for interaction");
    assertNonNegative(options.hitSlop ?? this.defaultHitSlop, "Interaction hit slop");
    const target = new TargetImpl(this, annotation, options);
    this.targets.set(annotation, target);
    this.#markTargetDirty(target);
    return target;
  }

  disposeTarget(target: TargetImpl): void {
    if (!target.active) return;
    if (this.hovered?.target === target) this.#clearHover();
    target.active = false;
    target.listeners.clear();
    this.targets.delete(target.annotation);
    for (const [pointerId, session] of this.pointers) {
      if (session.downTarget === target) this.pointers.delete(pointerId);
    }
    if (this.lastClick?.target === target) this.lastClick = null;
    this.#markTargetDirty(target);
  }

  setEnabled(enabled: boolean): void {
    this.#assertUsable();
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.pointers.clear();
    this.lastClick = null;
    this.#cancelHoverFrame();
    if (!enabled) this.#clearHover();
  }

  setTargetEnabled(target: TargetImpl, enabled: boolean): void {
    this.#requireTarget(target);
    if (target.enabled === enabled) return;
    target.enabled = enabled;
    if (!enabled) {
      if (this.hovered?.target === target) this.#clearHover();
      for (const [pointerId, session] of this.pointers) {
        if (session.downTarget === target) this.pointers.delete(pointerId);
      }
      if (this.lastClick?.target === target) this.lastClick = null;
    }
    this.#markTargetDirty(target);
  }

  dispose(): void {
    if (this.disposed) return;
    this.#clearHover();
    this.disposed = true;
    this.enabled = false;
    this.#cancelHoverFrame();
    for (const remove of this.#removeDomListeners) remove();
    this.#removeDomListeners.length = 0;
    this.#unobserve();
    for (const target of this.targets.values()) {
      target.active = false;
      target.listeners.clear();
    }
    this.targets.clear();
    this.globalListeners.clear();
    this.cells.clear();
    this.dirtyTargets.clear();
    this.pointers.clear();
    this.lastClick = null;
  }

  pick(x: number, y: number): TargetImpl | null {
    this.#assertUsable();
    this.#syncIndex();
    this.picks++;
    const candidates = this.cells.get(cellKey(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize))) ?? [];
    this.lastCandidates = candidates.length;
    this.maximumCandidates = Math.max(this.maximumCandidates, candidates.length);
    this.candidateTests += candidates.length;
    let winner: TargetImpl | null = null;
    for (const target of candidates) {
      if (!target.active || !target.enabled || !contains(target, x, y)) continue;
      if (!winner || isAbove(target, winner)) winner = target;
    }
    if (winner) this.hits++;
    return winner;
  }

  getDiagnostics(): AnnotationInteractionDiagnostics {
    if (!this.disposed) this.#syncIndex();
    return Object.freeze({
      registeredTargets: this.targets.size,
      indexedTargets: this.indexedTargets,
      gridCells: this.cells.size,
      indexRebuilds: this.indexRebuilds,
      incrementalIndexUpdates: this.incrementalIndexUpdates,
      regionUpdates: this.regionUpdates,
      picks: this.picks,
      hits: this.hits,
      lastCandidates: this.lastCandidates,
      maximumCandidates: this.maximumCandidates,
      candidateTests: this.candidateTests,
      hoverSamples: this.hoverSamples,
      coalescedHoverSamples: this.coalescedHoverSamples
    });
  }

  dispatch(type: AnnotationInteractionEventType, target: TargetImpl, snapshot: PointerSnapshot): void {
    if (!target.active || this.disposed) return;
    let stopped = false;
    const event = Object.freeze({
      type,
      target: requirePublicTarget(target),
      annotation: target.annotation,
      pointerId: snapshot.pointerId,
      pointerType: snapshot.pointerType,
      button: snapshot.button,
      buttons: snapshot.buttons,
      canvasX: snapshot.x,
      canvasY: snapshot.y,
      timeStamp: snapshot.timeStamp,
      altKey: snapshot.altKey,
      ctrlKey: snapshot.ctrlKey,
      metaKey: snapshot.metaKey,
      shiftKey: snapshot.shiftKey,
      stopPropagation() { stopped = true; }
    }) as AnnotationInteractionEvent;
    this.#callListeners(target.listeners.get(type), event);
    if (!stopped) this.#callListeners(this.globalListeners.get(type), event);
  }

  #onRegion = (source: InternalAnnotationHitRegion): void => {
    const target = this.targets.get(source.annotation);
    if (!target) return;
    this.regionUpdates++;
    if (!source.active) {
      this.disposeTarget(target);
      return;
    }
    assignRegion(target.region, source);
    this.#markTargetDirty(target);
  };

  #syncIndex(): void {
    if (!this.indexDirty) return;
    const incrementalLimit = Math.max(32, Math.ceil(this.targets.size * 0.05));
    if (this.indexRebuilds === 0 || this.dirtyTargets.size > incrementalLimit) {
      this.cells.clear();
      this.indexedTargets = 0;
      for (const target of this.dirtyTargets) {
        target.cellKeys.length = 0;
        target.indexed = false;
      }
      for (const target of this.targets.values()) {
        target.cellKeys.length = 0;
        target.indexed = false;
        this.#indexTarget(target);
      }
      this.indexRebuilds++;
    } else {
      for (const target of this.dirtyTargets) {
        this.#removeIndexedTarget(target);
        this.#indexTarget(target);
        this.incrementalIndexUpdates++;
      }
    }
    this.dirtyTargets.clear();
    this.indexDirty = false;
  }

  #markTargetDirty(target: TargetImpl): void {
    this.dirtyTargets.add(target);
    this.indexDirty = true;
  }

  #removeIndexedTarget(target: TargetImpl): void {
    if (!target.indexed) return;
    for (const key of target.cellKeys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      const index = cell.indexOf(target);
      if (index >= 0) cell.splice(index, 1);
      if (cell.length === 0) this.cells.delete(key);
    }
    target.cellKeys.length = 0;
    target.indexed = false;
    this.indexedTargets--;
  }

  #indexTarget(target: TargetImpl): void {
    const region = target.region;
    if (!target.active || !target.enabled || !region.active || !region.rendered || region.width <= 0 || region.height <= 0) return;
    const slop = target.hitSlop;
    const minimumX = Math.floor((region.x - slop) / this.cellSize);
    const maximumX = Math.floor((region.x + region.width + slop) / this.cellSize);
    const minimumY = Math.floor((region.y - slop) / this.cellSize);
    const maximumY = Math.floor((region.y + region.height + slop) / this.cellSize);
    for (let cellY = minimumY; cellY <= maximumY; cellY++) {
      for (let cellX = minimumX; cellX <= maximumX; cellX++) {
        const key = cellKey(cellX, cellY);
        const cell = this.cells.get(key);
        if (cell) cell.push(target);
        else this.cells.set(key, [target]);
        target.cellKeys.push(key);
      }
    }
    target.indexed = true;
    this.indexedTargets++;
  }

  #onPointerDown = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshotPointer(event);
    const target = this.pick(snapshot.x, snapshot.y);
    this.pointers.set(snapshot.pointerId, {
      startX: snapshot.x,
      startY: snapshot.y,
      startTime: snapshot.timeStamp,
      downTarget: target,
      maxDistanceSquared: 0
    });
    if (target) this.dispatch("pointerdown", target, snapshot);
  };

  #onPointerUp = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshotPointer(event);
    const target = this.pick(snapshot.x, snapshot.y);
    if (target) this.dispatch("pointerup", target, snapshot);
    const session = this.pointers.get(snapshot.pointerId);
    this.pointers.delete(snapshot.pointerId);
    if (!session || !target || target !== session.downTarget || snapshot.button !== 0) return;
    updateMovement(session, snapshot);
    const threshold = this.#threshold(snapshot.pointerType);
    if (
      session.maxDistanceSquared > threshold.maxDistance * threshold.maxDistance ||
      snapshot.timeStamp - session.startTime > threshold.maxDuration
    ) return;
    this.dispatch("click", target, snapshot);
    if (!target.active) return;
    const previous = this.lastClick;
    const dx = previous ? snapshot.x - previous.x : Number.POSITIVE_INFINITY;
    const dy = previous ? snapshot.y - previous.y : Number.POSITIVE_INFINITY;
    if (
      previous?.target === target &&
      previous.pointerType === snapshot.pointerType &&
      snapshot.timeStamp - previous.timeStamp <= (this.options.doubleClickDelay ?? 400) &&
      dx * dx + dy * dy <= threshold.maxDistance * threshold.maxDistance
    ) {
      this.dispatch("doubleclick", target, snapshot);
      this.lastClick = null;
    } else {
      this.lastClick = { target, x: snapshot.x, y: snapshot.y, timeStamp: snapshot.timeStamp, pointerType: snapshot.pointerType };
    }
  };

  #onPointerMove = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshotPointer(event);
    const session = this.pointers.get(snapshot.pointerId);
    if (session) updateMovement(session, snapshot);
    if (!(this.options.hover ?? true) || snapshot.pointerType === "touch") return;
    if (this.pendingHover) this.coalescedHoverSamples++;
    this.pendingHover = snapshot;
    if (this.hoverFrame !== undefined) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = undefined;
      const pending = this.pendingHover;
      this.pendingHover = null;
      if (!pending || !this.enabled || this.disposed) return;
      this.hoverSamples++;
      this.#resolveHover(pending, this.pick(pending.x, pending.y));
    });
  };

  #onPointerCancel = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (this.options.preventPointerDefault) event.preventDefault();
    this.pointers.delete(event.pointerId);
    this.lastClick = null;
  };

  #onPointerLeave = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (this.options.preventPointerDefault) event.preventDefault();
    this.#cancelHoverFrame();
    this.#clearHover();
  };

  #onContextMenu = (nativeEvent: Event): void => {
    const event = nativeEvent as MouseEvent;
    if (this.options.preventContextMenu) event.preventDefault();
    if (!this.enabled || this.disposed) return;
    const snapshot = this.#snapshotMouse(event);
    const target = this.pick(snapshot.x, snapshot.y);
    if (target) this.dispatch("contextmenu", target, snapshot);
  };

  #resolveHover(snapshot: PointerSnapshot, target: TargetImpl | null): void {
    const previous = this.hovered;
    if (previous?.target === target && target) {
      this.hovered = { target, snapshot };
      this.dispatch("hovermove", target, snapshot);
      return;
    }
    if (previous) this.dispatch("hoverend", previous.target, previous.snapshot);
    this.hovered = null;
    if (target) {
      this.hovered = { target, snapshot };
      this.dispatch("hoverstart", target, snapshot);
    }
  }

  #clearHover(): void {
    const previous = this.hovered;
    this.hovered = null;
    if (previous) this.dispatch("hoverend", previous.target, previous.snapshot);
  }

  #cancelHoverFrame(): void {
    this.pendingHover = null;
    if (this.hoverFrame !== undefined) cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = undefined;
  }

  #threshold(type: AnnotationPointerType): Required<AnnotationClickThreshold> {
    const configured = this.options.click?.[type];
    const defaults = DEFAULT_THRESHOLDS[type];
    return {
      maxDistance: configured?.maxDistance ?? defaults.maxDistance,
      maxDuration: configured?.maxDuration ?? defaults.maxDuration
    };
  }

  #acceptPointer(event: PointerEvent): boolean {
    if (this.options.preventPointerDefault) event.preventDefault();
    return this.enabled && !this.disposed;
  }

  #snapshotPointer(event: PointerEvent): PointerSnapshot {
    return this.#snapshot(event, event.pointerId, normalizePointerType(event.pointerType));
  }

  #snapshotMouse(event: MouseEvent): PointerSnapshot {
    return this.#snapshot(event, 1, "mouse");
  }

  #snapshot(event: MouseEvent, pointerId: number, pointerType: AnnotationPointerType): PointerSnapshot {
    const rect = this.options.canvas.getBoundingClientRect();
    return {
      pointerId,
      pointerType,
      button: event.button,
      buttons: event.buttons,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      timeStamp: event.timeStamp,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    };
  }

  #listen(type: string, callback: (event: Event) => void): void {
    this.options.canvas.addEventListener(type, callback);
    this.#removeDomListeners.push(() => this.options.canvas.removeEventListener(type, callback));
  }

  #callListeners(listeners: Set<AnnotationInteractionListener> | undefined, event: AnnotationInteractionEvent): void {
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        if (this.options.onError) this.options.onError(error, { phase: "listener", eventType: event.type });
        else console.error(error);
      }
    }
  }

  #requireTarget(target: TargetImpl): void {
    this.#assertUsable();
    if (!target.active || target.manager !== this) throw new AnnotatorError("Interactive annotation target is not active");
  }

  #assertUsable(): void {
    if (this.disposed) throw new AnnotatorError("Annotation interaction manager has been disposed");
  }
}

const managers = new WeakMap<AnnotationInteractionManager, ManagerImpl>();
const targets = new WeakMap<InteractiveAnnotationTarget, TargetImpl>();

export function createAnnotationInteractionManager(
  options: AnnotationInteractionManagerOptions
): AnnotationInteractionManager {
  const handle = Object.freeze({}) as AnnotationInteractionManager;
  managers.set(handle, new ManagerImpl(options));
  return handle;
}

export function registerInteractiveAnnotation(
  manager: AnnotationInteractionManager,
  annotation: AnnotationHandle,
  options: InteractiveAnnotationOptions = {}
): InteractiveAnnotationTarget {
  const internal = requireManager(manager).register(annotation, options);
  const handle = Object.freeze({ annotation }) as InteractiveAnnotationTarget;
  internal.publicHandle = handle;
  targets.set(handle, internal);
  return handle;
}

export function onAnnotationInteraction(
  target: InteractiveAnnotationTarget,
  type: AnnotationInteractionEventType,
  listener: AnnotationInteractionListener
): () => void {
  const internal = requireTarget(target);
  const listeners = getListeners(internal.listeners, type);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onAnnotationInteractionEvent(
  manager: AnnotationInteractionManager,
  type: AnnotationInteractionEventType,
  listener: AnnotationInteractionListener
): () => void {
  const internal = requireManager(manager);
  const listeners = getListeners(internal.globalListeners, type);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pickInteractiveAnnotation(
  manager: AnnotationInteractionManager,
  canvasX: number,
  canvasY: number
): InteractiveAnnotationTarget | null {
  assertFinite(canvasX, "Pick x");
  assertFinite(canvasY, "Pick y");
  const target = requireManager(manager).pick(canvasX, canvasY);
  return target ? requirePublicTarget(target) : null;
}

export function setAnnotationInteractionEnabled(manager: AnnotationInteractionManager, enabled: boolean): void {
  requireManager(manager).setEnabled(enabled);
}

export function setInteractiveAnnotationEnabled(target: InteractiveAnnotationTarget, enabled: boolean): void {
  const internal = requireTarget(target);
  internal.manager.setTargetEnabled(internal, enabled);
}

export function getHoveredAnnotation(manager: AnnotationInteractionManager): AnnotationHandle | null {
  return requireManager(manager).hovered?.target.annotation ?? null;
}

export function getPressedAnnotation(
  manager: AnnotationInteractionManager,
  pointerId: number
): AnnotationHandle | null {
  return requireManager(manager).pointers.get(pointerId)?.downTarget?.annotation ?? null;
}

export function getAnnotationInteractionDiagnostics(
  manager: AnnotationInteractionManager
): AnnotationInteractionDiagnostics {
  return requireManager(manager).getDiagnostics();
}

export function disposeInteractiveAnnotation(target: InteractiveAnnotationTarget): void {
  const internal = targets.get(target);
  if (!internal || !internal.active) return;
  internal.manager.disposeTarget(internal);
}

export function disposeAnnotationInteractionManager(manager: AnnotationInteractionManager): void {
  const internal = managers.get(manager);
  if (!internal) return;
  internal.dispose();
}

function requireManager(manager: AnnotationInteractionManager): ManagerImpl {
  const internal = managers.get(manager);
  if (!internal) throw new AnnotatorError("Unknown annotation interaction manager");
  if (internal.disposed) throw new AnnotatorError("Annotation interaction manager has been disposed");
  return internal;
}

function requireTarget(target: InteractiveAnnotationTarget): TargetImpl {
  const internal = targets.get(target);
  if (!internal) throw new AnnotatorError("Unknown interactive annotation target");
  if (!internal.active) throw new AnnotatorError("Interactive annotation target has been disposed");
  return internal;
}

function requirePublicTarget(internal: TargetImpl): InteractiveAnnotationTarget {
  if (internal.publicHandle) return internal.publicHandle;
  throw new AnnotatorError("Interactive annotation target handle is unavailable");
}

function getListeners(map: ListenerMap, type: AnnotationInteractionEventType): Set<AnnotationInteractionListener> {
  let listeners = map.get(type);
  if (!listeners) {
    listeners = new Set();
    map.set(type, listeners);
  }
  return listeners;
}

function copyRegion(source: InternalAnnotationHitRegion): MutableRegion {
  return {
    active: source.active,
    rendered: source.rendered,
    type: source.type,
    shape: source.shape,
    zIndex: source.zIndex,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height
  };
}

function assignRegion(target: MutableRegion, source: InternalAnnotationHitRegion): void {
  target.active = source.active;
  target.rendered = source.rendered;
  target.type = source.type;
  target.shape = source.shape;
  target.zIndex = source.zIndex;
  target.x = source.x;
  target.y = source.y;
  target.width = source.width;
  target.height = source.height;
}

function contains(target: TargetImpl, x: number, y: number): boolean {
  const region = target.region;
  const slop = target.hitSlop;
  if (
    x < region.x - slop || x > region.x + region.width + slop ||
    y < region.y - slop || y > region.y + region.height + slop
  ) return false;
  if (region.type !== "marker") return true;
  const halfWidth = region.width * 0.5 + slop;
  const halfHeight = region.height * 0.5 + slop;
  const dx = x - (region.x + region.width * 0.5);
  const dy = y - (region.y + region.height * 0.5);
  if (region.shape === "dot" || region.shape === "ring") {
    const nx = dx / Math.max(halfWidth, 0.0001);
    const ny = dy / Math.max(halfHeight, 0.0001);
    return nx * nx + ny * ny <= 1;
  }
  if (region.shape === "diamond") {
    return Math.abs(dx) / Math.max(halfWidth, 0.0001) + Math.abs(dy) / Math.max(halfHeight, 0.0001) <= 1;
  }
  if (region.shape === "triangle") {
    const normalizedY = (dy + halfHeight) / Math.max(halfHeight * 2, 0.0001);
    return normalizedY >= 0 && normalizedY <= 1 && Math.abs(dx) <= halfWidth * normalizedY;
  }
  return true;
}

function isAbove(candidate: TargetImpl, current: TargetImpl): boolean {
  if (candidate.region.zIndex !== current.region.zIndex) return candidate.region.zIndex > current.region.zIndex;
  return candidate.annotation.id > current.annotation.id;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function updateMovement(session: PointerSession, snapshot: PointerSnapshot): void {
  const dx = snapshot.x - session.startX;
  const dy = snapshot.y - session.startY;
  session.maxDistanceSquared = Math.max(session.maxDistanceSquared, dx * dx + dy * dy);
}

function normalizePointerType(value: string): AnnotationPointerType {
  return value === "touch" || value === "pen" ? value : "mouse";
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new AnnotatorError(`${label} must be a positive finite number`);
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new AnnotatorError(`${label} must be a non-negative finite number`);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new AnnotatorError(`${label} must be finite`);
}
