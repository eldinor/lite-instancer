import type { Mesh, SceneNode } from "@babylonjs/lite";
import type { HierarchyInstanceSet } from "./hierarchy-instance-set.js";
import type { InstanceSet } from "./instance-set.js";
import type { InstanceId } from "./types.js";

export type PickableInstanceSet = InstanceSet<unknown> | HierarchyInstanceSet<unknown>;

/** Result after mapping a Babylon Lite thin-instance pick back to a stable instance ID. */
export interface InstancePick {
  set: PickableInstanceSet;
  id: InstanceId;
  slot: number;
  mesh: Mesh;
}

/** Minimal shape accepted from Babylon Lite picking results. */
export interface ThinInstancePickLike {
  mesh?: Mesh | null;
  pickedMesh?: Mesh | null;
  thinInstanceIndex?: number;
  hasThinInstance?: boolean;
}

/** Minimal parent-linked scene node shape accepted by hierarchy pick filters. */
export interface ParentLinkedSceneNode {
  parent?: unknown;
}

/**
 * Maps Babylon Lite `mesh + thinInstanceIndex` picks back to stable `InstanceId` values.
 *
 * Use this for rigid thin instances and hierarchy pools. For VAT/skinned/deformed meshes where the
 * pick pass does not match the final visual shape, use screen-space logical picking instead.
 */
export class PickingRegistry {
  #meshToSet = new Map<Mesh, PickableInstanceSet>();

  /** Associate a backing mesh with an instance set. */
  register(mesh: Mesh, set: PickableInstanceSet): this {
    this.#meshToSet.set(mesh, set);
    return this;
  }

  /** Register every mesh in a hierarchy pool to the same instance set. */
  registerMany(meshes: Iterable<Mesh>, set: PickableInstanceSet): this {
    for (const mesh of meshes) {
      this.register(mesh, set);
    }
    return this;
  }

  /** Remove one mesh registration. */
  unregister(mesh: Mesh): boolean {
    return this.#meshToSet.delete(mesh);
  }

  /** Remove every registration. */
  clear(): void {
    this.#meshToSet.clear();
  }

  /** Resolve a registered mesh and current thin instance slot to a stable ID. */
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

  /** Resolve a Babylon Lite pick result to a stable ID. */
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

/** Create a new empty picking registry. */
export function createPickingRegistry(): PickingRegistry {
  return new PickingRegistry();
}

/**
 * Return true when `node` is `root` or has `root` in its parent chain.
 *
 * Use this as a first filter for GLB/hierarchy picking: it answers whether the picked child mesh
 * belongs to the expected loaded asset before resolving the final logical instance ID.
 */
export function belongsToHierarchyRoot(
  node: ParentLinkedSceneNode | null | undefined,
  root: SceneNode
): boolean {
  let current: unknown = node;
  const visited = new Set<unknown>();

  while (isParentLinkedSceneNode(current) && !visited.has(current)) {
    if (current === root) {
      return true;
    }
    visited.add(current);
    current = current.parent;
  }

  return false;
}

function isParentLinkedSceneNode(value: unknown): value is ParentLinkedSceneNode {
  return typeof value === "object" && value !== null;
}
