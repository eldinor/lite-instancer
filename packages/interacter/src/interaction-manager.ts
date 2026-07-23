import type { Mesh } from "@babylonjs/lite";
import {
  createBabylonPickDriver,
  createBrowserFrameDriver,
  PickScheduler,
  type FrameDriver,
  type PickDriver,
  type PickResult
} from "./pick-scheduler.js";
import type {
  ClickThreshold,
  InteractionErrorContext,
  InteractionEvent,
  InteractionEventType,
  InteractionListener,
  InteractionManager,
  InteractionManagerOptions,
  InteractionMeshFilter,
  InteractionPointerType,
  InteractionTarget
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
  startX: number;
  startY: number;
  startTime: number;
  maxDistanceSquared: number;
  rawDown: boolean;
  cancelled: boolean;
  downTarget: TargetImpl | null | undefined;
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

const DEFAULT_THRESHOLDS: Record<InteractionPointerType, ClickThreshold> = {
  mouse: { maxDistance: 4, maxDuration: 500 },
  pen: { maxDistance: 4, maxDuration: 500 },
  touch: { maxDistance: 12, maxDuration: 700 }
};

class TargetImpl {
  readonly mesh: Mesh;
  readonly manager: ManagerImpl;
  readonly listeners: ListenerMap = new Map();
  active = true;

  constructor(manager: ManagerImpl, mesh: Mesh) {
    this.manager = manager;
    this.mesh = mesh;
  }
}

export class ManagerImpl {
  readonly options: InteractionManagerOptions;
  readonly scheduler: PickScheduler;
  readonly targetsByMesh = new Map<Mesh, TargetImpl>();
  readonly globalListeners: ListenerMap = new Map();
  readonly pointers = new Map<number, PointerSession>();
  enabled = true;
  disposed = false;
  filter: InteractionMeshFilter | null;
  hoverRecord: HoverRecord | undefined;
  hoverGeneration = 0;
  epoch = 0;
  lastClick: LastClick | undefined;

  readonly #removeDomListeners: Array<() => void> = [];

  constructor(options: InteractionManagerOptions, driver: PickDriver, frames: FrameDriver) {
    this.options = options;
    this.filter = options.filter ?? null;
    this.scheduler = new PickScheduler(driver, frames);
    this.#listen("pointerdown", this.#onPointerDown);
    this.#listen("pointerup", this.#onPointerUp);
    this.#listen("pointermove", this.#onPointerMove);
    this.#listen("pointercancel", this.#onPointerCancel);
    this.#listen("pointerleave", this.#onPointerLeave);
    this.#listen("contextmenu", this.#onContextMenu);
  }

  register(mesh: Mesh): TargetImpl {
    this.#assertUsable();
    if (this.targetsByMesh.has(mesh)) {
      throw new Error("This mesh is already registered with the interaction manager.");
    }
    const target = new TargetImpl(this, mesh);
    this.targetsByMesh.set(mesh, target);
    return target;
  }

  disposeTarget(target: TargetImpl): void {
    if (!target.active) return;
    if (this.hoverRecord?.target === target) this.#clearHover();
    target.active = false;
    this.targetsByMesh.delete(target.mesh);
    target.listeners.clear();
    for (const session of this.pointers.values()) {
      if (session.downTarget === target) session.downTarget = null;
    }
    if (this.lastClick?.target === target) this.lastClick = undefined;
  }

  setEnabled(enabled: boolean): void {
    this.#assertUsable();
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.epoch++;
    this.hoverGeneration++;
    this.scheduler.cancelPending();
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

  dispatch(type: InteractionEventType, target: TargetImpl, snapshot: PointerSnapshot, result: PickResult): void {
    if (!target.active || this.disposed) return;
    let stopped = false;
    const event: InteractionEvent = {
      type,
      target: target as unknown as InteractionTarget,
      mesh: target.mesh,
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
      stopPropagation() {
        stopped = true;
      }
    };
    this.#callListeners(target.listeners.get(type), event);
    if (!stopped) this.#callListeners(this.globalListeners.get(type), event);
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
      startX: snapshot.x,
      startY: snapshot.y,
      startTime: snapshot.timeStamp,
      maxDistanceSquared: 0,
      rawDown: true,
      cancelled: false,
      downTarget: undefined
    };
    this.pointers.set(snapshot.pointerId, session);
    const epoch = this.epoch;
    this.#queueDiscrete(snapshot, epoch, (result, target) => {
      if (session.cancelled) return;
      session.downTarget = target;
      if (target) this.dispatch("pointerdown", target, snapshot, result);
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
    const epoch = this.epoch;
    this.#queueDiscrete(snapshot, epoch, (result, target) => {
      if (target) this.dispatch("pointerup", target, snapshot, result);
      if (session && !session.cancelled) this.#resolveClick(session, snapshot, result, target);
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
    }
    if ((this.options.hover ?? true) && snapshot.pointerType !== "touch") this.#queueHover(snapshot);
  };

  #onPointerCancel = (nativeEvent: Event): void => {
    const event = nativeEvent as PointerEvent;
    if (this.options.preventPointerDefault) event.preventDefault();
    const session = this.pointers.get(event.pointerId);
    if (session) session.cancelled = true;
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
    this.#queueDiscrete(snapshot, epoch, (result, target) => {
      if (target) this.dispatch("contextmenu", target, snapshot, result);
    });
  };

  #queueDiscrete(
    snapshot: PointerSnapshot,
    epoch: number,
    callback: (result: PickResult, target: TargetImpl | null) => void
  ): void {
    this.scheduler.queueDiscrete({
      x: snapshot.x,
      y: snapshot.y,
      filter: this.#pickFilter,
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

export function createManagerInternal(
  options: InteractionManagerOptions,
  driver: PickDriver,
  frames: FrameDriver
): InteractionManager {
  return new ManagerImpl(options, driver, frames) as unknown as InteractionManager;
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

