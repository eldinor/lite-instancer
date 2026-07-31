import type { Camera, Mat4, Mesh, SceneContext } from "@babylonjs/lite";

export type AnnotationId = number & { readonly __annotationIdBrand: unique symbol };
export type AnnotationType = "label" | "marker";
/**
 * Marker shape identifier. Known values retain editor completion while the
 * open string tail permits backend-specific and application-registered shapes.
 */
export type MarkerShape =
  | "dot"
  | "ring"
  | "square"
  | "diamond"
  | "triangle"
  | "cross"
  | "pin"
  | (string & {});

export interface MarkerPulseAnimation {
  readonly type: "pulse";
  /**
   * Pulse animation always runs through the TextRenderer backend's GPU Sprite
   * FX path. Applications do not need to select a GPU execution mode.
   */
  /** Pulse cycles per second. @defaultValue `1` */
  readonly frequency?: number;
  /** Initial phase measured in cycles. @defaultValue `0` */
  readonly phase?: number;
  /** Lowest opacity multiplier. @defaultValue `0.35` */
  readonly minOpacity?: number;
  /** Highest opacity multiplier. @defaultValue `1` */
  readonly maxOpacity?: number;
}

export type MarkerAnimationOptions = MarkerPulseAnimation;
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
      /** Coordinate space of `point`. @defaultValue `"local"` */
      readonly space?: "local" | "world";
    }
  | {
      readonly kind: "mesh";
      readonly mesh: Mesh;
      /** Named point derived from the mesh bounds. @defaultValue `"center"` */
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
  /** Resolves the current world position into `out`. */
  resolve(out: Float32Array): AnchorResolution;
}

export type AnnotationAnchor = WorldAnchor | MeshAnchor;
export type SupportedAnnotationAnchor = AnnotationAnchor | ResolvableAnchor;

export interface AnnotationStyle {
  /** Foreground color. The backend supplies its own default when omitted. */
  color?: string;
  /** Background/fill color. The backend derives or omits it when unset. */
  backgroundColor?: string;
  /** Overall annotation opacity. @defaultValue `1` */
  opacity?: number;
  /** Label font size; defaults to the selected backend's font size. */
  fontSize?: number;
  /** Label font weight; defaults to the selected font/backend behavior. */
  fontWeight?: string | number;
  /** Border color; falls back to the annotation foreground where applicable. */
  borderColor?: string;
  /** Border width in CSS pixels. @defaultValue `0` */
  borderWidth?: number;
  /** Border radius in CSS pixels. @defaultValue `0` */
  borderRadius?: number;
  /** Label inset in CSS pixels. @defaultValue `0` */
  padding?: number;
  /** Additional HTML class. @defaultValue `undefined` */
  className?: string;
  /** HTML opacity transition duration in milliseconds. @defaultValue `0` */
  opacityTransitionDuration?: number;
}

export interface LeaderLineOptions {
  /** Line color; falls back to the border, foreground, or backend default. */
  color?: string;
  /** Line width in CSS pixels. @defaultValue `1` */
  width?: number;
  /** Line opacity. @defaultValue `1` */
  opacity?: number;
  /** Line-end shape. Rounded caps cost three GPU sprites per line. @defaultValue `"square"` */
  lineCap?: "square" | "round";
  /** Minimum collision-layout displacement before the line is shown. @defaultValue `8` */
  minLength?: number;
}

export interface AnnotationVisibilityOptions {
  /** Requested visibility independent of layout filtering. @defaultValue `true` */
  visible?: boolean;
  /** Inclusive minimum camera distance; disabled when omitted. @defaultValue `undefined` */
  minDistance?: number;
  /** Inclusive maximum camera distance; disabled when omitted. @defaultValue `undefined` */
  maxDistance?: number;
  /** Hide projections outside the viewport unless clamping is enabled. @defaultValue `true` */
  hideWhenOffscreen?: boolean;
  /** Clamp the projected position to the padded viewport. @defaultValue `false` */
  clampToViewport?: boolean;
  /** Provider-driven occlusion presentation. @defaultValue `"none"` */
  occlusion?: AnnotationOcclusionMode;
  /** Compatibility alias for hide-mode occlusion. @defaultValue `false` @deprecated Use `occlusion: "hide"` or `"fade"`. */
  hideWhenOccluded?: boolean;
  /** Opacity multiplier used by `occlusion: "fade"`. @defaultValue `0.5` */
  occludedOpacity?: number;
  /** Reverse-Z depth separation used to reject self-occlusion and surface noise. @defaultValue `0.0001` */
  occlusionBias?: number;
}

export interface LabelOptions extends AnnotationVisibilityOptions {
  anchor: SupportedAnnotationAnchor;
  /** Static text or a callback reevaluated when the label is invalidated. */
  text: string | (() => string);
  /**
   * Use `"hide"` to suppress overlaps, `"shift"` for a general nearby search,
   * `"shift-x"` for horizontal-only movement, `"shift-y"` for vertical-only
   * movement, `"radial"` to spread labels outward from the viewport center,
   * `"cluster"` to replace overlaps with one count summary, or `"repel"` to
   * iteratively move away from blocking labels. Moving modes fall back to
   * hiding.
   * Higher z-index labels win; ties use creation order.
   * @defaultValue `"none"`
   */
  collision?: LabelCollisionMode;
  /** Extra separation around this label in CSS pixels. @defaultValue `0` */
  collisionPadding?: number;
  /** Maximum screen-space displacement for shift modes in CSS pixels. @defaultValue `96` */
  collisionMaxShift?: number;
  /** Draw a line from the pre-layout position to a shifted label. @defaultValue `false` */
  leaderLine?: boolean | LeaderLineOptions;
  /** Draw and collision priority. @defaultValue `0` */
  zIndex?: number;
  /** Offset applied in world coordinates. @defaultValue `[0, 0, 0]` */
  worldOffset?: Vec3Like;
  /** Offset applied in CSS pixels. @defaultValue `[0, 0]` */
  screenOffset?: Vec2Like;
  /** Backend presentation overrides. @defaultValue `{}` */
  style?: AnnotationStyle;
  /** Accessible label used by the HTML backend. @defaultValue `undefined` */
  ariaLabel?: string;
  /** ARIA role used by the HTML backend. @defaultValue `undefined` */
  role?: string;
}

export interface MarkerOptions extends AnnotationVisibilityOptions {
  anchor: SupportedAnnotationAnchor;
  /** Marker shape identifier. @defaultValue `"dot"` */
  shape?: MarkerShape;
  /** Marker size in CSS pixels. @defaultValue `12` */
  size?: number;
  /**
   * Optional backend animation. A pulse uses GPU Sprite FX by default and
   * never requires per-frame `updateMarker()` calls.
   * @defaultValue `undefined`
   */
  animation?: MarkerAnimationOptions;
  /** Draw priority. @defaultValue `0` */
  zIndex?: number;
  /** Offset applied in world coordinates. @defaultValue `[0, 0, 0]` */
  worldOffset?: Vec3Like;
  /** Offset applied in CSS pixels. @defaultValue `[0, 0]` */
  screenOffset?: Vec2Like;
  /** Backend presentation overrides. @defaultValue `{}` */
  style?: AnnotationStyle;
}

export type LabelPatch = Partial<Omit<LabelOptions, "anchor">> & { anchor?: SupportedAnnotationAnchor };
export type MarkerPatch = Partial<Omit<MarkerOptions, "anchor" | "animation">> & {
  anchor?: SupportedAnnotationAnchor;
  /** Set to null to return the marker to the static rendering path. */
  animation?: MarkerAnimationOptions | null;
};

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
  readonly animation?: Readonly<MarkerAnimationOptions>;
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

/** A position-only marker update used by backends that can batch moving sprites. */
export interface BackendMarkerPositionUpdate {
  readonly resource: unknown;
  readonly rendered: boolean;
  readonly x: number;
  readonly y: number;
}

export interface BackendLabelPositionUpdate extends BackendMarkerPositionUpdate {}

export interface AnnotationBackend {
  /** Allocates the backend-specific resource for an annotation. */
  create(definition: BackendAnnotationDefinition): unknown;
  /** Applies a complete projected annotation update. */
  update(resource: unknown, update: BackendAnnotationUpdate): void;
  /** Optional fast path for clean markers whose only per-frame change is projection. */
  updateMarkerPositions?(updates: readonly BackendMarkerPositionUpdate[]): void;
  /** Optional fast path for clean labels whose glyph layout is unchanged. */
  updateLabelPositions?(updates: readonly BackendLabelPositionUpdate[]): void;
  /** Measures the resource in CSS pixels, or returns null when unavailable. */
  measure(resource: unknown): BackendBounds | null;
  /** Updates the backend viewport in CSS pixels. */
  setViewport(viewport: AnnotationViewport): void;
  /** Releases one resource previously returned by {@link create}. */
  disposeResource(resource: unknown): void;
  /** Releases every resource owned by the backend. */
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
  /** Returns the latest result matching an annotation revision. */
  getResult(id: AnnotationId, revision: number): AnnotationOcclusionState;
  /** Submits the currently relevant annotation depth requests. */
  update(requests: readonly AnnotationOcclusionRequest[]): void;
  /** Releases provider resources and cancels future work. */
  dispose(): void;
}

export interface AnnotationLayerOptions {
  scene: SceneContext;
  camera: Camera;
  canvas: HTMLCanvasElement;
  backend: AnnotationBackend;
  /** Optional provider adopted and disposed by this layer. @defaultValue `undefined` */
  occlusionProvider?: AnnotationOcclusionProvider;
  /** Layer update scheduling. @defaultValue `"manual"` */
  updateMode?: "manual" | "raf";
  /** Screen-edge inset used for clamping and collision layout. @defaultValue `8` */
  viewportPadding?: number;
}

export interface ProjectionInput {
  readonly position: Vec3Like;
  readonly viewProjection: Mat4;
  readonly viewport: AnnotationViewport;
  readonly cameraPosition: Vec3Like;
  /** Skip camera-distance calculation when distance filtering/output is not needed. @defaultValue `true` */
  readonly calculateDistance?: boolean;
}

export interface ProjectionResult {
  readonly behindCamera: boolean;
  readonly offscreen: boolean;
  readonly screenPosition: AnnotationPoint;
  readonly depth: number;
  readonly distance: number;
}
