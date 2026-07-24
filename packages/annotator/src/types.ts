import type { Camera, Mat4, Mesh, SceneContext } from "@babylonjs/lite";

export type AnnotationId = number & { readonly __annotationIdBrand: unique symbol };
export type AnnotationType = "label" | "marker";
export type MarkerShape = "dot" | "ring";
export type AnchorPreset = "center" | "top" | "bottom" | "left" | "right" | "front" | "back";
export type Vec2Like = readonly [number, number] | Float32Array | Float64Array;
export type Vec3Like = readonly [number, number, number] | Float32Array | Float64Array;

export interface WorldAnchor {
  readonly kind: "world";
  readonly position: Vec3Like;
}

export type MeshAnchor =
  | {
      readonly kind: "mesh";
      readonly mesh: Mesh;
      readonly point: Vec3Like;
      readonly space?: "local" | "world";
    }
  | {
      readonly kind: "mesh";
      readonly mesh: Mesh;
      readonly preset?: AnchorPreset;
    };

export interface AnchorResolution {
  readonly available: boolean;
  readonly targetVisible: boolean;
  readonly position?: Vec3Like;
}

/**
 * Adapter anchor contract. Application code normally obtains one from
 * `@litools/annotator/instancer`.
 */
export interface ResolvableAnchor {
  readonly kind: "resolver";
  resolve(out: Float32Array): AnchorResolution;
}

export type AnnotationAnchor = WorldAnchor | MeshAnchor;
export type SupportedAnnotationAnchor = AnnotationAnchor | ResolvableAnchor;

export interface AnnotationStyle {
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  fontSize?: number;
  fontWeight?: string | number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  padding?: number;
  className?: string;
}

export interface AnnotationVisibilityOptions {
  visible?: boolean;
  minDistance?: number;
  maxDistance?: number;
  hideWhenOffscreen?: boolean;
  clampToViewport?: boolean;
}

export interface LabelOptions extends AnnotationVisibilityOptions {
  anchor: SupportedAnnotationAnchor;
  text: string | (() => string);
  zIndex?: number;
  worldOffset?: Vec3Like;
  screenOffset?: Vec2Like;
  style?: AnnotationStyle;
  ariaLabel?: string;
  role?: string;
}

export interface MarkerOptions extends AnnotationVisibilityOptions {
  anchor: SupportedAnnotationAnchor;
  shape?: MarkerShape;
  size?: number;
  zIndex?: number;
  worldOffset?: Vec3Like;
  screenOffset?: Vec2Like;
  style?: AnnotationStyle;
}

export type LabelPatch = Partial<Omit<LabelOptions, "anchor">> & { anchor?: SupportedAnnotationAnchor };
export type MarkerPatch = Partial<Omit<MarkerOptions, "anchor">> & { anchor?: SupportedAnnotationAnchor };

export type AnnotationHiddenReason =
  | "none"
  | "anchor-unavailable"
  | "target-hidden"
  | "behind-camera"
  | "offscreen"
  | "distance";

export interface AnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export interface AnnotationSnapshot {
  readonly id: AnnotationId;
  readonly type: AnnotationType;
  readonly requestedVisible: boolean;
  readonly rendered: boolean;
  readonly hiddenReason: AnnotationHiddenReason;
  readonly worldPosition: readonly [number, number, number] | null;
  readonly screenPosition: Readonly<AnnotationPoint> | null;
  readonly unclampedScreenPosition: Readonly<AnnotationPoint> | null;
  readonly depth: number | null;
  readonly bounds: Readonly<DOMRectReadOnly> | null;
}

export interface AnnotationLayer {
  readonly __annotationLayerBrand: never;
}

export interface AnnotationHandle {
  readonly id: AnnotationId;
  readonly type: AnnotationType;
  readonly __annotationBrand: never;
}

export interface LabelHandle extends AnnotationHandle {
  readonly type: "label";
}

export interface MarkerHandle extends AnnotationHandle {
  readonly type: "marker";
}

export interface AnnotationViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BackendAnnotationDefinition {
  readonly id: AnnotationId;
  readonly type: AnnotationType;
  readonly text?: string;
  readonly shape?: MarkerShape;
  readonly size?: number;
  readonly zIndex: number;
  readonly style: Readonly<AnnotationStyle>;
  readonly ariaLabel?: string;
  readonly role?: string;
}

export interface BackendAnnotationUpdate extends BackendAnnotationDefinition {
  /** Whether content, style, semantics, shape, size, or z-order changed. */
  readonly definitionChanged: boolean;
  readonly rendered: boolean;
  readonly screenPosition: Readonly<AnnotationPoint> | null;
}

export interface BackendBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationBackend {
  create(definition: BackendAnnotationDefinition): unknown;
  update(resource: unknown, update: BackendAnnotationUpdate): void;
  measure(resource: unknown): BackendBounds | null;
  setViewport(viewport: AnnotationViewport): void;
  disposeResource(resource: unknown): void;
  dispose(): void;
}

export interface AnnotationLayerOptions {
  scene: SceneContext;
  camera: Camera;
  canvas: HTMLCanvasElement;
  backend: AnnotationBackend;
  updateMode?: "manual" | "raf";
  viewportPadding?: number;
}

export interface ProjectionInput {
  readonly position: Vec3Like;
  readonly viewProjection: Mat4;
  readonly viewport: AnnotationViewport;
  readonly cameraPosition: Vec3Like;
}

export interface ProjectionResult {
  readonly behindCamera: boolean;
  readonly offscreen: boolean;
  readonly screenPosition: AnnotationPoint;
  readonly depth: number;
  readonly distance: number;
}
