import type { Mesh } from "@babylonjs/lite";
import type { HierarchyInstanceSet } from "./hierarchy-instance-set.js";
import type { InstanceSet } from "./instance-set.js";
import type { InstanceId } from "./types.js";

export type PickableInstanceSet = InstanceSet<unknown> | HierarchyInstanceSet<unknown>;

export interface InstancePick {
  set: PickableInstanceSet;
  id: InstanceId;
  slot: number;
  mesh: Mesh;
}

export interface ThinInstancePickLike {
  mesh?: Mesh | null;
  pickedMesh?: Mesh | null;
  thinInstanceIndex?: number;
  hasThinInstance?: boolean;
}

export class PickingRegistry {
  #meshToSet = new Map<Mesh, PickableInstanceSet>();

  register(mesh: Mesh, set: PickableInstanceSet): this {
    this.#meshToSet.set(mesh, set);
    return this;
  }

  registerMany(meshes: Iterable<Mesh>, set: PickableInstanceSet): this {
    for (const mesh of meshes) {
      this.register(mesh, set);
    }
    return this;
  }

  unregister(mesh: Mesh): boolean {
    return this.#meshToSet.delete(mesh);
  }

  clear(): void {
    this.#meshToSet.clear();
  }

  get(mesh: Mesh, thinInstanceIndex: number): InstancePick | undefined {
    const set = this.#meshToSet.get(mesh);
    if (!set) {
      return undefined;
    }
    const id = set.getIdForSlot(thinInstanceIndex);
    if (id === undefined) {
      return undefined;
    }
    return {
      set,
      id,
      slot: thinInstanceIndex,
      mesh
    };
  }

  fromPick(pick: ThinInstancePickLike | null | undefined): InstancePick | undefined {
    if (!pick || pick.thinInstanceIndex === undefined || pick.thinInstanceIndex < 0) {
      return undefined;
    }
    if (pick.hasThinInstance === false) {
      return undefined;
    }
    const mesh = pick.mesh ?? pick.pickedMesh;
    if (!mesh) {
      return undefined;
    }
    return this.get(mesh, pick.thinInstanceIndex);
  }
}

export function createPickingRegistry(): PickingRegistry {
  return new PickingRegistry();
}
