import { getMeshGeometry, type Mesh, type PickIgnore } from "@babylonjs/lite";
import {
  createBabylonPickDriver,
  createBrowserFrameDriver,
  PickScheduler,
  type ClockDriver,
  type FrameDriver,
  type PickDriver,
  type PickResult
} from "./pick-scheduler.js";
import type {
  ClickThreshold,
  InteractionErrorContext,
  InteractionDragOptions,
  InteractionDetailedPickingPolicy,
  InteractionDragEndReason,
  InteractionEvent,
  InteractionEventType,
  InteractionInstanceId,
  InteractionListener,
  InteractionManager,
  InteractionManagerOptions,
  InteractionMeshFilter,
  InteractionPickDetails,
  InteractionPickKind,
  InteractionPickOptions,
  InteractionPointerType,
  InteractionTarget,
  InteractionTargetOptions
} from "./types.js";

type ListenerMap = Map<InteractionEventType, Set<InteractionListener>>;

interface PointerSnapshot {
  pointerId: number;
  pointerType: InteractionPointerType;
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
  snapshot: PointerSnapshot;
  readonly startSnapshot: PointerSnapshot;
  startX: number;
  startY: number;
  startTime: number;
  maxDistanceSquared: number;
  rawDown: boolean;
  cancelled: boolean;
  downTarget: TargetImpl | null | undefined;
  downResult: PickResult | undefined;
  dragging: boolean;
  dragResult: PickResult | undefined;
}

interface HoverRecord {
  target: TargetImpl;
  snapshot: PointerSnapshot;
  result: PickResult;
}

interface LastClick {
  target: TargetImpl;
  x: number;
  y: number;
  timeStamp: number;
  pointerType: InteractionPointerType;
  button: number;
}

interface ResolvedDragOptions {
  startDistance: number;
  capturePointer: boolean;
  ignoreTarget: boolean;
  surfaceFilter: InteractionMeshFilter | null;
}

interface ResolvedDetailedPickingPolicy {
  discrete: boolean;
  drag: boolean;
  hover: boolean;
}

const DEFAULT_THRESHOLDS: Record<InteractionPointerType, ClickThreshold> = {
  mouse: { maxDistance: 4, maxDuration: 500 },
  pen: { maxDistance: 4, maxDuration: 500 },
  touch: { maxDistance: 12, maxDuration: 700 }
};

class TargetImpl {
  readonly mesh: Mesh;
  readonly manager: ManagerImpl;
  readonly listeners: ListenerMap = new Map();
  readonly options: InteractionTargetOptions;
  active = true;
  disposing = false;

  constructor(manager: ManagerImpl, mesh: Mesh, options: InteractionTargetOptions) {
    this.manager = manager;
    this.mesh = mesh;
    this.options = options;
  }
}

export class ManagerImpl {
  readonly options: InteractionManagerOptions;
  readonly scheduler: PickScheduler;
  readonly targetsByMesh = new Map<Mesh, TargetImpl>();
  readonly globalListeners: ListenerMap = new Map();
  readonly pointers = new Map<number, PointerSession>();
  readonly geometryIndicesByMesh = new WeakMap<Mesh, Uint32Array | null>();
  readonly dragOptions: ResolvedDragOptions;
  readonly detailedPickingPolicy: ResolvedDetailedPickingPolicy;
  enabled = true;
  disposed = false;
  filter: InteractionMeshFilter | null;
  hoverRecord: HoverRecord | undefined;
  hoverGeneration = 0;
  epoch = 0;
  lastClick: LastClick | undefined;

  readonly #removeDomListeners: Array<() => void> = [];

  constructor(
    options: InteractionManagerOptions,
    driver: PickDriver,
    frames: FrameDriver,
    clock?: ClockDriver
  ) {
    this.options = options;
    this.filter = options.filter ?? null;
    const drag = typeof options.drag === "object" ? options.drag : {};
    this.dragOptions = {
      startDistance: drag.startDistance ?? -1,
      capturePointer: drag.capturePointer ?? true,
      ignoreTarget: drag.ignoreTarget ?? true,
      surfaceFilter: drag.surfaceFilter ?? null
    };
    this.detailedPickingPolicy = resolveDetailedPickingPolicy(options.detailedPicking);
    this.scheduler = new PickScheduler(driver, frames, clock);
    this.#listen("pointerdown", this.#onPointerDown);
    this.#listen("pointerup", this.#onPointerUp);
    this.#listen("pointermove", this.#onPointerMove);
    this.#listen("pointercancel", this.#onPointerCancel);
    this.#listen("pointerleave", this.#onPointerLeave);
    this.#listen("contextmenu", this.#onContextMenu);
  }

  register(mesh: Mesh, options: InteractionTargetOptions = {}): TargetImpl {
    this.#assertUsable();
    if (this.targetsByMesh.has(mesh)) {
      throw new Error("This mesh is already registered with the interaction manager.");
    }
    const target = new TargetImpl(this, mesh, options);
    this.targetsByMesh.set(mesh, target);
    return target;
  }

  disposeTarget(target: TargetImpl): void {
    if (!target.active || target.disposing) return;
    target.disposing = true;
    if (this.hoverRecord?.target === target) this.#clearHover();
    for (const [pointerId, session] of this.pointers) {
      if (session.downTarget !== target) continue;
      this.#finishDrag(session, "target-disposed", session.snapshot);
      session.cancelled = true;
      this.#releasePointer(pointerId);
      this.pointers.delete(pointerId);
    }
    target.active = false;
    this.targetsByMesh.delete(target.mesh);
    target.listeners.clear();
    target.disposing = false;
    if (this.lastClick?.target === target) this.lastClick = undefined;
  }

  setEnabled(enabled: boolean): void {
    this.#assertUsable();
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.epoch++;
    this.hoverGeneration++;
    this.scheduler.cancelPending();
    if (!enabled) {
      for (const session of this.pointers.values()) {
        this.#finishDrag(session, "disabled", session.snapshot);
      }
    }
    for (const pointerId of this.pointers.keys()) this.#releasePointer(pointerId);
    this.pointers.clear();
    this.lastClick = undefined;
    if (!enabled) this.#clearHover();
  }

  dispose(): void {
    if (this.disposed) return;
    this.#clearHover();
    this.disposed = true;
    this.enabled = false;
    this.epoch++;
    this.hoverGeneration++;
    for (const remove of this.#removeDomListeners) remove();
    this.#removeDomListeners.length = 0;
    for (const pointerId of this.pointers.keys()) this.#releasePointer(pointerId);
    this.pointers.clear();
    this.scheduler.dispose();
    for (const target of this.targetsByMesh.values()) {
      target.active = false;
      target.listeners.clear();
    }
    this.targetsByMesh.clear();
    this.globalListeners.clear();
    this.lastClick = undefined;
  }

  dispatch(
    type: InteractionEventType,
    target: TargetImpl,
    snapshot: PointerSnapshot,
    result: PickResult,
    identityResult: PickResult = result,
    dragEndReason?: InteractionDragEndReason
  ): void {
    if (!target.active || this.disposed) return;
    if (type === "dragend" && !dragEndReason) {
      throw new Error("A dragend event requires a termination reason.");
    }
    const pickDetails = this.#detailsForResult(result);
    const instanceId = this.#resolveInstanceId(target, identityResult.thinInstanceIndex, type);
    let stopped = false;
    const event: InteractionEvent = {
      type,
      target: target as unknown as InteractionTarget,
      mesh: target.mesh,
      pickedMesh: result.pickedMesh,
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
      pickedPoint: result.pickedPoint,
      distance: result.distance,
      thinInstanceIndex: identityResult.thinInstanceIndex,
      pickedThinInstanceIndex: result.thinInstanceIndex,
      instanceId,
      pickDetailsStatus: pickDetails
        ? "available"
        : result.detailedRequested
          ? "unavailable"
          : "disabled",
      pickDetails,
      ...(type === "dragend" ? { dragEndReason: dragEndReason! } : {}),
      stopPropagation() {
        stopped = true;
      }
    } as InteractionEvent;
    this.#callListeners(target.listeners.get(type), event);
    if (!stopped) this.#callListeners(this.globalListeners.get(type), event);
  }

  #detailsForResult(result: PickResult): InteractionPickDetails | null {
    const details = result.details;
    if (!details || details.vertexIndices) return details;
    const mesh = result.pickedMesh;
    if (!mesh) return details;
    if (!this.geometryIndicesByMesh.has(mesh)) {
      this.geometryIndicesByMesh.set(mesh, getMeshGeometry(mesh)?.indices ?? null);
    }
    const indices = this.geometryIndicesByMesh.get(mesh);
    const offset = details.faceId * 3;
    if (!indices || offset < 0 || offset + 2 >= indices.length) return details;
    return {
      ...details,
      vertexIndices: [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!]
    };
  }

  #resolveInstanceId(
    target: TargetImpl,
    thinInstanceIndex: number,
    eventType: InteractionEventType
  ): InteractionInstanceId | null {
    if (!target.options.resolveInstanceId || thinInstanceIndex < 0) return null;
    try {
      return target.options.resolveInstanceId(thinInstanceIndex);
    } catch (error) {
      this.report(error, { phase: "resolver", eventType });
      return null;
    }
  }

  report(error: unknown, context: InteractionErrorContext): void {
    if (this.options.onError) {
      try {
        this.options.onError(error, context);
      } catch (reportingError) {
        console.error(reportingError);
      }
      return;
    }
    console.error(error);
  }

  #callListeners(listeners: Set<InteractionListener> | undefined, event: InteractionEvent): void {
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.report(error, { phase: "listener", eventType: event.type });
      }
    }
  }

  #onPointerDown = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshot(event);
    const session: PointerSession = {
      snapshot,
      startSnapshot: snapshot,
      startX: snapshot.x,
      startY: snapshot.y,
      startTime: snapshot.timeStamp,
      maxDistanceSquared: 0,
      rawDown: true,
      cancelled: false,
      downTarget: undefined,
      downResult: undefined,
      dragging: false,
      dragResult: undefined
    };
    this.pointers.set(snapshot.pointerId, session);
    if (this.options.drag && this.dragOptions.capturePointer) this.#capturePointer(snapshot.pointerId);
    const epoch = this.epoch;
    this.#queueDiscrete(snapshot, epoch, "pointerdown", (result, target) => {
      if (session.cancelled) return;
      session.downTarget = target;
      session.downResult = result;
      if (target) this.dispatch("pointerdown", target, snapshot, result);
      this.#startPendingDrag(session);
    });
  };

  #onPointerUp = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshot(event);
    const session = this.pointers.get(snapshot.pointerId);
    if (session) {
      this.#updateMovement(session, snapshot);
      session.rawDown = false;
    }
    this.#releasePointer(snapshot.pointerId);
    const epoch = this.epoch;
    this.#queueDiscrete(snapshot, epoch, "pointerup", (result, target) => {
      if (target) this.dispatch("pointerup", target, snapshot, result);
      if (session && !session.cancelled) {
        if (session.dragging && session.downTarget) {
          this.#finishDrag(session, "released", snapshot, result);
        } else {
          this.#resolveClick(session, snapshot, result, target);
        }
      }
      if (this.pointers.get(snapshot.pointerId) === session) this.pointers.delete(snapshot.pointerId);
    });
  };

  #onPointerMove = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (!this.#acceptPointer(event)) return;
    const snapshot = this.#snapshot(event);
    const session = this.pointers.get(snapshot.pointerId);
    if (session) {
      session.snapshot = snapshot;
      this.#updateMovement(session, snapshot);
      if (session.dragging) {
        this.#queueDrag(session, snapshot);
        return;
      }
      if (this.options.drag) {
        this.#startPendingDrag(session);
        if (session.rawDown) return;
      }
    }
    if ((this.options.hover ?? true) && snapshot.pointerType !== "touch") this.#queueHover(snapshot);
  };

  #onPointerCancel = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (this.options.preventPointerDefault) event.preventDefault();
    const session = this.pointers.get(event.pointerId);
    if (session) {
      session.cancelled = true;
      this.#finishDrag(session, "pointercancel", this.#snapshot(event));
    }
    this.#releasePointer(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.lastClick = undefined;
  };

  #onPointerLeave = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (this.options.preventPointerDefault) event.preventDefault();
    this.hoverGeneration++;
    this.#clearHover();
  };

  #onContextMenu = (nativeEvent: Event): void => {
    const event = nativeEvent as MouseEvent;
    if (this.options.preventContextMenu) event.preventDefault();
    if (!this.enabled || this.disposed) return;
    const snapshot = this.#snapshotMouse(event);
    const epoch = this.epoch;
    this.#queueDiscrete(snapshot, epoch, "contextmenu", (result, target) => {
      if (target) this.dispatch("contextmenu", target, snapshot, result);
    });
  };

  #queueDiscrete(
    snapshot: PointerSnapshot,
    epoch: number,
    eventType: InteractionEventType,
    callback: (result: PickResult, target: TargetImpl | null) => void
  ): void {
    const options = this.#pickOptions("discrete", eventType, snapshot.pointerId, null);
    this.scheduler.queueDiscrete({
      x: snapshot.x,
      y: snapshot.y,
      filter: this.#pickFilter,
      options,
      detailed: this.#usesDetailedPicking("discrete"),
      resolve: (result) => {
        if (!this.#isCurrent(epoch)) return;
        callback(result, this.#resolveTarget(result));
      },
      reject: (error) => {
        if (this.#isCurrent(epoch)) this.report(error, { phase: "pick" });
      }
    });
  }

  #queueHover(snapshot: PointerSnapshot): void {
    const generation = ++this.hoverGeneration;
    const epoch = this.epoch;
    this.scheduler.queueHover({
      x: snapshot.x,
      y: snapshot.y,
      filter: this.#pickFilter,
      options: this.#pickOptions("hover", "hovermove", snapshot.pointerId, null),
      detailed: this.#usesDetailedPicking("hover"),
      resolve: (result) => {
        if (!this.#isCurrent(epoch) || generation !== this.hoverGeneration) return;
        this.#resolveHover(snapshot, result, this.#resolveTarget(result));
      },
      reject: (error) => {
        if (this.#isCurrent(epoch) && generation === this.hoverGeneration) {
          this.report(error, { phase: "pick", eventType: "hovermove" });
        }
      }
    });
  }

  #startPendingDrag(session: PointerSession): void {
    if (!this.options.drag || session.dragging || !session.rawDown || !session.downTarget || !session.downResult) return;
    const configuredDistance = this.dragOptions.startDistance;
    const distance =
      configuredDistance >= 0 ? configuredDistance : this.#threshold(session.snapshot.pointerType).maxDistance;
    if (session.maxDistanceSquared <= distance * distance) return;
    session.dragging = true;
    this.lastClick = undefined;
    this.dispatch("dragstart", session.downTarget, session.startSnapshot, session.downResult);
    this.#queueDrag(session, session.snapshot);
  }

  #queueDrag(session: PointerSession, snapshot: PointerSnapshot): void {
    const target = session.downTarget;
    if (!target || !target.active || !session.dragging) return;
    const epoch = this.epoch;
    this.scheduler.queueImmediateContinuous(`drag:${snapshot.pointerId}`, {
      x: snapshot.x,
      y: snapshot.y,
      filter: this.dragOptions.surfaceFilter ?? this.#pickFilter,
      options: this.#pickOptions("drag", "drag", snapshot.pointerId, target),
      detailed: this.#usesDetailedPicking("drag"),
      resolve: (result) => {
        if (
          !this.#isCurrent(epoch) ||
          !session.dragging ||
          this.pointers.get(snapshot.pointerId) !== session
        ) {
          return;
        }
        session.dragResult = result;
        this.dispatch("drag", target, snapshot, result, session.downResult);
      },
      reject: (error) => {
        if (this.#isCurrent(epoch) && session.dragging) {
          this.report(error, { phase: "pick", eventType: "drag" });
        }
      }
    });
  }

  #finishDrag(
    session: PointerSession,
    reason: InteractionDragEndReason,
    snapshot: PointerSnapshot,
    fallbackResult?: PickResult
  ): void {
    if (!session.dragging) return;
    session.dragging = false;
    this.#releasePointer(snapshot.pointerId);
    const target = session.downTarget;
    const identityResult = session.downResult;
    if (!target || !identityResult) return;
    this.dispatch(
      "dragend",
      target,
      snapshot,
      session.dragResult ?? fallbackResult ?? identityResult,
      identityResult,
      reason
    );
  }

  #resolveClick(
    session: PointerSession,
    snapshot: PointerSnapshot,
    result: PickResult,
    upTarget: TargetImpl | null
  ): void {
    const threshold = this.#threshold(snapshot.pointerType);
    const valid =
      snapshot.button === 0 &&
      session.downTarget !== undefined &&
      session.downTarget !== null &&
      session.downTarget === upTarget &&
      upTarget.active &&
      session.maxDistanceSquared <= threshold.maxDistance * threshold.maxDistance &&
      snapshot.timeStamp - session.startTime <= threshold.maxDuration;
    if (!valid) return;

    this.dispatch("click", upTarget, snapshot, result);
    if (!upTarget.active) return;
    const previous = this.lastClick;
    const dx = previous ? snapshot.x - previous.x : Number.POSITIVE_INFINITY;
    const dy = previous ? snapshot.y - previous.y : Number.POSITIVE_INFINITY;
    const doubleClick =
      previous !== undefined &&
      previous.target === upTarget &&
      previous.button === snapshot.button &&
      previous.pointerType === snapshot.pointerType &&
      snapshot.timeStamp - previous.timeStamp <= (this.options.doubleClickDelay ?? 400) &&
      dx * dx + dy * dy <= threshold.maxDistance * threshold.maxDistance;
    if (doubleClick) {
      this.dispatch("doubleclick", upTarget, snapshot, result);
      this.lastClick = undefined;
    } else {
      this.lastClick = {
        target: upTarget,
        x: snapshot.x,
        y: snapshot.y,
        timeStamp: snapshot.timeStamp,
        pointerType: snapshot.pointerType,
        button: snapshot.button
      };
    }
  }

  #resolveHover(snapshot: PointerSnapshot, result: PickResult, target: TargetImpl | null): void {
    const previous = this.hoverRecord;
    if (previous?.target === target && target) {
      this.hoverRecord = { target, snapshot, result };
      this.dispatch("hovermove", target, snapshot, result);
      return;
    }
    if (previous) this.dispatch("hoverend", previous.target, previous.snapshot, previous.result);
    this.hoverRecord = undefined;
    if (target) {
      this.hoverRecord = { target, snapshot, result };
      this.dispatch("hoverstart", target, snapshot, result);
    }
  }

  #clearHover(): void {
    const previous = this.hoverRecord;
    this.hoverRecord = undefined;
    if (previous) this.dispatch("hoverend", previous.target, previous.snapshot, previous.result);
  }

  #resolveTarget(result: PickResult): TargetImpl | null {
    if (!result.pickedMesh) return null;
    const target = this.targetsByMesh.get(result.pickedMesh);
    return target?.active ? target : null;
  }

  #pickFilter = (mesh: Mesh): boolean => {
    const target = this.targetsByMesh.get(mesh);
    return Boolean(target?.active && (!this.filter || this.filter(mesh)));
  };

  #usesDetailedPicking(kind: InteractionPickKind): boolean {
    return this.detailedPickingPolicy[kind];
  }

  #pickOptions(
    kind: InteractionPickKind,
    eventType: InteractionEventType,
    pointerId: number,
    dragTarget: TargetImpl | null
  ): InteractionPickOptions | undefined {
    const configured = this.options.pickOptions;
    let options: InteractionPickOptions | undefined;
    try {
      options =
        typeof configured === "function"
          ? configured({
              kind,
              eventType,
              pointerId,
              dragTarget: dragTarget as unknown as InteractionTarget | null
            })
          : configured;
    } catch (error) {
      this.report(error, { phase: "pick-options", eventType });
    }
    if (kind !== "drag" || !dragTarget || !this.dragOptions.ignoreTarget) return options;
    const ignored: PickIgnore = {
      mesh: dragTarget.mesh,
      ...((this.pointers.get(pointerId)?.downResult?.thinInstanceIndex ?? -1) >= 0
        ? { thinInstanceIndex: this.pointers.get(pointerId)!.downResult!.thinInstanceIndex }
        : {})
    };
    const existing = options?.ignore;
    return {
      ...options,
      ignore: existing ? [...(Array.isArray(existing) ? existing : [existing]), ignored] : ignored
    };
  }

  #threshold(type: InteractionPointerType): ClickThreshold {
    const defaults = DEFAULT_THRESHOLDS[type];
    const configured = this.options.click?.[type];
    return {
      maxDistance: configured?.maxDistance ?? defaults.maxDistance,
      maxDuration: configured?.maxDuration ?? defaults.maxDuration
    };
  }

  #updateMovement(session: PointerSession, snapshot: PointerSnapshot): void {
    const dx = snapshot.x - session.startX;
    const dy = snapshot.y - session.startY;
    session.maxDistanceSquared = Math.max(session.maxDistanceSquared, dx * dx + dy * dy);
  }

  #capturePointer(pointerId: number): void {
    try {
      this.options.canvas.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is best-effort; synthetic events and detached canvases may reject it.
    }
  }

  #releasePointer(pointerId: number): void {
    try {
      if (this.options.canvas.hasPointerCapture?.(pointerId)) {
        this.options.canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // The browser may already have released capture after cancellation.
    }
  }

  #acceptPointer(event: PointerEvent): boolean {
    if (this.options.preventPointerDefault) event.preventDefault();
    return this.enabled && !this.disposed;
  }

  #snapshot(event: PointerEvent): PointerSnapshot {
    const rect = this.options.canvas.getBoundingClientRect();
    return {
      pointerId: event.pointerId,
      pointerType: normalizePointerType(event.pointerType),
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

  #snapshotMouse(event: MouseEvent): PointerSnapshot {
    const rect = this.options.canvas.getBoundingClientRect();
    const pointerEvent = event as MouseEvent & { pointerId?: number; pointerType?: string };
    return {
      pointerId: pointerEvent.pointerId ?? 0,
      pointerType: normalizePointerType(pointerEvent.pointerType ?? "mouse"),
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

  #listen(type: string, listener: (event: Event) => void): void {
    this.options.canvas.addEventListener(type, listener);
    this.#removeDomListeners.push(() => this.options.canvas.removeEventListener(type, listener));
  }

  #isCurrent(epoch: number): boolean {
    return !this.disposed && this.enabled && epoch === this.epoch;
  }

  #assertUsable(): void {
    if (this.disposed) throw new Error("The interaction manager has been disposed.");
  }
}

function resolveDetailedPickingPolicy(
  configured: InteractionDetailedPickingPolicy | undefined
): ResolvedDetailedPickingPolicy {
  return {
    discrete: configured?.discrete ?? false,
    drag: configured?.drag ?? false,
    hover: configured?.hover ?? false
  };
}

export function createManagerInternal(
  options: InteractionManagerOptions,
  driver: PickDriver,
  frames: FrameDriver,
  clock?: ClockDriver
): InteractionManager {
  return new ManagerImpl(options, driver, frames, clock) as unknown as InteractionManager;
}

export function createManager(options: InteractionManagerOptions): InteractionManager {
  return createManagerInternal(options, createBabylonPickDriver(options.scene), createBrowserFrameDriver());
}

export function asManager(manager: InteractionManager): ManagerImpl {
  if (!(manager instanceof ManagerImpl)) throw new TypeError("Invalid interaction manager.");
  return manager;
}

export function asTarget(target: InteractionTarget): TargetImpl {
  if (!(target instanceof TargetImpl)) throw new TypeError("Invalid interaction target.");
  return target;
}

function normalizePointerType(value: string): InteractionPointerType {
  return value === "touch" || value === "pen" ? value : "mouse";
}
