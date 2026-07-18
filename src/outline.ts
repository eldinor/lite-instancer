import {
  addToScene,
  createStorageBuffer,
  createMeshFromData,
  disposeStorageBuffer,
  enableThinInstanceGpuCulling,
  onBeforeRender,
  removeFromScene,
  setParent,
  setShaderStorageBuffer,
  setShaderUniform,
  setThinInstanceCullBoundsPad,
  updateStorageBuffer,
  type EngineContext,
  type Mat4,
  type Mesh,
  type SceneContext,
  type ShaderMaterial,
  type StorageBuffer
} from "@babylonjs/lite";
import { InstancerError } from "./errors.js";
import { createInstanceSet, type ColoredInstanceSet, type InstanceSet } from "./instance-set.js";
import { createIdentityMat4 } from "./transforms.js";
import type { InstanceId } from "./types.js";
import { prepareOutlineGeometry, tryGetRetainedOutlineGeometry } from "./outline-geometry.js";
import { createOutlineMaterial, resolveOutlineEffects, type OutlineEffects } from "./outline-shader.js";
import type {
  EffectParamUpdates,
  InstanceOutlineAttachment,
  InstanceOutliner,
  OutlineAttachOptions,
  OutlineHighlightOptions,
  OutlineRgb,
  ThinInstanceOutlineAttachment,
  ThinInstanceOutliner
} from "./outline-types.js";

export * from "./outline-types.js";
export {
  computeOutlineAxisExtent,
  computeOutlineCenter,
  prepareOutlineGeometry,
  reverseTriangleWinding,
  smoothOutlineNormals,
  tryGetRetainedOutlineGeometry,
  validateOutlineGeometry
} from "./outline-geometry.js";
export type { PreparedOutlineGeometry } from "./outline-geometry.js";

const DEFAULT_COLOR: OutlineRgb = [0.5, 0.7, 1];

interface HighlightRecord {
  outlineId: InstanceId;
  color: OutlineRgb;
  phase: number;
}

abstract class CompactOutlineAttachment<TKey> {
  readonly outlineMesh: Mesh;
  readonly material: ShaderMaterial;
  protected readonly records = new Map<TKey, HighlightRecord>();
  protected disposed = false;

  readonly #outlineInstances: ColoredInstanceSet<never>;
  readonly #effects: OutlineEffects;
  readonly #defaultColor: OutlineRgb;
  readonly #detach: () => void;
  readonly #boneMatrices: Float32Array | null;
  readonly #boneStorage: StorageBuffer | null;

  constructor(
    protected readonly engine: EngineContext,
    protected readonly scene: SceneContext,
    protected readonly host: Mesh,
    options: OutlineAttachOptions,
    detach: () => void
  ) {
    validateAttachOptions(options);
    const sourceGeometry = options.geometry ?? tryGetRetainedOutlineGeometry(host);
    if (!sourceGeometry) {
      throw new InstancerError(`Outline geometry is required for host "${host.name}"`);
    }
    const geometry = prepareOutlineGeometry(
      sourceGeometry,
      options.smoothNormals ?? true,
      options.smoothNormalEpsilon ?? 1e-5
    );
    const skeleton = host.skeleton ?? null;
    this.material = createOutlineMaterial(options, geometry, skeleton ? {
      hasEightInfluences: skeleton.joints1Buffer !== null && skeleton.weights1Buffer !== null
    } : undefined);
    this.outlineMesh = createMeshFromData(
      engine,
      `${host.name}-outline`,
      geometry.positions,
      geometry.normals,
      geometry.indices
    );
    this.outlineMesh.material = this.material;
    this.outlineMesh.pickable = false;
    this.outlineMesh.receiveShadows = false;
    if (skeleton) {
      const sharedSkeleton = skeleton as typeof skeleton & { _refCount?: number };
      sharedSkeleton._refCount = (sharedSkeleton._refCount ?? 1) + 1;
      this.outlineMesh.skeleton = skeleton;
      this.#boneMatrices = skeleton.boneMatrices;
      this.#boneStorage = createStorageBuffer(engine, skeleton.boneMatrices, `${host.name}-outline-bones`);
      setShaderStorageBuffer(this.material, "outlineBones", this.#boneStorage);
    } else {
      this.#boneMatrices = null;
      this.#boneStorage = null;
    }
    // Draw the opaque host first so its depth rejects the expanded hull everywhere
    // except the silhouette. Rendering the hull first can expose its full fill on
    // imported material pipelines whose opaque packets are assembled separately.
    this.outlineMesh.renderOrder = (host.renderOrder ?? 100) + (options.renderOrderOffset ?? 1);
    this.#outlineInstances = createInstanceSet<never>(this.outlineMesh, {
      capacity: options.initialCapacity ?? 16,
      grow: "double",
      engine,
      colors: true,
      visibleStrategy: "scale-zero"
    });
    if (options.gpuCulling) {
      enableThinInstanceGpuCulling(this.outlineMesh, true);
      setThinInstanceCullBoundsPad(this.outlineMesh, options.gpuCullBoundsPad ?? options.thickness ?? 0.03);
    }
    addToScene(scene, this.outlineMesh);
    setParent(this.outlineMesh, host);
    resetLocalTransform(this.outlineMesh);
    this.#effects = resolveOutlineEffects(options);
    this.#defaultColor = cloneColor(options.color ?? DEFAULT_COLOR);
    this.#detach = detach;
  }

  get highlightedCount(): number {
    return this.records.size;
  }

  protected highlightKey(key: TKey, options?: OutlineHighlightOptions): void {
    this.assertUsable();
    this.assertValidSourceKey(key);
    validateHighlightOptions(options);
    const color = cloneColor(options?.color ?? this.records.get(key)?.color ?? this.#defaultColor);
    const phase = options?.phase ?? this.records.get(key)?.phase ?? 0;
    const matrix = this.readSourceMatrix(key);
    const visible = this.isSourceVisible(key);
    const existing = this.records.get(key);
    if (existing) {
      existing.color = color;
      existing.phase = phase;
      this.#outlineInstances.setMatrix(existing.outlineId, matrix);
      this.#outlineInstances.setColor(existing.outlineId, [color[0], color[1], color[2], phase]);
      this.#outlineInstances.setVisible(existing.outlineId, visible);
      return;
    }
    const outlineId = this.#outlineInstances.create(matrix);
    this.#outlineInstances.setColor(outlineId, [color[0], color[1], color[2], phase]);
    if (!visible) this.#outlineInstances.setVisible(outlineId, false);
    this.records.set(key, { outlineId, color, phase });
  }

  protected tryHighlightKey(key: TKey, options?: OutlineHighlightOptions): boolean {
    if (this.disposed || !this.isValidSourceKey(key)) return false;
    try {
      this.highlightKey(key, options);
      return true;
    } catch (error) {
      if (error instanceof InstancerError) return false;
      throw error;
    }
  }

  protected clearKey(key: TKey): void {
    this.assertUsable();
    this.assertValidSourceKey(key);
    this.removeRecord(key);
  }

  protected tryClearKey(key: TKey): boolean {
    if (this.disposed || !this.isValidSourceKey(key)) return false;
    this.removeRecord(key);
    return true;
  }

  clearAll(): void {
    this.assertUsable();
    this.#outlineInstances.clear();
    this.records.clear();
  }

  protected refreshKey(key?: TKey): void {
    this.assertUsable();
    if (key !== undefined) {
      this.assertValidSourceKey(key);
      const record = this.records.get(key);
      if (record) this.refreshRecord(key, record);
      return;
    }
    for (const [current, record] of Array.from(this.records)) {
      if (!this.isValidSourceKey(current)) this.removeRecord(current);
      else this.refreshRecord(current, record);
    }
  }

  protected isHighlightedKey(key: TKey): boolean {
    this.assertUsable();
    this.assertValidSourceKey(key);
    return this.records.has(key);
  }

  setEffectParams(updates: EffectParamUpdates): void {
    this.assertUsable();
    validateEffectUpdates(updates, this.#effects);
    if (updates.thickness !== undefined) setShaderUniform(this.material, "thickness", updates.thickness);
    if (updates.pulse) {
      if (updates.pulse.speed !== undefined) setShaderUniform(this.material, "pulseSpeed", updates.pulse.speed);
      if (updates.pulse.amplitude !== undefined) setShaderUniform(this.material, "pulseAmplitude", updates.pulse.amplitude);
    }
    if (updates.colorCycle?.period !== undefined) setShaderUniform(this.material, "cyclePeriod", updates.colorCycle.period);
    if (updates.edgeFlow) {
      if (updates.edgeFlow.speed !== undefined) setShaderUniform(this.material, "flowSpeed", updates.edgeFlow.speed);
      if (updates.edgeFlow.width !== undefined) setShaderUniform(this.material, "flowWidth", updates.edgeFlow.width);
      if (updates.edgeFlow.accentColor) setShaderUniform(this.material, "flowAccentColor", updates.edgeFlow.accentColor);
      if (updates.edgeFlow.boost !== undefined) setShaderUniform(this.material, "flowBoost", updates.edgeFlow.boost);
    }
    if (updates.rimFlow) {
      if (updates.rimFlow.speed !== undefined) setShaderUniform(this.material, "rimSpeed", updates.rimFlow.speed);
      if (updates.rimFlow.width !== undefined) setShaderUniform(this.material, "rimWidth", updates.rimFlow.width);
      if (updates.rimFlow.accentColor) setShaderUniform(this.material, "rimAccentColor", updates.rimFlow.accentColor);
      if (updates.rimFlow.boost !== undefined) setShaderUniform(this.material, "rimBoost", updates.rimFlow.boost);
    }
    if (updates.sizzle) {
      if (updates.sizzle.scale !== undefined) setShaderUniform(this.material, "sizzleScale", updates.sizzle.scale);
      if (updates.sizzle.speed !== undefined) setShaderUniform(this.material, "sizzleSpeed", updates.sizzle.speed);
      if (updates.sizzle.threshold !== undefined) setShaderUniform(this.material, "sizzleThreshold", updates.sizzle.threshold);
      if (updates.sizzle.color) setShaderUniform(this.material, "sizzleColor", updates.sizzle.color);
      if (updates.sizzle.boost !== undefined) setShaderUniform(this.material, "sizzleBoost", updates.sizzle.boost);
    }
  }

  updateTime(seconds: number): void {
    if (!this.disposed && this.#boneStorage && this.#boneMatrices) {
      updateStorageBuffer(this.engine, this.#boneStorage, this.#boneMatrices);
    }
    if (!this.disposed && Object.values(this.#effects).some(Boolean)) {
      setShaderUniform(this.material, "time", seconds);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.#detach();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.records.clear();
    setParent(this.outlineMesh, null);
    removeFromScene(this.scene, this.outlineMesh);
    this.#outlineInstances.dispose();
    if (this.#boneStorage) disposeStorageBuffer(this.#boneStorage);
  }

  protected assertUsable(): void {
    if (this.disposed) throw new InstancerError("Outline attachment has been disposed");
  }

  protected abstract isValidSourceKey(key: TKey): boolean;
  protected abstract assertValidSourceKey(key: TKey): void;
  protected abstract readSourceMatrix(key: TKey): Mat4;
  protected abstract isSourceVisible(key: TKey): boolean;

  private refreshRecord(key: TKey, record: HighlightRecord): void {
    this.#outlineInstances.setMatrix(record.outlineId, this.readSourceMatrix(key));
    this.#outlineInstances.setVisible(record.outlineId, this.isSourceVisible(key));
  }

  private removeRecord(key: TKey): void {
    const record = this.records.get(key);
    if (!record) return;
    this.#outlineInstances.remove(record.outlineId);
    this.records.delete(key);
  }
}

class StableAttachment extends CompactOutlineAttachment<InstanceId> implements InstanceOutlineAttachment {
  readonly source: InstanceSet<unknown>;

  constructor(
    engine: EngineContext,
    scene: SceneContext,
    source: InstanceSet<unknown>,
    options: OutlineAttachOptions,
    detach: () => void
  ) {
    super(engine, scene, source.mesh, options, detach);
    this.source = source;
  }

  highlight(id: InstanceId, options?: OutlineHighlightOptions): void { this.highlightKey(id, options); }
  tryHighlight(id: InstanceId, options?: OutlineHighlightOptions): boolean { return this.tryHighlightKey(id, options); }
  clear(id: InstanceId): void { this.clearKey(id); }
  tryClear(id: InstanceId): boolean { return this.tryClearKey(id); }
  refresh(id?: InstanceId): void { this.refreshKey(id); }
  isHighlighted(id: InstanceId): boolean { return this.isHighlightedKey(id); }

  protected isValidSourceKey(id: InstanceId): boolean { return this.source.has(id); }
  protected assertValidSourceKey(id: InstanceId): void {
    if (!this.source.has(id)) throw new InstancerError(`Unknown instance id ${Number(id)}`);
  }
  protected readSourceMatrix(id: InstanceId): Mat4 { return this.source.getMatrix(id); }
  protected isSourceVisible(id: InstanceId): boolean { return this.source.getVisible(id); }
}

class RawAttachment extends CompactOutlineAttachment<number> implements ThinInstanceOutlineAttachment {
  readonly source: Mesh;
  readonly #identity = createIdentityMat4();

  constructor(
    engine: EngineContext,
    scene: SceneContext,
    source: Mesh,
    options: OutlineAttachOptions,
    detach: () => void
  ) {
    super(engine, scene, source, options, detach);
    this.source = source;
  }

  highlight(index: number, options?: OutlineHighlightOptions): void { this.highlightKey(index, options); }
  tryHighlight(index: number, options?: OutlineHighlightOptions): boolean { return this.tryHighlightKey(index, options); }
  clear(index: number): void { this.clearKey(index); }
  tryClear(index: number): boolean { return this.tryClearKey(index); }
  refresh(index?: number): void { this.refreshKey(index); }
  isHighlighted(index: number): boolean { return this.isHighlightedKey(index); }

  protected isValidSourceKey(index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    return this.source.thinInstances ? index < this.source.thinInstances.count : index === 0;
  }
  protected assertValidSourceKey(index: number): void {
    if (!this.isValidSourceKey(index)) {
      const count = this.source.thinInstances?.count ?? 1;
      throw new InstancerError(`Thin-instance index ${index} is outside the active range 0..${count - 1}`);
    }
  }
  protected readSourceMatrix(index: number): Mat4 {
    const matrices = this.source.thinInstances?.matrices;
    return matrices ? matrices.subarray(index * 16, index * 16 + 16) as Mat4 : this.#identity;
  }
  protected isSourceVisible(): boolean { return true; }
}

export function createInstanceOutliner(engine: EngineContext, scene: SceneContext): InstanceOutliner {
  let disposed = false;
  let elapsed = 0;
  const attachments = new Map<InstanceSet<unknown>, StableAttachment>();
  onBeforeRender(scene, (deltaMs) => {
    if (disposed) return;
    elapsed += deltaMs / 1000;
    for (const attachment of attachments.values()) attachment.updateTime(elapsed);
  });
  const manager: InstanceOutliner = {
    attach<TMetadata>(source: InstanceSet<TMetadata>, options: OutlineAttachOptions = {}): InstanceOutlineAttachment<TMetadata> {
      if (disposed) throw new InstancerError("Instance outliner has been disposed");
      const key = source as unknown as InstanceSet<unknown>;
      if (attachments.has(key)) throw new InstancerError("InstanceSet already has an outline attachment");
      const attachment = new StableAttachment(engine, scene, key, options, () => manager.detach(key));
      attachments.set(key, attachment);
      return attachment as unknown as InstanceOutlineAttachment<TMetadata>;
    },
    detach<TMetadata>(source: InstanceSet<TMetadata>): boolean {
      const key = source as unknown as InstanceSet<unknown>;
      const attachment = attachments.get(key);
      if (!attachment) return false;
      attachments.delete(key);
      attachment.destroy();
      return true;
    },
    dispose(): void {
      if (disposed) return;
      for (const attachment of Array.from(attachments.values())) attachment.destroy();
      attachments.clear();
      disposed = true;
    }
  };
  return manager;
}

export function createThinInstanceOutliner(engine: EngineContext, scene: SceneContext): ThinInstanceOutliner {
  let disposed = false;
  let elapsed = 0;
  const attachments = new Map<Mesh, RawAttachment>();
  onBeforeRender(scene, (deltaMs) => {
    if (disposed) return;
    elapsed += deltaMs / 1000;
    for (const attachment of attachments.values()) attachment.updateTime(elapsed);
  });
  const manager: ThinInstanceOutliner = {
    attach(source: Mesh, options: OutlineAttachOptions = {}): ThinInstanceOutlineAttachment {
      if (disposed) throw new InstancerError("Thin-instance outliner has been disposed");
      if (attachments.has(source)) throw new InstancerError("Mesh already has an outline attachment");
      const attachment = new RawAttachment(engine, scene, source, options, () => manager.detach(source));
      attachments.set(source, attachment);
      return attachment;
    },
    detach(source: Mesh): boolean {
      const attachment = attachments.get(source);
      if (!attachment) return false;
      attachments.delete(source);
      attachment.destroy();
      return true;
    },
    dispose(): void {
      if (disposed) return;
      for (const attachment of Array.from(attachments.values())) attachment.destroy();
      attachments.clear();
      disposed = true;
    }
  };
  return manager;
}

function resetLocalTransform(mesh: Mesh): void {
  mesh.position.set(0, 0, 0);
  mesh.rotationQuaternion.set(0, 0, 0, 1);
  mesh.scaling.set(1, 1, 1);
}

function cloneColor(color: OutlineRgb): OutlineRgb {
  return [color[0], color[1], color[2]];
}

function validateAttachOptions(options: OutlineAttachOptions): void {
  positive(options.thickness ?? 0.03, "thickness");
  const capacity = options.initialCapacity ?? 16;
  if (!Number.isInteger(capacity) || capacity < 1) throw new InstancerError("initialCapacity must be a positive integer");
  if (options.gpuCullBoundsPad !== undefined) nonNegative(options.gpuCullBoundsPad, "gpuCullBoundsPad");
  if (options.color) validColor(options.color, "color");
  if (options.pulse) {
    finite(options.pulse.speed, "pulse.speed");
    range(options.pulse.amplitude, 0, 1, "pulse.amplitude");
  }
  if (options.colorCycle) positive(options.colorCycle.period, "colorCycle.period");
  if (options.edgeFlow) {
    finite(options.edgeFlow.speed, "edgeFlow.speed");
    range(options.edgeFlow.width, 0, 1, "edgeFlow.width");
    if (options.edgeFlow.accentColor) validColor(options.edgeFlow.accentColor, "edgeFlow.accentColor");
    if (options.edgeFlow.boost !== undefined) nonNegative(options.edgeFlow.boost, "edgeFlow.boost");
  }
  if (options.rimFlow) {
    finite(options.rimFlow.speed, "rimFlow.speed");
    range(options.rimFlow.width, 0, 1, "rimFlow.width");
    if (options.rimFlow.accentColor) validColor(options.rimFlow.accentColor, "rimFlow.accentColor");
    if (options.rimFlow.boost !== undefined) nonNegative(options.rimFlow.boost, "rimFlow.boost");
  }
  if (options.sizzle) {
    positive(options.sizzle.scale, "sizzle.scale");
    finite(options.sizzle.speed, "sizzle.speed");
    range(options.sizzle.threshold ?? 0.6, 0, 1, "sizzle.threshold");
    if (options.sizzle.color) validColor(options.sizzle.color, "sizzle.color");
    if (options.sizzle.boost !== undefined) nonNegative(options.sizzle.boost, "sizzle.boost");
  }
}

function validateHighlightOptions(options?: OutlineHighlightOptions): void {
  if (options?.color) validColor(options.color, "highlight.color");
  if (options?.phase !== undefined) range(options.phase, 0, 1, "highlight.phase");
}

function validateEffectUpdates(updates: EffectParamUpdates, effects: OutlineEffects): void {
  if (updates.thickness !== undefined) positive(updates.thickness, "thickness");
  for (const key of ["pulse", "colorCycle", "edgeFlow", "rimFlow", "sizzle"] as const) {
    if (updates[key] && !effects[key]) throw new InstancerError(`${key} was not enabled when the outline was attached`);
  }
  if (updates.pulse?.speed !== undefined) finite(updates.pulse.speed, "pulse.speed");
  if (updates.pulse?.amplitude !== undefined) range(updates.pulse.amplitude, 0, 1, "pulse.amplitude");
  if (updates.colorCycle?.period !== undefined) positive(updates.colorCycle.period, "colorCycle.period");
  for (const [name, effect] of [["edgeFlow", updates.edgeFlow], ["rimFlow", updates.rimFlow]] as const) {
    if (effect?.speed !== undefined) finite(effect.speed, `${name}.speed`);
    if (effect?.width !== undefined) range(effect.width, 0, 1, `${name}.width`);
    if (effect?.accentColor) validColor(effect.accentColor, `${name}.accentColor`);
    if (effect?.boost !== undefined) nonNegative(effect.boost, `${name}.boost`);
  }
  if (updates.sizzle?.scale !== undefined) positive(updates.sizzle.scale, "sizzle.scale");
  if (updates.sizzle?.speed !== undefined) finite(updates.sizzle.speed, "sizzle.speed");
  if (updates.sizzle?.threshold !== undefined) range(updates.sizzle.threshold, 0, 1, "sizzle.threshold");
  if (updates.sizzle?.color) validColor(updates.sizzle.color, "sizzle.color");
  if (updates.sizzle?.boost !== undefined) nonNegative(updates.sizzle.boost, "sizzle.boost");
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new InstancerError(`${name} must be finite`);
}
function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new InstancerError(`${name} must be a positive finite number`);
}
function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new InstancerError(`${name} must be a non-negative finite number`);
}
function range(value: number, min: number, max: number, name: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new InstancerError(`${name} must be between ${min} and ${max}`);
}
function validColor(color: OutlineRgb, name: string): void {
  if (color.length !== 3 || color.some((value) => !Number.isFinite(value))) throw new InstancerError(`${name} must contain three finite values`);
}
