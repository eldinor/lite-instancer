import type { Mesh, PickDiscardRule, PickIgnore, SceneContext } from "@babylonjs/lite";

export type InteractionEventType =
  | "pointerdown"
  | "pointerup"
  | "click"
  | "doubleclick"
  | "contextmenu"
  | "dragstart"
  | "drag"
  | "dragend"
  | "hoverstart"
  | "hovermove"
  | "hoverend";

export type InteractionPointerType = "mouse" | "touch" | "pen";
export type InteractionMeshFilter = (mesh: Mesh) => boolean;
export type InteractionInstanceId = string | number;
export interface InteractionDetailedPickingPolicy {
  /** Exact details for pointer down/up, click, double-click, and context-menu work. */
  discrete?: boolean;
  /** Exact details for drag-surface picks. Disable for the lowest-latency point-only drag. */
  drag?: boolean;
  /** Exact details for hover picks. Disable to keep hover on the basic picker. */
  hover?: boolean;
}
export type InteractionPickKind = "discrete" | "hover" | "drag";
export type InteractionPickDetailsStatus = "available" | "disabled" | "unavailable";
export type InteractionDragEndReason =
  | "released"
  | "pointercancel"
  | "disabled"
  | "target-disposed";

export interface InteractionDiagnostics {
  readonly queuedDiscrete: number;
  readonly queuedHover: number;
  readonly queuedDrag: number;
  readonly inFlightKind: InteractionPickKind | null;
  readonly completedPicks: number;
  readonly failedPicks: number;
  readonly coalescedHoverSamples: number;
  readonly coalescedDragSamples: number;
  readonly lastSchedulerWaitMs: number | null;
  readonly lastPickDurationMs: number | null;
  readonly averagePickDurationMs: number | null;
  readonly maximumPickDurationMs: number | null;
}

export interface ClickThreshold {
  maxDistance: number;
  maxDuration: number;
}

export interface ClickThresholds {
  mouse?: Partial<ClickThreshold>;
  pen?: Partial<ClickThreshold>;
  touch?: Partial<ClickThreshold>;
}

export interface InteractionErrorContext {
  phase: "pick" | "pick-options" | "resolver" | "listener";
  eventType?: InteractionEventType;
}

export interface InteractionPickOptions {
  ignore?: PickIgnore | readonly PickIgnore[];
  discard?: PickDiscardRule;
  debugLabel?: string;
}

export interface InteractionPickOptionsContext {
  readonly kind: InteractionPickKind;
  readonly eventType: InteractionEventType;
  readonly pointerId: number;
  readonly dragTarget: InteractionTarget | null;
}

export type InteractionPickOptionsProvider = (
  context: InteractionPickOptionsContext
) => InteractionPickOptions | undefined;

export interface InteractionDragOptions {
  /** CSS-pixel movement needed to begin dragging. Falls back to the pointer's click threshold. */
  startDistance?: number;
  /** Capture the active pointer on the canvas. Defaults to true. */
  capturePointer?: boolean;
  /** Ignore the dragged mesh or thin instance while resolving the drag surface. Defaults to true. */
  ignoreTarget?: boolean;
  /** Optional mesh filter for drag surfaces; defaults to the manager's registered-target filter. */
  surfaceFilter?: InteractionMeshFilter;
}

export interface InteractionTargetOptions {
  /** Resolve a renderer slot to a stable application ID. */
  resolveInstanceId?: (thinInstanceIndex: number) => InteractionInstanceId | null;
}

export interface InteractionManagerOptions {
  scene: SceneContext;
  canvas: HTMLCanvasElement;
  /** Enable Lite 1.14 exact details independently for discrete, drag, and hover work. */
  detailedPicking?: InteractionDetailedPickingPolicy;
  /** Additional Lite pick options, optionally selected per interaction. */
  pickOptions?: InteractionPickOptions | InteractionPickOptionsProvider;
  /** Enable asynchronous drag events and pointer capture. */
  drag?: boolean | InteractionDragOptions;
  hover?: boolean;
  click?: ClickThresholds;
  doubleClickDelay?: number;
  preventContextMenu?: boolean;
  preventPointerDefault?: boolean;
  filter?: InteractionMeshFilter;
  onError?: (error: unknown, context: InteractionErrorContext) => void;
}

/** Exact GPU surface information available when `detailedPicking` is enabled and supported. */
export interface InteractionPickDetails {
  readonly faceId: number;
  /** The face's three indices when retained CPU geometry is available. */
  readonly vertexIndices: readonly [number, number, number] | null;
  /** Weights for the face's first, second, and third indexed vertices. */
  readonly barycentric: readonly [number, number, number];
  /** Babylon Lite's first-vertex barycentric weight. */
  readonly bu: number;
  /** Babylon Lite's second-vertex barycentric weight. */
  readonly bv: number;
  readonly subMeshId: number;
  readonly thinInstanceIndex: number;
  readonly pickedNormal: readonly [number, number, number] | null;
  readonly pickedNormalWorld: readonly [number, number, number] | null;
  readonly pickedFaceNormal: readonly [number, number, number] | null;
  readonly pickedFaceNormalWorld: readonly [number, number, number] | null;
  readonly pickedUV: readonly [number, number] | null;
}

/** Opaque interaction manager returned by `createInteractionManager`. */
export interface InteractionManager {
  readonly __interacterManagerBrand: never;
}

/** Opaque, stable registration handle returned by `registerMesh`. */
export interface InteractionTarget {
  readonly mesh: Mesh;
  readonly __interacterTargetBrand: never;
}

export interface InteractionEventBase {
  readonly target: InteractionTarget;
  readonly mesh: Mesh;
  /** Mesh resolved by the current pick; differs from `mesh` for drag-surface events. */
  readonly pickedMesh: Mesh | null;
  readonly pointerId: number;
  readonly pointerType: InteractionPointerType;
  readonly button: number;
  readonly buttons: number;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly timeStamp: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly pickedPoint: readonly [number, number, number] | null;
  readonly distance: number | null;
  /** Renderer slot identifying the interaction target, or -1 for ordinary meshes. */
  readonly thinInstanceIndex: number;
  /** Renderer slot resolved on the picked surface, or -1 for ordinary meshes/misses. */
  readonly pickedThinInstanceIndex: number;
  /** Stable application ID resolved by the target, when configured. */
  readonly instanceId: InteractionInstanceId | null;
  readonly pickDetailsStatus: InteractionPickDetailsStatus;
  readonly pickDetails: InteractionPickDetails | null;
  stopPropagation(): void;
}

export type InteractionEventFor<T extends InteractionEventType> = T extends InteractionEventType
  ? InteractionEventBase &
      { readonly type: T } &
      (T extends "dragend" ? { readonly dragEndReason: InteractionDragEndReason } : {})
  : never;

export type InteractionEvent = InteractionEventFor<InteractionEventType>;
export type InteractionDragStartEvent = InteractionEventFor<"dragstart">;
export type InteractionDragEvent = InteractionEventFor<"drag">;
export type InteractionDragEndEvent = InteractionEventFor<"dragend">;
export type InteractionListener<T extends InteractionEventType = InteractionEventType> = (
  event: InteractionEventFor<T>
) => void;
