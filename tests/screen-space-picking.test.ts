import { describe, expect, it, vi } from "vitest";
import { toInstanceId } from "../src/types.js";

vi.mock("@babylonjs/lite", () => ({
  getViewProjectionMatrix: vi.fn(() => new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]))
}));

describe("screen-space picking", () => {
  it("chooses the nearest projected visible id", async () => {
    const { pickScreenSpaceInstance } = await import("../src/screen-space-picking.js");
    const near = toInstanceId(1);
    const far = toInstanceId(2);

    const picked = pickScreenSpaceInstance({
      ids: [far, near],
      camera: {} as never,
      viewport: { width: 100, height: 100 },
      point: { x: 53, y: 50 },
      getWorldPosition: (id) => id === near ? [0.04, 0, 0] : [0.2, 0, 0],
      getScreenRadius: () => 20
    });

    expect(picked?.id).toBe(near);
  });

  it("skips hidden and missing ids", async () => {
    const { pickScreenSpaceInstance } = await import("../src/screen-space-picking.js");
    const hidden = toInstanceId(1);
    const missing = toInstanceId(2);
    const visible = toInstanceId(3);

    const picked = pickScreenSpaceInstance({
      ids: [hidden, missing, visible],
      camera: {} as never,
      viewport: { width: 100, height: 100 },
      point: { x: 50, y: 50 },
      has: (id) => id !== missing,
      isVisible: (id) => id !== hidden,
      getWorldPosition: () => [0, 0, 0],
      getScreenRadius: () => 20
    });

    expect(picked?.id).toBe(visible);
  });
});
