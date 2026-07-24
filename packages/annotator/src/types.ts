import type { Camera, Mat4, Mesh, SceneContext } from "@babylonjs/lite";

export type AnnotationId = number & { readonly __annotationIdBrand: unique symbol };
export type AnnotationType = "label" | "marker";
export type MarkerShape = "dot" | "ring";
export type LabelCollisionMode =
  | "none"
  | "hide"
  | "shift"
  | "shift-x"
  | "shift-y"
  | "radial"
  | "cluster"
  | "repel";
export type AnnotationOcclusionMode = "none" | "hide" | "fade";
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
  /** HTML opacity transition duration in milliseconds. @default 0 */
  opacityTransitionDuration?: number;
}

export interface LeaderLineOptions {
  color?: string;
  width?: number;
  opacity?: number;
  /** Minimum collision-layout displacement before the line is shown. @default 8 */
  minLength?: number;
}

export interface AnnotationVisibilityOptions {
  visible?: boolean;
  minDistance?: number;
  maxDistance?: number;
  hideWhenOffscreen?: boolean;
  clampToViewport?: boolean;
  /** Provider-driven occlusion presentation. @default "none" */
  occlusion?: AnnotationOcclusionMode;
  /** @deprecated Use `occlusion: "hide"` or `"fade"`. */
  hideWhenOccluded?: boolean;
  /** Opacity multiplier used by `occlusion: "fade"`. @default 0.5 */
  occludedOpacity?: number;
  /** Reverse-Z depth separation used to reject self-occlusion and surface noise. @default 0.0001 */
  occlusionBias?: number;
}

export interface LabelOptions extends AnnotationVisibilityOptions {
  anchor: SupportedAnnotationAnchor;
  text: string | (() => string);
  /**
   * Use `"hide"` to suppress overlaps, `"shift"` for a general nearby search,
   * `"shift-x"` for horizontal-only movement, `"shift-y"` for vertical-only
   * movement, `"radial"` to spread labels outward from the viewport center,
   * `"cluster"` to replace overlaps with one count summary, or `"repel"` to
   * iteratively move away from blocking labels. Moving modes fall back to
   * hiding.
   * Higher z-index labels win; ties use creation order.
   * @default "none"
   */
  collision?: LabelCollisionMode;
  /** Extra separation around this label in CSS pixels. @default 0 */
  collisionPadding?: number;
  /** Maximum screen-space displacement for shift modes in CSS pixels. @default 96 */
  collisionMaxShift?: number;
  /** Draw a line from the pre-layout position to a shifted label. */
  leaderLine?: boolean | LeaderLineOptions;
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
  | "distance"
  | "occluded"
  | "collision";

export interface AnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export interface AnnotationSnapshot {
  readonly id: AnnotationId;
  readonly type: AnnotationType;
  readonly requestedVisible: boolean;
  readonly rendered: boolean;
  /** True when the latest matching provider result reports an occluder. */
  readonly occluded: boolean;
  readonly hiddenReason: AnnotationHiddenReason;
  readonly worldPosition: readonly [number, number, number] | null;
  readonly screenPosition: Readonly<AnnotationPoint> | null;
  readonly unclampedScreenPosition: Readonly<AnnotationPoint> | null;
  /** Collision-layout displacement from the projected/clamped position. */
  readonly layoutOffset: Readonly<AnnotationPoint> | null;
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
  readonly leaderLine?: Readonly<LeaderLineOptions>;
  readonly ariaLabel?: string;
  readonly role?: string;
}

export interface BackendLeaderLineGeometry {
  readonly start: Readonly<AnnotationPoint>;
  readonly end: Readonly<AnnotationPoint>;
}

export interface BackendAnnotationUpdate extends BackendAnnotationDefinition {
  /** Whether content, style, semantics, shape, size, or z-order changed. */
  readonly definitionChanged: boolean;
  readonly rendered: boolean;
  readonly screenPosition: Readonly<AnnotationPoint> | null;
  readonly leaderLineGeometry?: Readonly<BackendLeaderLineGeometry> | null;
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

export type AnnotationOcclusionState = "visible" | "occluded" | "unknown";

export interface AnnotationOcclusionRequest {
  readonly id: AnnotationId;
  readonly screenPosition: Readonly<AnnotationPoint>;
  /** Reverse-Z normalized device depth: near is 1 and far is 0. */
  readonly depth: number;
  readonly bias: number;
  /** Changes when the annotation's anchor-related configuration changes. */
  readonly revision: number;
}

/**
 * Asynchronous occlusion bridge. A layer adopts the provider and disposes it
 * with the rest of its owned resources.
 */
export interface AnnotationOcclusionProvider {
  getResult(id: AnnotationId, revision: number): AnnotationOcclusionState;
  update(requests: readonly AnnotationOcclusionRequest[]): void;
  dispose(): void;
}

export interface AnnotationLayerOptions {
  scene: SceneContext;
  camera: Camera;
  canvas: HTMLCanvasElement;
  backend: AnnotationBackend;
  /** Optional provider adopted and disposed by this layer. */
  occlusionProvider?: AnnotationOcclusionProvider;
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
