import { describe, expect, it } from "vitest";
import { belongsToHierarchyRoot, PickingRegistry } from "../src/picking-registry.js";
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

  it("checks whether a picked child belongs to a hierarchy root", () => {
    const root = { children: [], parent: null };
    const child = { children: [], parent: root };
    const mesh = { parent: child };
    const otherRoot = { children: [], parent: null };

    expect(belongsToHierarchyRoot(mesh, root as never)).toBe(true);
    expect(belongsToHierarchyRoot(root, root as never)).toBe(true);
    expect(belongsToHierarchyRoot(mesh, otherRoot as never)).toBe(false);
    expect(belongsToHierarchyRoot(null, root as never)).toBe(false);
  });
});
