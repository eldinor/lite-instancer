import { beforeEach, describe, expect, it, vi } from "vitest";

const beforeRenderCallbacks: Array<(deltaMs: number) => void> = [];

vi.mock("@babylonjs/lite", () => ({
  createShaderMaterial: vi.fn((options) => ({ ...options, _uniforms: new Map() })),
  setShaderUniform: vi.fn((material, name, value) => material._uniforms.set(name, value)),
  createMeshFromData: vi.fn((_engine, name) => createNode(name)),
  addToScene: vi.fn((scene, mesh) => scene.meshes.push(mesh)),
  removeFromScene: vi.fn((scene, mesh) => {
    const index = scene.meshes.indexOf(mesh);
    if (index >= 0) scene.meshes.splice(index, 1);
    mesh.removed = true;
  }),
  setParent: vi.fn((child, parent) => {
    if (child.parent) {
      const index = child.parent.children.indexOf(child);
      if (index >= 0) child.parent.children.splice(index, 1);
    }
    child.parent = parent;
    if (parent && !parent.children.includes(child)) parent.children.push(child);
  }),
  onBeforeRender: vi.fn((_scene, callback) => beforeRenderCallbacks.push(callback)),
  setThinInstances: vi.fn((mesh, matrices, count) => {
    mesh.thinInstances = { matrices, count };
  }),
  setThinInstanceCount: vi.fn((mesh, count) => { mesh.thinInstances.count = count; }),
  setThinInstanceMatrix: vi.fn((mesh, index, matrix) => mesh.thinInstances.matrices.set(matrix, index * 16)),
  setThinInstanceColors: vi.fn((mesh, colors) => { mesh.thinInstances.colors = colors; }),
  setThinInstanceColor: vi.fn((mesh, index, r, g, b, a) => {
    mesh.thinInstances.colors.set([r, g, b, a], index * 4);
  }),
  flushThinInstances: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn(),
  setThinInstanceCullBoundsPad: vi.fn()
}));

function observable(initial: number) {
  return { value: initial, set(x: number, y: number, z: number, w?: number) { this.value = x; void y; void z; void w; } };
}

function createNode(name = "mesh") {
  return {
    name,
    children: [],
    parent: null,
    position: observable(0),
    rotationQuaternion: observable(0),
    scaling: observable(1),
    worldMatrix: new Float32Array(16),
    material: {},
    receiveShadows: false
  };
}

const geometry = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2])
};

describe("outline managers", () => {
  beforeEach(() => beforeRenderCallbacks.length = 0);

  it("tracks stable IDs through slot moves, growth, visibility, and removal", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const { createInstanceOutliner } = await import("../src/outline.js");
    const engine = {} as never;
    const scene = { meshes: [] } as never;
    const host = createNode("host") as never;
    const source = createInstanceSet(host, { capacity: 1, grow: "double", engine });
    const a = source.create({ position: [1, 0, 0] });
    const b = source.create({ position: [2, 0, 0] });
    const manager = createInstanceOutliner(engine, scene);
    const attachment = manager.attach(source, { geometry });

    attachment.highlight(b, { color: [1, 0, 0], phase: 0.25 });
    expect(attachment.highlightedCount).toBe(1);
    expect(attachment.outlineMesh.thinInstances?.count).toBe(1);

    source.remove(a);
    source.setPosition(b, [5, 0, 0]);
    attachment.refresh(b);
    expect(attachment.outlineMesh.thinInstances?.matrices[12]).toBe(5);

    source.setVisible(b, false);
    attachment.refresh(b);
    expect(attachment.outlineMesh.thinInstances?.matrices[0]).toBe(0);
    source.setVisible(b, true);
    attachment.refresh(b);
    expect(attachment.outlineMesh.thinInstances?.matrices[0]).toBe(1);

    source.remove(b);
    attachment.refresh();
    expect(attachment.highlightedCount).toBe(0);
  });

  it("supports strict and try operations plus compact clear", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const { createInstanceOutliner } = await import("../src/outline.js");
    const { toInstanceId } = await import("../src/types.js");
    const source = createInstanceSet(createNode() as never, { capacity: 2 });
    const id = source.create();
    const missing = toInstanceId(999);
    const manager = createInstanceOutliner({} as never, { meshes: [] } as never);
    const attachment = manager.attach(source, { geometry });

    expect(attachment.tryHighlight(missing)).toBe(false);
    expect(attachment.tryHighlight(id, { phase: 2 })).toBe(false);
    expect(() => attachment.highlight(missing)).toThrow(/Unknown instance/);
    attachment.highlight(id);
    expect(attachment.isHighlighted(id)).toBe(true);
    attachment.clear(id);
    expect(attachment.highlightedCount).toBe(0);
    expect(attachment.tryClear(id)).toBe(true);
  });

  it("rejects duplicate attachments", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const { createInstanceOutliner } = await import("../src/outline.js");
    const source = createInstanceSet(createNode() as never, { capacity: 1 });
    const manager = createInstanceOutliner({} as never, { meshes: [] } as never);
    manager.attach(source, { geometry });
    expect(() => manager.attach(source, { geometry })).toThrow(/already/);
  });

  it("cleans parent bookkeeping and enforces lifecycle", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const { createInstanceOutliner } = await import("../src/outline.js");
    const host = createNode("host");
    const source = createInstanceSet(host as never, { capacity: 1 });
    const id = source.create();
    const scene = { meshes: [] } as never;
    const manager = createInstanceOutliner({} as never, scene);
    const attachment = manager.attach(source, { geometry });
    expect(host.children).toContain(attachment.outlineMesh);

    attachment.dispose();
    expect(host.children).not.toContain(attachment.outlineMesh);
    expect(() => attachment.highlight(id)).toThrow(/disposed/);
    manager.dispose();
  });

  it("supports standalone single meshes and effect validation", async () => {
    const { createThinInstanceOutliner } = await import("../src/outline.js");
    const host = createNode("single") as never;
    (host as { renderOrder?: number }).renderOrder = 37;
    const manager = createThinInstanceOutliner({} as never, { meshes: [] } as never);
    const attachment = manager.attach(host, { geometry, pulse: { speed: 2, amplitude: 0.5 } });

    expect(attachment.outlineMesh.renderOrder).toBe(38);
    expect(attachment.tryHighlight(1)).toBe(false);
    attachment.highlight(0);
    expect(attachment.highlightedCount).toBe(1);
    attachment.setEffectParams({ pulse: { amplitude: 0.8 }, thickness: 0.05 });
    expect(() => attachment.setEffectParams({ sizzle: { speed: 2 } })).toThrow(/not enabled/);
    beforeRenderCallbacks[0]?.(16);
    expect((attachment.material as never as { _uniforms: Map<string, number> })._uniforms.get("time")).toBeCloseTo(0.016);
  });
});
