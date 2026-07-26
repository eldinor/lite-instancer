import type { Mesh } from "@babylonjs/lite";
import type { InteractionManager, InteractionTarget } from "@litools/interacter";
import { InstanceSlotStore } from "../src/slot-store.js";
import { toInstanceId } from "../src/types.js";

const interacterMocks = vi.hoisted(() => ({
  disposeInteractionTarget: vi.fn(),
  registerMesh: vi.fn()
}));

vi.mock("@litools/interacter", () => interacterMocks);

import {
  registerInstanceSet,
  registerInstanceSetMeshes,
  type InteractableInstanceSource
} from "../src/interacter.js";

const manager = {} as InteractionManager;

beforeEach(() => {
  interacterMocks.disposeInteractionTarget.mockReset();
  interacterMocks.registerMesh.mockReset();
  interacterMocks.registerMesh.mockImplementation((_manager, mesh) => ({ mesh }) as InteractionTarget);
});

it("resolves the live stable ID after slot compaction", () => {
  const mesh = fakeMesh("single");
  const slots = new InstanceSlotStore("adapter test");
  const first = slots.create().id;
  const second = slots.create().id;
  registerInstanceSet(manager, {
    mesh,
    getIdForSlot: (slot) => slots.getIdForSlot(slot)
  });

  const options = interacterMocks.registerMesh.mock.calls[0]![2]!;
  expect(options.resolveInstanceId(0)).toBe(first);
  slots.remove(first, () => {});
  expect(options.resolveInstanceId(0)).toBe(second);
  expect(options.resolveInstanceId(1)).toBeNull();
  slots.remove(second, () => {});
  expect(options.resolveInstanceId(0)).toBeNull();
});

it("registers and disposes a multi-mesh source as one idempotent binding", () => {
  const source: InteractableInstanceSource = { getIdForSlot: () => toInstanceId(7) };
  const meshes = [fakeMesh("body"), fakeMesh("tool")];
  const binding = registerInstanceSetMeshes(manager, source, meshes);

  expect(binding.source).toBe(source);
  expect(binding.targets.map((target) => target.mesh)).toEqual(meshes);
  expect(Object.isFrozen(binding.targets)).toBe(true);
  expect(binding.disposed).toBe(false);

  binding.dispose();
  binding.dispose();

  expect(binding.disposed).toBe(true);
  expect(interacterMocks.disposeInteractionTarget.mock.calls.map(([target]) => target.mesh.name)).toEqual([
    "tool",
    "body"
  ]);
});

it("rolls back earlier targets when multi-mesh registration fails", () => {
  const first = fakeMesh("first");
  const second = fakeMesh("second");
  const firstTarget = { mesh: first } as InteractionTarget;
  interacterMocks.registerMesh
    .mockReturnValueOnce(firstTarget)
    .mockImplementationOnce(() => {
      throw new Error("already registered");
    });

  expect(() => registerInstanceSetMeshes(
    manager,
    { getIdForSlot: () => toInstanceId(1) },
    [first, second]
  )).toThrow("already registered");
  expect(interacterMocks.disposeInteractionTarget).toHaveBeenCalledWith(firstTarget);
});

it("rejects an empty multi-mesh registration", () => {
  expect(() => registerInstanceSetMeshes(
    manager,
    { getIdForSlot: () => undefined },
    []
  )).toThrow("requires at least one mesh");
});

function fakeMesh(name: string): Mesh {
  return { name } as Mesh;
}
