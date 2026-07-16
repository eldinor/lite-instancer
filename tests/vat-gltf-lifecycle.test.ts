import { beforeEach, describe, expect, it, vi } from "vitest";

const removeFromScene = vi.fn();
const disposeMeshGpu = vi.fn();

vi.mock("@babylonjs/lite", () => ({ removeFromScene, disposeMeshGpu }));

describe("VAT GLB lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    removeFromScene.mockClear();
    disposeMeshGpu.mockClear();
  });

  it("fully clears a loaded container and releases both scene-owned and source-only meshes", async () => {
    const { disposeGltfContainer } = await import("../src/vat-gltf-lifecycle.js");
    const sceneMesh = { children: [], parent: null, material: null, _gpu: {} };
    const sourceOnlyMesh = { children: [], parent: null, material: null, _gpu: {} };
    const root = { children: [sceneMesh, sourceOnlyMesh], parent: null };
    const group = { name: "Walk" };
    const scene = { meshes: [sceneMesh], animationGroups: [group] };
    const container = { entities: [root], animationGroups: [group] };

    expect(disposeGltfContainer(scene as never, container as never)).toBe(2);
    expect(removeFromScene).toHaveBeenCalledWith(scene, sceneMesh);
    expect(disposeMeshGpu).toHaveBeenCalledWith(sourceOnlyMesh);
    expect(scene.animationGroups).toEqual([]);
    expect(container.animationGroups).toEqual([]);
    expect(container.entities).toEqual([]);
    expect(root.children).toEqual([]);
    expect(sceneMesh.parent).toBeNull();
  });

  it("disposes VAT wrappers before releasing distinct containers", async () => {
    const { disposeVatGlbAssets } = await import("../src/vat-gltf-lifecycle.js");
    const dispose = vi.fn();
    const container = { entities: [], animationGroups: [] };
    const scene = { meshes: [], animationGroups: [] };

    disposeVatGlbAssets({ scene: scene as never, containers: [container, container] as never, disposables: [{ dispose }] });

    expect(dispose).toHaveBeenCalledOnce();
  });
});
