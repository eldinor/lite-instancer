import type { Mesh, SceneContext } from "@babylonjs/lite";

export type InteractionEventType =
  | "pointerdown"
  | "pointerup"
  | "click"
  | "doubleclick"
  | "contextmenu"
  | "hoverstart"
  | "hovermove"
  | "hoverend";

export type InteractionPointerType = "mouse" | "touch" | "pen";
export type InteractionMeshFilter = (mesh: Mesh) => boolean;

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
  phase: "pick" | "listener";
  eventType?: InteractionEventType;
}

export interface InteractionManagerOptions {
  scene: SceneContext;
  canvas: HTMLCanvasElement;
  hover?: boolean;
  click?: ClickThresholds;
  doubleClickDelay?: number;
  preventContextMenu?: boolean;
  preventPointerDefault?: boolean;
  filter?: InteractionMeshFilter;
  onError?: (error: unknown, context: InteractionErrorContext) => void;
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

export interface InteractionEvent {
  readonly type: InteractionEventType;
  readonly target: InteractionTarget;
  readonly mesh: Mesh;
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
  stopPropagation(): void;
}

export type InteractionListener = (event: InteractionEvent) => void;

