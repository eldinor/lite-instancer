import { describe, expect, it } from "vitest";
import { PickingRegistry } from "../src/picking-registry.js";
import { toInstanceId } from "../src/types.js";

describe("PickingRegistry", () => {
  it("maps mesh and thin instance slot to stable id", () => {
    const registry = new PickingRegistry();
    const mesh = {} as never;
    const id = toInstanceId(42);
    const set = {
      getIdForSlot: (slot: number) => (slot === 3 ? id : undefined)
    } as never;

    registry.register(mesh, set);

    expect(registry.get(mesh, 3)?.id).toBe(id);
    expect(registry.fromPick({ mesh, thinInstanceIndex: 3 })?.id).toBe(id);
    expect(registry.get(mesh, 4)).toBeUndefined();
  });
});
