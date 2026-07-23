import {
  createVatInstanceControlAdapter,
  defineInstanceControls,
  defineVatInstanceControls
} from "../src/instance-controls.js";
import { toInstanceId } from "../src/types.js";
import type { VatInstanceSet } from "../src/vat-instance-set.js";

describe("Babylon.js instance controls", () => {
  it("validates and freezes the same descriptor contract as Lite", () => {
    expect(() => defineInstanceControls({ speed: { type: "number", min: 2, max: 1 } })).toThrow(/min/i);
    expect(() => defineInstanceControls({ speed: { type: "number", step: 0 } })).toThrow(/step/i);
    expect(() => defineInstanceControls({ clip: { type: "enum", values: ["Idle", "Idle"] } })).toThrow(/unique/i);
    expect(() => defineInstanceControls({ clip: { type: "enum", values: [] } })).toThrow(/choices/i);

    const controls = defineInstanceControls({ visible: { type: "boolean" as const } });
    expect(Object.isFrozen(controls)).toBe(true);
    expect(Object.isFrozen(controls.visible)).toBe(true);
  });

  it("creates VAT descriptors without reading or changing instance state", () => {
    const stateRead = vi.fn();
    const stateWrite = vi.fn();
    const source = {
      clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
      has: stateRead,
      getClip: stateRead,
      getVisible: stateRead,
      getColor: stateRead,
      getPlaybackSample: stateRead,
      setClip: stateWrite,
      setFps: stateWrite,
      setPhaseOffset: stateWrite,
      setVisible: stateWrite,
      setColor: stateWrite
    } as unknown as VatInstanceSet;

    const controls = defineVatInstanceControls(source, {
      equipment: ["Sword", "Shield"],
      sockets: ["RightHand"]
    });
    createVatInstanceControlAdapter(source);

    expect(Object.keys(controls)).toEqual(["clip", "speed", "phase", "visible", "tint", "equipment", "socket"]);
    expect(controls.clip).toMatchObject({ type: "enum", values: ["Idle"] });
    expect(stateRead).not.toHaveBeenCalled();
    expect(stateWrite).not.toHaveBeenCalled();
  });

  it("adapts friendly values onto stable-ID VAT methods", () => {
    const id = toInstanceId(1);
    const setClip = vi.fn(() => true);
    const setFps = vi.fn();
    const setPhaseOffset = vi.fn();
    const setVisible = vi.fn();
    const setColor = vi.fn();
    const source = {
      clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
      has: () => true,
      getClip: () => "Idle",
      getVisible: () => true,
      getColor: () => new Float32Array([1, 1, 1, 1]),
      getPlaybackSample: () => ({ clip: "Idle", timeSeconds: 0, offsetSeconds: 0.25, fps: 30, frame: 0, nextFrame: 1, alpha: 0 }),
      setClip,
      setFps,
      setPhaseOffset,
      setVisible,
      setColor
    } as unknown as VatInstanceSet;
    const adapter = createVatInstanceControlAdapter(source);

    expect(adapter.get(id, "clip")).toBe("Idle");
    expect(adapter.get(id, "speed")).toBe(30);
    expect(adapter.get(id, "phase")).toBe(0.25);
    expect(adapter.set(id, "clip", "Idle")).toBe(true);
    expect(adapter.set(id, "speed", 24)).toBe(true);
    expect(adapter.set(id, "phase", 0.5)).toBe(true);
    expect(adapter.set(id, "visible", false)).toBe(true);
    expect(adapter.set(id, "tint", [0.25, 0.5, 0.75, 1])).toBe(true);
    expect(adapter.set(id, "speed", Number.NaN)).toBe(false);
    expect(adapter.set(id, "tint", [1, 1, 1])).toBe(false);
    expect(setClip).toHaveBeenCalledWith(id, "Idle");
    expect(setFps).toHaveBeenCalledWith(id, 24);
    expect(setPhaseOffset).toHaveBeenCalledWith(id, 0.5);
    expect(setVisible).toHaveBeenCalledWith(id, false);
    expect(setColor).toHaveBeenCalledWith(id, [0.25, 0.5, 0.75, 1]);
  });
});
