import { createVatInstanceControlAdapter, defineInstanceControls } from "../src/instance-controls.js";
import { toInstanceId } from "../src/types.js";
import type { VatInstanceSet } from "../src/vat-instance-set.js";

describe("instance controls", () => {
  it("validates descriptor ranges and choices", () => {
    expect(() => defineInstanceControls({ speed: { type: "number", min: 2, max: 1 } })).toThrow(/min/i);
    expect(() => defineInstanceControls({ clip: { type: "enum", values: ["Idle", "Idle"] } })).toThrow(/unique/i);
  });

  it("adapts friendly values onto stable-ID VAT methods", () => {
    const id = toInstanceId(1);
    const setClip = vi.fn(() => true);
    const setFps = vi.fn();
    const source = {
      clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
      has: () => true,
      getClip: () => "Idle",
      getVisible: () => true,
      getColor: () => new Float32Array([1, 1, 1, 1]),
      getPlaybackSample: () => ({ clip: "Idle", timeSeconds: 0, offsetSeconds: 0, fps: 30, frame: 0, nextFrame: 1, alpha: 0 }),
      setClip,
      setFps,
      setPhaseOffset: vi.fn(),
      setVisible: vi.fn(),
      setColor: vi.fn()
    } as unknown as VatInstanceSet;
    const adapter = createVatInstanceControlAdapter(source);
    expect(adapter.set(id, "clip", "Idle")).toBe(true);
    expect(adapter.set(id, "speed", 24)).toBe(true);
    expect(setClip).toHaveBeenCalledWith(id, "Idle");
    expect(setFps).toHaveBeenCalledWith(id, 24);
  });
});
