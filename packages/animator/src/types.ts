import type {
  AnimationGroup,
  AnimationManager,
  EngineContext,
  SceneContext
} from "@babylonjs/lite";

declare const playbackIdBrand: unique symbol;

export type PlaybackId = string & { readonly [playbackIdBrand]: true };
export type AnimationPlaybackState =
  | "pending"
  | "playing"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type AnimationPlaybackStatus = "completed" | "cancelled" | "interrupted";
export type AnimationInterruptionPolicy = "replace" | "crossfade";

export interface ClipRegistryEntry {
  readonly id: string;
  readonly sourceName: string;
  readonly group: AnimationGroup;
}

export interface ClipRegistry {
  readonly entries: readonly ClipRegistryEntry[];
  readonly size: number;
}

export interface ClipRegistryOptions {
  aliases?: Readonly<Record<string, string>>;
}

export interface ManualAnimatorUpdate {
  mode: "manual";
}

export interface SceneAnimatorUpdate {
  mode: "scene";
  scene: SceneContext;
}

export interface AnimatorOptions {
  engine: EngineContext;
  clips: ClipRegistry | readonly AnimationGroup[];
  aliases?: Readonly<Record<string, string>>;
  update: ManualAnimatorUpdate | SceneAnimatorUpdate;
  autoplay?: string;
  speed?: number;
  strict?: boolean;
}

export interface PlayAnimationOptions {
  loop?: boolean;
  speed?: number;
  restart?: boolean;
  startTime?: number;
  normalizedTime?: number;
  /**
   * Starts the destination at the dominant active playback's normalized clip phase.
   * Useful for cyclic locomotion clips with different durations.
   */
  syncNormalizedTime?: boolean;
  interruption?: AnimationInterruptionPolicy;
  fadeIn?: number;
  signal?: AbortSignal;
}

export interface AnimationPlaybackResult {
  clipId: string;
  status: AnimationPlaybackStatus;
  elapsed: number;
  reason?: unknown;
}

export interface AnimationPlayback {
  readonly id: PlaybackId;
  readonly clipId: string;
  readonly state: AnimationPlaybackState;
  readonly finished: Promise<AnimationPlaybackResult>;
  /** Pauses only this playback handle. */
  pause(): void;
  /** Resumes this playback handle when it was paused individually. */
  resume(): void;
  /** Cancels the playback and resolves `finished` with the optional reason. */
  cancel(reason?: unknown): void;
  /** Sets this playback's positive speed multiplier. */
  setSpeed(speed: number): void;
}

export interface Animator {
  readonly id: string;
  readonly disposed: boolean;
}

export interface AnimationMarkerDefinition {
  readonly id: string;
  readonly time?: number;
  readonly normalizedTime?: number;
  readonly once?: boolean;
  readonly metadata?: unknown;
}

export interface AnimationMarkerOptions {
  time?: number;
  normalizedTime?: number;
  once?: boolean;
  metadata?: unknown;
}

export interface AnimationMarkerEvent {
  readonly animator: Animator;
  readonly playback: AnimationPlayback;
  readonly clipId: string;
  readonly markerId: string;
  readonly time: number;
  readonly normalizedTime: number;
  readonly loopIndex: number;
  readonly metadata?: unknown;
}

export type AnimatorEventType =
  | "started"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

export interface AnimatorEvent {
  readonly type: AnimatorEventType;
  readonly animator: Animator;
  readonly playback: AnimationPlayback;
  readonly result?: AnimationPlaybackResult;
  readonly error?: unknown;
}

export interface AnimationPlaybackSnapshot {
  readonly id: PlaybackId;
  readonly clipId: string;
  readonly sourceName: string;
  readonly state: AnimationPlaybackState;
  readonly time: number;
  readonly normalizedTime: number;
  readonly elapsed: number;
  readonly loopIndex: number;
  readonly loop: boolean;
  readonly speed: number;
  readonly weight: number;
}

export interface AnimatorTransitionSnapshot {
  readonly destinationClipId: string;
  readonly duration: number;
  readonly elapsed: number;
  readonly progress: number;
  readonly sources: readonly string[];
}

export interface AnimatorSnapshot {
  readonly id: string;
  readonly disposed: boolean;
  readonly paused: boolean;
  readonly speed: number;
  readonly updateMode: "scene" | "manual";
  readonly activePlaybacks: readonly AnimationPlaybackSnapshot[];
  readonly transition: AnimatorTransitionSnapshot | null;
  readonly markerCounts: Readonly<Record<string, number>>;
}

export interface InternalAnimatorAccess {
  readonly manager: AnimationManager;
}

/** Receives one Animator playback lifecycle event. */
export type AnimatorEventListener = (event: AnimatorEvent) => void;
/** Receives one crossed animation marker. */
export type AnimationMarkerListener = (event: AnimationMarkerEvent) => void;
