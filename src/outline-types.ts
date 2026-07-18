import type { Mesh, ShaderMaterial } from "@babylonjs/lite";
import type { InstanceSet } from "./instance-set.js";
import type { InstanceId } from "./types.js";

export type OutlineRgb = readonly [number, number, number];

export interface OutlineGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface PulseOptions {
  speed: number;
  amplitude: number;
}

export interface ColorCycleOptions {
  period: number;
}

export interface EdgeFlowOptions {
  axis: "x" | "y" | "z";
  speed: number;
  width: number;
  accentColor?: OutlineRgb;
  boost?: number;
}

export interface RimFlowOptions {
  speed: number;
  width: number;
  accentColor?: OutlineRgb;
  boost?: number;
}

export interface SizzleOptions {
  scale: number;
  speed: number;
  threshold?: number;
  color?: OutlineRgb;
  boost?: number;
}

export interface OutlineAttachOptions {
  geometry?: OutlineGeometry;
  thickness?: number;
  color?: OutlineRgb;
  smoothNormals?: boolean;
  smoothNormalEpsilon?: number;
  /** Offset from the host render order. Defaults to `1` so the opaque host writes depth first. */
  renderOrderOffset?: number;
  initialCapacity?: number;
  gpuCulling?: boolean;
  gpuCullBoundsPad?: number;
  pulse?: PulseOptions;
  colorCycle?: ColorCycleOptions;
  edgeFlow?: EdgeFlowOptions;
  rimFlow?: RimFlowOptions;
  sizzle?: SizzleOptions;
}

export interface OutlineHighlightOptions {
  color?: OutlineRgb;
  phase?: number;
}

export interface EffectParamUpdates {
  thickness?: number;
  pulse?: Partial<PulseOptions>;
  colorCycle?: Partial<ColorCycleOptions>;
  edgeFlow?: Partial<Omit<EdgeFlowOptions, "axis">>;
  rimFlow?: Partial<RimFlowOptions>;
  sizzle?: Partial<SizzleOptions>;
}

export interface InstanceOutlineAttachment<TMetadata = unknown> {
  readonly source: InstanceSet<TMetadata>;
  readonly outlineMesh: Mesh;
  readonly material: ShaderMaterial;
  readonly highlightedCount: number;
  /** Add or update the outline for a stable instance ID. */
  highlight(id: InstanceId, options?: OutlineHighlightOptions): void;
  /** Add or update an outline, returning false when the ID is unknown or options are invalid. */
  tryHighlight(id: InstanceId, options?: OutlineHighlightOptions): boolean;
  /** Remove the outline for an ID. */
  clear(id: InstanceId): void;
  /** Remove an outline, returning false when the ID is not highlighted. */
  tryClear(id: InstanceId): boolean;
  /** Remove every outline managed by this attachment. */
  clearAll(): void;
  /** Resynchronize one highlighted ID, or every highlighted ID when omitted. */
  refresh(id?: InstanceId): void;
  /** Return whether an ID is currently highlighted. */
  isHighlighted(id: InstanceId): boolean;
  /** Update values for effects enabled when the attachment was created. */
  setEffectParams(updates: EffectParamUpdates): void;
  /** Release the outline mesh, material, and attachment bookkeeping. */
  dispose(): void;
}

export interface ThinInstanceOutlineAttachment {
  readonly source: Mesh;
  readonly outlineMesh: Mesh;
  readonly material: ShaderMaterial;
  readonly highlightedCount: number;
  /** Add or update the outline for a raw thin-instance index. Use `0` for an ordinary mesh. */
  highlight(index: number, options?: OutlineHighlightOptions): void;
  /** Add or update an outline, returning false when the index or options are invalid. */
  tryHighlight(index: number, options?: OutlineHighlightOptions): boolean;
  /** Remove the outline for a raw thin-instance index. */
  clear(index: number): void;
  /** Remove an outline, returning false when the index is not highlighted. */
  tryClear(index: number): boolean;
  /** Remove every outline managed by this attachment. */
  clearAll(): void;
  /** Resynchronize one highlighted index, or every highlighted index when omitted. */
  refresh(index?: number): void;
  /** Return whether an index is currently highlighted. */
  isHighlighted(index: number): boolean;
  /** Update values for effects enabled when the attachment was created. */
  setEffectParams(updates: EffectParamUpdates): void;
  /** Release the outline mesh, material, and attachment bookkeeping. */
  dispose(): void;
}

export interface InstanceOutliner {
  /** Attach a compact outline pool to a stable-ID instance set. */
  attach<TMetadata>(source: InstanceSet<TMetadata>, options?: OutlineAttachOptions): InstanceOutlineAttachment<TMetadata>;
  /** Detach and dispose a set's outline attachment. */
  detach<TMetadata>(source: InstanceSet<TMetadata>): boolean;
  /** Dispose every attachment managed by this outliner. */
  dispose(): void;
}

export interface ThinInstanceOutliner {
  /** Attach a compact outline pool directly to a mesh. */
  attach(source: Mesh, options?: OutlineAttachOptions): ThinInstanceOutlineAttachment;
  /** Detach and dispose a mesh's outline attachment. */
  detach(source: Mesh): boolean;
  /** Dispose every attachment managed by this outliner. */
  dispose(): void;
}
