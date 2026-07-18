import {
  disposeMeshGpu,
  removeFromScene,
  type AssetContainer,
  type Mesh,
  type SceneContext,
  type SceneNode
} from "@babylonjs/lite";

/** A resource with an idempotent release operation, such as a VAT character or attachment binding. */
export interface VatDisposable {
  /** Release the resource. Repeated calls must be safe. */
  dispose(): void;
}

/** Inputs for releasing loaded GLB containers and their related VAT resources. */
export interface DisposeVatGlbAssetsOptions {
  readonly scene: SceneContext;
  readonly containers: readonly AssetContainer[];
  readonly disposables?: readonly VatDisposable[];
}

/**
 * Completely release a loaded GLB container.
 *
 * Babylon Lite exposes `addToScene(container)` but not an inverse container API.
 * This removes every mesh from the scene (or directly frees meshes that were
 * never added), stops its container-owned animation callback, detaches its
 * nodes, and empties the container so it cannot keep the GLB alive.
 */
export function disposeGltfContainer(scene: SceneContext, container: AssetContainer): number {
  const meshes = collectContainerMeshes(container);
  for (const mesh of meshes) {
    if (scene.meshes.includes(mesh)) {
      removeFromScene(scene, mesh);
    } else {
      disposeMeshGpu(mesh);
    }
  }

  if (container.animationGroups) {
    const groups = new Set(container.animationGroups);
    for (let index = scene.animationGroups.length - 1; index >= 0; index--) {
      const group = scene.animationGroups[index];
      if (group && groups.has(group)) scene.animationGroups.splice(index, 1);
    }
    // addToScene() closes over this same array for its per-frame animation
    // callback, so clearing it makes that callback a no-op as well.
    container.animationGroups.length = 0;
  }

  for (const entity of container.entities) detachNodeTree(entity);
  container.entities.length = 0;
  delete container.camera;
  delete container.clearColor;
  delete container.materialVariants;
  delete container.xmpMetadata;
  delete container.skeletons;
  return meshes.length;
}

/** Dispose VAT wrappers first, then fully release every distinct GLB container. */
export function disposeVatGlbAssets(options: DisposeVatGlbAssetsOptions): void {
  for (const disposable of options.disposables ?? []) disposable.dispose();
  const containers = new Set(options.containers);
  for (const container of containers) disposeGltfContainer(options.scene, container);
}

function collectContainerMeshes(container: AssetContainer): Mesh[] {
  const meshes: Mesh[] = [];
  const visited = new Set<SceneNode>();
  const stack = container.entities.filter(isSceneNode);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (isMesh(node)) meshes.push(node);
    stack.push(...node.children);
  }
  return meshes;
}

function detachNodeTree(root: SceneNode | { children: SceneNode[]; parent: unknown }): void {
  const stack: Array<SceneNode | { children: SceneNode[]; parent: unknown }> = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    stack.push(...node.children);
    node.children.length = 0;
    node.parent = null;
  }
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value;
}

function isMesh(value: SceneNode): value is Mesh {
  return "material" in value && "_gpu" in value;
}
