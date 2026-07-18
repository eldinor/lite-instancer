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
  highlight(id: InstanceId, options?: OutlineHighlightOptions): void;
  tryHighlight(id: InstanceId, options?: OutlineHighlightOptions): boolean;
  clear(id: InstanceId): void;
  tryClear(id: InstanceId): boolean;
  clearAll(): void;
  refresh(id?: InstanceId): void;
  isHighlighted(id: InstanceId): boolean;
  setEffectParams(updates: EffectParamUpdates): void;
  dispose(): void;
}

export interface ThinInstanceOutlineAttachment {
  readonly source: Mesh;
  readonly outlineMesh: Mesh;
  readonly material: ShaderMaterial;
  readonly highlightedCount: number;
  highlight(index: number, options?: OutlineHighlightOptions): void;
  tryHighlight(index: number, options?: OutlineHighlightOptions): boolean;
  clear(index: number): void;
  tryClear(index: number): boolean;
  clearAll(): void;
  refresh(index?: number): void;
  isHighlighted(index: number): boolean;
  setEffectParams(updates: EffectParamUpdates): void;
  dispose(): void;
}

export interface InstanceOutliner {
  attach<TMetadata>(source: InstanceSet<TMetadata>, options?: OutlineAttachOptions): InstanceOutlineAttachment<TMetadata>;
  detach<TMetadata>(source: InstanceSet<TMetadata>): boolean;
  dispose(): void;
}

export interface ThinInstanceOutliner {
  attach(source: Mesh, options?: OutlineAttachOptions): ThinInstanceOutlineAttachment;
  detach(source: Mesh): boolean;
  dispose(): void;
}
