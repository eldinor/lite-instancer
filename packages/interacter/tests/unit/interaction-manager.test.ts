import type { Mesh, SceneContext } from "@babylonjs/lite";
import * as publicApi from "../../src/index.js";
import {
  disposeInteractionManager,
  disposeInteractionTarget,
  getHoveredTarget,
  getPressedTarget,
  isInteractionEnabled,
  onInteraction,
  onInteractionEvent,
  registerMesh,
  setInteractionEnabled
} from "../../src/index.js";
import { createManagerInternal } from "../../src/interaction-manager.js";
import type { FrameDriver, PickDriver, PickResult } from "../../src/pick-scheduler.js";
import type { InteractionManager, InteractionManagerOptions } from "../../src/types.js";

class FakeCanvas extends EventTarget {
  getBoundingClientRect(): DOMRect {
    return { left: 10, top: 20, width: 640, height: 480 } as DOMRect;
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

class FakePicker implements PickDriver {
  readonly pending: Array<{
    x: number;
    y: number;
    filter: (mesh: Mesh) => boolean;
    resolve: (result: PickResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  active = 0;
  maxActive = 0;
  disposed = false;

  pick(x: number, y: number, filter: (mesh: Mesh) => boolean): Promise<PickResult> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<PickResult>((resolve, reject) => {
      this.pending.push({
        x,
        y,
        filter,
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

  hit(mesh: Mesh, point: readonly [number, number, number] = [1, 2, 3]): void {
    const request = this.pending.shift();
    if (!request) throw new Error("No pending pick");
    request.resolve(
      request.filter(mesh)
        ? { pickedMesh: mesh, pickedPoint: point, distance: 5 }
        : { pickedMesh: null, pickedPoint: null, distance: null }
    );
  }

  miss(): void {
    const request = this.pending.shift();
    if (!request) throw new Error("No pending pick");
    request.resolve({ pickedMesh: null, pickedPoint: null, distance: null });
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
  const options: InteractionManagerOptions = {
    scene: {} as SceneContext,
    canvas: canvas as HTMLCanvasElement,
    ...overrides
  };
  const manager = createManagerInternal(options, picker, frames);
  const mesh = {} as Mesh;
  const otherMesh = {} as Mesh;
  return { canvas, picker, frames, manager, mesh, otherMesh };
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
  it("keeps the version 0.1 runtime API surface stable", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "createInteractionManager",
      "disposeInteractionManager",
      "disposeInteractionTarget",
      "getActivePointers",
      "getHoveredTarget",
      "getPressedTarget",
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
