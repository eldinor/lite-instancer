import type { Mesh } from "@babylonjs/lite";
import {
  disposeInteractionTarget,
  registerMesh,
  type InteractionManager,
  type InteractionTarget
} from "@litools/interacter";
import { InstancerError } from "./errors.js";
import type { BaseInstanceSet, InstanceId } from "./types.js";

/** Minimal stable-ID surface required by the Interacter adapter. */
export type InteractableInstanceSource = Pick<BaseInstanceSet<unknown>, "getIdForSlot">;

/** A stable-ID instance source backed by one Babylon Lite mesh. */
export interface InteractableSingleMeshSource extends InteractableInstanceSource {
  readonly mesh: Mesh;
}

/** Disposable group returned when several meshes represent one logical instance source. */
export interface InstancerInteractionBinding {
  readonly source: InteractableInstanceSource;
  readonly targets: readonly InteractionTarget[];
  readonly disposed: boolean;
  dispose(): void;
}

/**
 * Register an ordinary or VAT `InstanceSet` with Interacter.
 *
 * The resolver reads the current slot mapping for every event, so removal,
 * visibility packing, and slot compaction cannot leak renderer slots as IDs.
 */
export function registerInstanceSet(
  manager: InteractionManager,
  source: InteractableSingleMeshSource
): InteractionTarget {
  return registerMesh(manager, source.mesh, {
    resolveInstanceId: createStableIdResolver(source)
  });
}

/**
 * Register every backing mesh for a hierarchy or other multi-mesh instance source.
 *
 * Meshes are explicit because Instancer's common `BaseInstanceSet` contract does
 * not expose hierarchy internals. Registration is atomic: if one mesh fails,
 * targets already created by this call are disposed before the error is rethrown.
 */
export function registerInstanceSetMeshes(
  manager: InteractionManager,
  source: InteractableInstanceSource,
  meshes: Iterable<Mesh>
): InstancerInteractionBinding {
  const targets: InteractionTarget[] = [];
  const resolver = createStableIdResolver(source);
  try {
    for (const mesh of meshes) {
      targets.push(registerMesh(manager, mesh, { resolveInstanceId: resolver }));
    }
  } catch (error) {
    for (let index = targets.length - 1; index >= 0; index--) {
      disposeInteractionTarget(targets[index]!);
    }
    throw error;
  }
  if (targets.length === 0) {
    throw new InstancerError("Interacter multi-mesh registration requires at least one mesh");
  }
  return createBinding(source, targets);
}

function createStableIdResolver(
  source: InteractableInstanceSource
): (thinInstanceIndex: number) => InstanceId | null {
  return (thinInstanceIndex) => source.getIdForSlot(thinInstanceIndex) ?? null;
}

function createBinding(
  source: InteractableInstanceSource,
  mutableTargets: InteractionTarget[]
): InstancerInteractionBinding {
  const targets = Object.freeze([...mutableTargets]);
  let disposed = false;
  return Object.freeze({
    source,
    targets,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = targets.length - 1; index >= 0; index--) {
        disposeInteractionTarget(targets[index]!);
      }
    }
  });
}
