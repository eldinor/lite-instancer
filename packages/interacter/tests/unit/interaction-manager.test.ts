import type { Mesh, PickingInfo, SceneContext } from "@babylonjs/lite";
import * as publicApi from "../../src/index.js";
import {
  disposeInteractionManager,
  disposeInteractionTarget,
  getActivePointers,
  getHoveredTarget,
  getInteractionDiagnostics,
  getPressedTarget,
  interpolatePickedAttribute,
  isInteractionEnabled,
  onInteraction,
  onInteractionEvent,
  registerMesh,
  setInteractionEnabled
} from "../../src/index.js";
import { createManagerInternal } from "../../src/interaction-manager.js";
import {
  toInteractionPickDetails,
  type ClockDriver,
  type FrameDriver,
  type PickDriver,
  type PickResult
} from "../../src/pick-scheduler.js";
import type { InteractionManager, InteractionManagerOptions } from "../../src/types.js";
import type { InteractionPickOptions } from "../../src/types.js";

class FakeCanvas extends EventTarget {
  readonly capturedPointers = new Set<number>();
  readonly releasedPointers: number[] = [];

  getBoundingClientRect(): DOMRect {
    return { left: 10, top: 20, width: 640, height: 480 } as DOMRect;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
    this.releasedPointers.push(pointerId);
  }
}

class ManualFrames implements FrameDriver {
  #next = 1;
  readonly callbacks = new Map<number, () => void>();
  request(callback: () => void): number {
    const id = this.#next++;
    this.callbacks.set(id, callback);
    return id;
  }
  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }
  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

class ManualClock implements ClockDriver {
  value = 0;
  now(): number {
    return this.value;
  }
  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

class FakePicker implements PickDriver {
  readonly pending: Array<{
    x: number;
    y: number;
    filter: (mesh: Mesh) => boolean;
    options: InteractionPickOptions | undefined;
    detailed: boolean;
    resolve: (result: PickResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  active = 0;
  maxActive = 0;
  disposed = false;

  pick(
    x: number,
    y: number,
    filter: (mesh: Mesh) => boolean,
    options: InteractionPickOptions | undefined,
    detailed: boolean
  ): Promise<PickResult> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<PickResult>((resolve, reject) => {
      this.pending.push({
        x,
        y,
        filter,
        options,
        detailed,
        resolve: (result) => {
          this.active--;
          resolve(result);
        },
        reject: (error) => {
          this.active--;
          reject(error);
        }
      });
    });
  }

  hit(
    mesh: Mesh,
    point: readonly [number, number, number] = [1, 2, 3],
    overrides: Partial<PickResult> = {}
  ): void {
    const request = this.pending.shift();
    if (!request) throw new Error("No pending pick");
    request.resolve(
      request.filter(mesh)
        ? {
            pickedMesh: mesh,
            pickedPoint: point,
            distance: 5,
            thinInstanceIndex: -1,
            detailedRequested: request.detailed,
            details: null,
            ...overrides
          }
        : {
            pickedMesh: null,
            pickedPoint: null,
            distance: null,
            thinInstanceIndex: -1,
            detailedRequested: false,
            details: null
          }
    );
  }

  miss(): void {
    const request = this.pending.shift();
    if (!request) throw new Error("No pending pick");
    request.resolve({
      pickedMesh: null,
      pickedPoint: null,
      distance: null,
      thinInstanceIndex: -1,
      detailedRequested: false,
      details: null
    });
  }

  fail(error: unknown): void {
    const request = this.pending.shift();
    if (!request) throw new Error("No pending pick");
    request.reject(error);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function setup(overrides: Partial<InteractionManagerOptions> = {}) {
  const canvas = new FakeCanvas();
  const picker = new FakePicker();
  const frames = new ManualFrames();
  const clock = new ManualClock();
  const options: InteractionManagerOptions = {
    scene: {} as SceneContext,
    canvas: canvas as unknown as HTMLCanvasElement,
    ...overrides
  };
  const manager = createManagerInternal(options, picker, frames, clock);
  const mesh = {} as Mesh;
  const otherMesh = {} as Mesh;
  return { canvas, picker, frames, clock, manager, mesh, otherMesh };
}

function pointer(
  type: string,
  init: Partial<PointerEvent> & { clientX?: number; clientY?: number; timeStamp?: number } = {}
): Event {
  const event = new Event(type, { cancelable: true });
  const values = {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: 110,
    clientY: 120,
    timeStamp: 100,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("interaction manager", () => {
  it("preserves Lite 1.14 barycentric coordinates for detailed VAT picks", () => {
    const result = {
      hit: true,
      faceId: 7,
      bu: 0.2,
      bv: 0.3,
      subMeshId: 0,
      thinInstanceIndex: 4,
      pickedNormal: null,
      pickedNormalWorld: null,
      pickedFaceNormal: null,
      pickedFaceNormalWorld: null,
      pickedMesh: null
    } as PickingInfo;

    expect(toInteractionPickDetails(result, true)).toMatchObject({
      faceId: 7,
      vertexIndices: null,
      barycentric: [0.2, 0.3, 0.5],
      bu: 0.2,
      bv: 0.3,
      thinInstanceIndex: 4,
      pickedUV: null
    });
    expect(toInteractionPickDetails(result, false)).toBeNull();
  });

  it("interpolates arbitrary VAT vertex attributes from picked triangle weights", () => {
    const details = {
      faceId: 2,
      vertexIndices: [0, 1, 2] as const,
      barycentric: [0.2, 0.3, 0.5] as const
    } as NonNullable<PickResult["details"]>;
    const values = new Float32Array([0, 0, 10, 0, 0, 20]);
    expect(Array.from(interpolatePickedAttribute(details, values, 2)!)).toEqual([3, 10]);
  });

  it("exposes only the supported runtime API surface", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "createInteractionManager",
      "disposeInteractionManager",
      "disposeInteractionTarget",
      "getActivePointers",
      "getHoveredTarget",
      "getInteractionDiagnostics",
      "getPressedTarget",
      "interpolatePickedAttribute",
      "isInteractionEnabled",
      "isTargetHovered",
      "isTargetPressed",
      "onInteraction",
      "onInteractionEvent",
      "registerMesh",
      "setInteractionEnabled",
      "setInteractionFilter"
    ]);
  });

  it("defaults omitted detailed-picking workloads to basic picks", async () => {
    const { canvas, picker, frames, manager, mesh } = setup({
      detailedPicking: { discrete: true }
    });
    registerMesh(manager, mesh);

    canvas.dispatchEvent(pointer("pointermove"));
    frames.flush();
    expect(picker.pending[0]?.detailed).toBe(false);
    picker.miss();
    await settle();

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(picker.pending[0]?.detailed).toBe(true);
    picker.hit(mesh);
    await settle();
  });

  it("reports immutable queue, coalescing, workload, and timing diagnostics", async () => {
    const { canvas, picker, frames, clock, manager, mesh } = setup({ onError() {} });
    registerMesh(manager, mesh);

    canvas.dispatchEvent(pointer("pointermove", { clientX: 120 }));
    clock.advance(5);
    canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    expect(getInteractionDiagnostics(manager)).toMatchObject({
      queuedHover: 1,
      coalescedHoverSamples: 1,
      inFlightKind: null,
      completedPicks: 0
    });

    clock.advance(5);
    frames.flush();
    expect(getInteractionDiagnostics(manager)).toMatchObject({
      queuedHover: 0,
      inFlightKind: "hover",
      lastSchedulerWaitMs: 5
    });
    clock.advance(20);
    picker.miss();
    await settle();

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(getInteractionDiagnostics(manager).inFlightKind).toBe("discrete");
    clock.advance(8);
    picker.fail(new Error("diagnostic failure"));
    await settle();

    const diagnostics = getInteractionDiagnostics(manager);
    expect(diagnostics).toMatchObject({
      queuedDiscrete: 0,
      queuedHover: 0,
      queuedDrag: 0,
      inFlightKind: null,
      completedPicks: 1,
      failedPicks: 1,
      coalescedHoverSamples: 1,
      coalescedDragSamples: 0,
      lastSchedulerWaitMs: 0,
      lastPickDurationMs: 8,
      averagePickDurationMs: 14,
      maximumPickDurationMs: 20
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });

  it("selects detailed picking independently for discrete, drag, and hover work", async () => {
    const policy = { discrete: true, drag: false, hover: true };
    const { canvas, picker, frames, manager, mesh, otherMesh } = setup({
      detailedPicking: policy,
      drag: { surfaceFilter: () => true }
    });
    policy.drag = true;
    registerMesh(manager, mesh);

    canvas.dispatchEvent(pointer("pointermove"));
    frames.flush();
    expect(picker.pending[0]?.detailed).toBe(true);
    picker.hit(mesh);
    await settle();

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(picker.pending[0]?.detailed).toBe(true);
    picker.hit(mesh);
    await settle();

    canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    expect(picker.pending[0]?.detailed).toBe(false);
    picker.hit(otherMesh);
    await settle();
  });

  it("forwards per-event Lite pick options and resolves stable thin-instance IDs", async () => {
    const contexts: string[] = [];
    const discard = {
      key: "test",
      wgsl: "fn shouldDiscardPick(input: PickDiscardInput) -> bool { return false; }"
    };
    const { canvas, picker, manager, mesh } = setup({
      detailedPicking: { discrete: true, drag: true, hover: true },
      pickOptions(context) {
        contexts.push(`${context.kind}:${context.eventType}`);
        return { discard, debugLabel: context.eventType };
      }
    });
    const target = registerMesh(manager, mesh, { resolveInstanceId: (slot) => `vat-${slot}` });
    let received: { instanceId: string | number | null; status: string; slot: number } | undefined;
    onInteraction(target, "pointerdown", (event) => {
      received = {
        instanceId: event.instanceId,
        status: event.pickDetailsStatus,
        slot: event.thinInstanceIndex
      };
    });

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(picker.pending[0]?.options).toMatchObject({ discard, debugLabel: "pointerdown" });
    picker.hit(mesh, [1, 2, 3], { thinInstanceIndex: 6 });
    await settle();
    expect(contexts).toEqual(["discrete:pointerdown"]);
    expect(received).toEqual({ instanceId: "vat-6", status: "unavailable", slot: 6 });
  });

  it("coalesces drag picks, ignores the dragged identity, and emits drag lifecycle events", async () => {
    const { canvas, picker, manager, mesh, otherMesh } = setup({
      drag: { surfaceFilter: () => true },
      detailedPicking: { discrete: true, drag: true, hover: false }
    });
    const target = registerMesh(manager, mesh, { resolveInstanceId: (slot) => `stable-${slot}` });
    const events: string[] = [];
    let endReason: string | undefined;
    let dragIdentity: unknown;
    for (const type of ["dragstart", "drag", "dragend"] as const) {
      onInteraction(target, type, (event) => {
        events.push(event.type);
        if (event.type === "dragend") endReason = event.dragEndReason;
        if (event.type === "drag") {
          dragIdentity = {
            mesh: event.mesh,
            pickedMesh: event.pickedMesh,
            thinInstanceIndex: event.thinInstanceIndex,
            pickedThinInstanceIndex: event.pickedThinInstanceIndex,
            instanceId: event.instanceId
          };
        }
      });
    }

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 100 }));
    picker.hit(mesh, [1, 2, 3], { thinInstanceIndex: 4 });
    await settle();
    canvas.dispatchEvent(pointer("pointermove", { clientX: 130, timeStamp: 120 }));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 140, timeStamp: 130 }));
    expect(events).toEqual(["dragstart"]);
    expect(picker.pending[0]?.x).toBe(120);
    picker.hit(otherMesh, [3, 4, 5], { thinInstanceIndex: 1 });
    await settle();
    expect(events).toEqual(["dragstart", "drag"]);
    expect(picker.pending[0]?.x).toBe(130);
    expect(picker.pending[0]?.detailed).toBe(true);
    expect(picker.pending[0]?.options?.ignore).toEqual({ mesh, thinInstanceIndex: 4 });
    picker.hit(otherMesh, [4, 5, 6], { thinInstanceIndex: 2 });
    await settle();
    expect(events).toEqual(["dragstart", "drag", "drag"]);
    expect(dragIdentity).toEqual({
      mesh,
      pickedMesh: otherMesh,
      thinInstanceIndex: 4,
      pickedThinInstanceIndex: 2,
      instanceId: "stable-4"
    });

    canvas.dispatchEvent(pointer("pointerup", { clientX: 140, timeStamp: 150 }));
    picker.hit(mesh);
    await settle();
    expect(events).toEqual(["dragstart", "drag", "drag", "dragend"]);
    expect(endReason).toBe("released");
  });

  it("ends a cancelled drag exactly once and releases pointer capture", async () => {
    const { canvas, picker, manager, mesh, otherMesh } = setup({
      drag: { surfaceFilter: () => true }
    });
    const target = registerMesh(manager, mesh);
    const reasons: string[] = [];
    onInteraction(target, "dragend", (event) => reasons.push(event.dragEndReason));

    canvas.dispatchEvent(pointer("pointerdown"));
    picker.hit(mesh);
    await settle();
    canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    expect(canvas.capturedPointers.has(1)).toBe(true);

    canvas.dispatchEvent(pointer("pointercancel", { clientX: 130, buttons: 0 }));
    canvas.dispatchEvent(pointer("pointercancel", { clientX: 130, buttons: 0 }));
    expect(reasons).toEqual(["pointercancel"]);
    expect(canvas.capturedPointers.has(1)).toBe(false);
    expect(canvas.releasedPointers).toEqual([1]);
    expect(getActivePointers(manager)).toEqual([]);

    picker.hit(otherMesh);
    await settle();
    expect(reasons).toEqual(["pointercancel"]);
  });

  it("ends active drags when interaction is disabled or their target is disposed", async () => {
    const disabled = setup({ drag: { surfaceFilter: () => true } });
    const disabledTarget = registerMesh(disabled.manager, disabled.mesh);
    const disabledReasons: string[] = [];
    onInteraction(disabledTarget, "dragend", (event) => disabledReasons.push(event.dragEndReason));

    disabled.canvas.dispatchEvent(pointer("pointerdown"));
    disabled.picker.hit(disabled.mesh);
    await settle();
    disabled.canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    setInteractionEnabled(disabled.manager, false);
    setInteractionEnabled(disabled.manager, false);
    expect(disabledReasons).toEqual(["disabled"]);
    expect(disabled.canvas.capturedPointers.size).toBe(0);
    disabled.picker.hit(disabled.otherMesh);
    await settle();

    const disposed = setup({ drag: { surfaceFilter: () => true } });
    const disposedTarget = registerMesh(disposed.manager, disposed.mesh);
    const disposedReasons: string[] = [];
    onInteraction(disposedTarget, "dragend", (event) => disposedReasons.push(event.dragEndReason));

    disposed.canvas.dispatchEvent(pointer("pointerdown"));
    disposed.picker.hit(disposed.mesh);
    await settle();
    disposed.canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    disposeInteractionTarget(disposedTarget);
    disposeInteractionTarget(disposedTarget);
    expect(disposedReasons).toEqual(["target-disposed"]);
    expect(disposed.canvas.capturedPointers.size).toBe(0);
    disposed.picker.hit(disposed.otherMesh);
    await settle();
  });

  it("terminates every active pointer on disable and keeps manager disposal quiet", async () => {
    const multi = setup({ drag: { surfaceFilter: () => true } });
    const target = registerMesh(multi.manager, multi.mesh);
    const endings: Array<[number, string]> = [];
    onInteraction(target, "dragend", (event) => endings.push([event.pointerId, event.dragEndReason]));

    multi.canvas.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));
    multi.canvas.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    multi.picker.hit(multi.mesh);
    await settle();
    multi.picker.hit(multi.mesh);
    await settle();
    multi.canvas.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 130 }));
    multi.canvas.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));

    setInteractionEnabled(multi.manager, false);
    expect(endings).toEqual([
      [1, "disabled"],
      [2, "disabled"]
    ]);
    expect(multi.canvas.capturedPointers.size).toBe(0);
    multi.picker.hit(multi.otherMesh);
    await settle();

    const quiet = setup({ drag: { surfaceFilter: () => true } });
    const quietTarget = registerMesh(quiet.manager, quiet.mesh);
    const quietReasons: string[] = [];
    onInteraction(quietTarget, "dragend", (event) => quietReasons.push(event.dragEndReason));
    quiet.canvas.dispatchEvent(pointer("pointerdown"));
    quiet.picker.hit(quiet.mesh);
    await settle();
    quiet.canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    disposeInteractionManager(quiet.manager);
    expect(quietReasons).toEqual([]);
    expect(quiet.canvas.capturedPointers.size).toBe(0);
    quiet.picker.hit(quiet.otherMesh);
    await settle();
    expect(quiet.picker.disposed).toBe(true);
  });

  it("registers opaque targets and rejects duplicate mesh registration", () => {
    const { manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    expect(target.mesh).toBe(mesh);
    expect(() => registerMesh(manager, mesh)).toThrow(/already registered/);
    disposeInteractionTarget(target);
    expect(() => registerMesh(manager, mesh)).not.toThrow();
  });

  it("dispatches target listeners before globals and honors stopPropagation", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const calls: string[] = [];
    onInteraction(target, "pointerdown", (event) => {
      calls.push("target-1");
      event.stopPropagation();
    });
    onInteraction(target, "pointerdown", () => calls.push("target-2"));
    onInteractionEvent(manager, "pointerdown", () => calls.push("global"));

    canvas.dispatchEvent(pointer("pointerdown"));
    picker.hit(mesh);
    await settle();
    expect(calls).toEqual(["target-1", "target-2"]);
  });

  it("reports listener and picker failures without breaking dispatch", async () => {
    const errors: unknown[] = [];
    const { canvas, picker, manager, mesh } = setup({ onError: (error) => errors.push(error) });
    const target = registerMesh(manager, mesh);
    const calls: string[] = [];
    onInteraction(target, "pointerdown", () => {
      throw new Error("listener");
    });
    onInteraction(target, "pointerdown", () => calls.push("continued"));
    canvas.dispatchEvent(pointer("pointerdown"));
    picker.hit(mesh);
    await settle();
    expect(calls).toEqual(["continued"]);

    canvas.dispatchEvent(pointer("pointerup", { timeStamp: 120 }));
    picker.fail(new Error("pick"));
    await settle();
    expect(errors).toHaveLength(2);
  });

  it("serializes down and up picks and emits click after matching results", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const events: string[] = [];
    for (const type of ["pointerdown", "pointerup", "click"] as const) {
      onInteraction(target, type, (event) => {
        events.push(event.type);
        expect(event.canvasX).toBe(100);
        expect(event.canvasY).toBe(100);
      });
    }

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 100 }));
    canvas.dispatchEvent(pointer("pointerup", { timeStamp: 140 }));
    expect(picker.pending).toHaveLength(1);
    picker.hit(mesh);
    await settle();
    expect(picker.pending).toHaveLength(1);
    picker.hit(mesh);
    await settle();
    expect(events).toEqual(["pointerdown", "pointerup", "click"]);
    expect(picker.maxActive).toBe(1);
  });

  it("rejects clicks exceeding movement, duration, or matching targets", async () => {
    const { canvas, picker, manager, mesh, otherMesh } = setup();
    const target = registerMesh(manager, mesh);
    registerMesh(manager, otherMesh);
    let clicks = 0;
    onInteraction(target, "click", () => clicks++);

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 0 }));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 130, timeStamp: 10 }));
    canvas.dispatchEvent(pointer("pointerup", { clientX: 130, timeStamp: 20 }));
    picker.hit(mesh);
    await settle();
    picker.hit(mesh);
    await settle();

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 1000 }));
    canvas.dispatchEvent(pointer("pointerup", { timeStamp: 1600 }));
    picker.hit(mesh);
    await settle();
    picker.hit(mesh);
    await settle();

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 2000 }));
    canvas.dispatchEvent(pointer("pointerup", { timeStamp: 2020 }));
    picker.hit(mesh);
    await settle();
    picker.hit(otherMesh);
    await settle();
    expect(clicks).toBe(0);
  });

  it("uses touch thresholds and rejects non-primary clicks", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    let clicks = 0;
    onInteraction(target, "click", () => clicks++);

    canvas.dispatchEvent(pointer("pointerdown", { pointerType: "touch", clientX: 100, timeStamp: 0 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerType: "touch", clientX: 110, timeStamp: 30 }));
    picker.hit(mesh);
    await settle();
    picker.hit(mesh);
    await settle();

    canvas.dispatchEvent(pointer("pointerdown", { button: 2, timeStamp: 100 }));
    canvas.dispatchEvent(pointer("pointerup", { button: 2, timeStamp: 120 }));
    picker.hit(mesh);
    await settle();
    picker.hit(mesh);
    await settle();
    expect(clicks).toBe(1);
  });

  it("delivers middle-button down and up without click events", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const events: Array<{ type: string; button: number; buttons: number }> = [];
    for (const type of ["pointerdown", "pointerup", "click", "doubleclick"] as const) {
      onInteraction(target, type, (event) => {
        events.push({ type: event.type, button: event.button, buttons: event.buttons });
      });
    }

    canvas.dispatchEvent(pointer("pointerdown", { button: 1, buttons: 4, timeStamp: 100 }));
    canvas.dispatchEvent(pointer("pointerup", { button: 1, buttons: 0, timeStamp: 120 }));
    picker.hit(mesh);
    await settle();
    picker.hit(mesh);
    await settle();

    expect(events).toEqual([
      { type: "pointerdown", button: 1, buttons: 4 },
      { type: "pointerup", button: 1, buttons: 0 }
    ]);
  });

  it("cancels pointer sessions and ignores targets disposed during a pick", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const events: string[] = [];
    onInteraction(target, "pointerdown", ({ type }) => events.push(type));
    onInteraction(target, "click", ({ type }) => events.push(type));

    canvas.dispatchEvent(pointer("pointerdown"));
    canvas.dispatchEvent(pointer("pointercancel"));
    picker.hit(mesh);
    await settle();
    expect(events).toEqual([]);

    canvas.dispatchEvent(pointer("pointerdown", { timeStamp: 200 }));
    disposeInteractionTarget(target);
    picker.hit(mesh);
    await settle();
    expect(events).toEqual([]);
  });

  it("emits two clicks and one doubleclick for a matching pair", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const events: string[] = [];
    onInteraction(target, "click", ({ type }) => events.push(type));
    onInteraction(target, "doubleclick", ({ type }) => events.push(type));

    for (const base of [100, 300]) {
      canvas.dispatchEvent(pointer("pointerdown", { timeStamp: base }));
      canvas.dispatchEvent(pointer("pointerup", { timeStamp: base + 20 }));
      picker.hit(mesh);
      await settle();
      picker.hit(mesh);
      await settle();
    }
    expect(events).toEqual(["click", "click", "doubleclick"]);
  });

  it("coalesces hover once per frame and orders hover transitions", async () => {
    const { canvas, picker, frames, manager, mesh, otherMesh } = setup();
    const first = registerMesh(manager, mesh);
    const second = registerMesh(manager, otherMesh);
    const events: string[] = [];
    for (const target of [first, second]) {
      for (const type of ["hoverstart", "hovermove", "hoverend"] as const) {
        onInteraction(target, type, () => events.push(`${target === first ? "first" : "second"}:${type}`));
      }
    }

    canvas.dispatchEvent(pointer("pointermove", { clientX: 20 }));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 30 }));
    expect(picker.pending).toHaveLength(0);
    frames.flush();
    expect(picker.pending[0]?.x).toBe(20);
    picker.hit(mesh);
    await settle();
    expect(getHoveredTarget(manager)).toBe(first);

    canvas.dispatchEvent(pointer("pointermove", { clientX: 40 }));
    frames.flush();
    picker.hit(mesh);
    await settle();
    canvas.dispatchEvent(pointer("pointermove", { clientX: 50 }));
    frames.flush();
    picker.hit(otherMesh);
    await settle();
    expect(events).toEqual([
      "first:hoverstart",
      "first:hovermove",
      "first:hoverend",
      "second:hoverstart"
    ]);
  });

  it("discards stale hover results and clears hover on leave and target disposal", async () => {
    const { canvas, picker, frames, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    const events: string[] = [];
    onInteraction(target, "hoverstart", ({ type }) => events.push(type));
    onInteraction(target, "hoverend", ({ type }) => events.push(type));

    canvas.dispatchEvent(pointer("pointermove"));
    frames.flush();
    canvas.dispatchEvent(pointer("pointermove", { clientX: 130 }));
    picker.hit(mesh);
    await settle();
    expect(events).toEqual([]);
    frames.flush();
    picker.hit(mesh);
    await settle();
    canvas.dispatchEvent(pointer("pointerleave"));
    expect(events).toEqual(["hoverstart", "hoverend"]);

    canvas.dispatchEvent(pointer("pointermove"));
    frames.flush();
    picker.hit(mesh);
    await settle();
    disposeInteractionTarget(target);
    expect(events).toEqual(["hoverstart", "hoverend", "hoverstart", "hoverend"]);
  });

  it("tracks pressed state only while the pointer remains down", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    canvas.dispatchEvent(pointer("pointerdown"));
    picker.hit(mesh);
    await settle();
    expect(getPressedTarget(manager, 1)).toBe(target);
    canvas.dispatchEvent(pointer("pointerup", { timeStamp: 120 }));
    expect(getPressedTarget(manager, 1)).toBeNull();
    picker.hit(mesh);
    await settle();
  });

  it("disables pending work and disposes the picker after active work settles", async () => {
    const { canvas, picker, manager, mesh } = setup();
    const target = registerMesh(manager, mesh);
    let calls = 0;
    onInteraction(target, "pointerdown", () => calls++);
    canvas.dispatchEvent(pointer("pointerdown"));
    setInteractionEnabled(manager, false);
    expect(isInteractionEnabled(manager)).toBe(false);
    picker.hit(mesh);
    await settle();
    expect(calls).toBe(0);

    setInteractionEnabled(manager, true);
    canvas.dispatchEvent(pointer("pointerdown"));
    disposeInteractionManager(manager);
    expect(picker.disposed).toBe(false);
    picker.hit(mesh);
    await settle();
    expect(picker.disposed).toBe(true);
    expect(() => disposeInteractionManager(manager)).not.toThrow();
  });

  it("applies browser default options synchronously", () => {
    const { canvas, manager } = setup({ preventPointerDefault: true, preventContextMenu: true });
    const down = pointer("pointerdown");
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const menu = pointer("contextmenu");
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    disposeInteractionManager(manager);
  });

  it("picks registered meshes only and applies the additional filter", async () => {
    const blocked = {} as Mesh;
    const { canvas, picker, manager, mesh, otherMesh } = setup({ filter: (candidate) => candidate !== blocked });
    registerMesh(manager, mesh);
    registerMesh(manager, blocked);
    canvas.dispatchEvent(pointer("pointerdown"));
    expect(picker.pending[0]?.filter(otherMesh)).toBe(false);
    expect(picker.pending[0]?.filter(mesh)).toBe(true);
    expect(picker.pending[0]?.filter(blocked)).toBe(false);
    picker.miss();
    await settle();
  });
});
