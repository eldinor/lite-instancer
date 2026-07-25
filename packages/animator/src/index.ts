export {
  createClipRegistry,
  getClipRegistryEntry,
  isClipRegistry
} from "./clip-registry.js";
export {
  createAnimator,
  defineAnimationMarkers,
  disposeAnimator,
  getActivePlaybacks,
  getAnimatorSnapshot,
  getPlayback,
  marker,
  onAnimationMarker,
  onAnimatorEvent,
  onClipMarker,
  pauseAnimator,
  playAnimation,
  playAnimationAsync,
  resumeAnimator,
  setAnimatorSpeed,
  setPlaybackNormalizedTime,
  setPlaybackTime,
  stopAnimation,
  updateAnimator
} from "./core.js";
export { AnimatorError } from "./errors.js";
export type { AnimatorErrorCode } from "./errors.js";
export type {
  AnimationInterruptionPolicy,
  AnimationMarkerDefinition,
  AnimationMarkerEvent,
  AnimationMarkerListener,
  AnimationMarkerOptions,
  AnimationPlayback,
  AnimationPlaybackResult,
  AnimationPlaybackSnapshot,
  AnimationPlaybackState,
  AnimationPlaybackStatus,
  Animator,
  AnimatorEvent,
  AnimatorEventListener,
  AnimatorEventType,
  AnimatorOptions,
  AnimatorSnapshot,
  AnimatorTransitionSnapshot,
  ClipRegistry,
  ClipRegistryEntry,
  ClipRegistryOptions,
  ManualAnimatorUpdate,
  PlayAnimationOptions,
  PlaybackId,
  SceneAnimatorUpdate
} from "./types.js";
