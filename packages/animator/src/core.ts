import {
  addAnimationGroup,
  createAnimationManager,
  enableAnimationBlending,
  goToFrame,
  onBeforeRender,
  pauseAnimation as pauseLiteAnimation,
  playAnimation as playLiteAnimation,
  removeAnimationGroup,
  setAnimationWeight,
  stopAnimation as stopLiteAnimation,
  updateAnimationManager,
  type AnimationGroup,
  type AnimationManager,
  type SceneContext
} from "@babylonjs/lite";
import {
  createClipRegistry,
  getClipRegistryEntry,
  isClipRegistry
} from "./clip-registry.js";
import { AnimatorError } from "./errors.js";
import type {
  AnimationMarkerDefinition,
  AnimationMarkerEvent,
  AnimationMarkerListener,
  AnimationMarkerOptions,
  AnimationPlayback,
  AnimationPlaybackResult,
  AnimationPlaybackSnapshot,
  AnimationPlaybackState,
  Animator,
  AnimatorEvent,
  AnimatorEventListener,
  AnimatorOptions,
  AnimatorSnapshot,
  AnimatorTransitionSnapshot,
  ClipRegistry,
  ClipRegistryEntry,
  PlayAnimationOptions,
  PlaybackId
} from "./types.js";

interface PlaybackRecord {
  animator: InternalAnimator;
  entry: ClipRegistryEntry;
  handle: AnimationPlayback;
  state: AnimationPlaybackState;
  speed: number;
  loop: boolean;
  elapsed: number;
  absoluteTime: number;
  loopIndex: number;
  onceMarkers: Set<string>;
  settled: boolean;
  resolve(result: AnimationPlaybackResult): void;
  reject(error: unknown): void;
  removeAbort(): void;
}

interface Transition {
  destination: PlaybackRecord;
  sources: Map<PlaybackRecord, number>;
  duration: number;
  elapsed: number;
  destinationStart: number;
}

interface MarkerListenerRecord {
  group?: AnimationGroup;
  markerId: string;
  listener: AnimationMarkerListener;
}

interface InternalAnimator extends Animator {
  disposed: boolean;
  paused: boolean;
  speed: number;
  strict: boolean;
  manager: AnimationManager;
  registry: ClipRegistry;
  updateMode: "scene" | "manual";
  records: Map<PlaybackId, PlaybackRecord>;
  activeByGroup: Map<AnimationGroup, PlaybackRecord>;
  markersByGroup: Map<AnimationGroup, readonly AnimationMarkerDefinition[]>;
  markerListeners: Set<MarkerListenerRecord>;
  eventListeners: Set<AnimatorEventListener>;
  transition: Transition | null;
  detachScene(): void;
  nextPlaybackId: number;
}

interface SceneCallbacks {
  _beforeRender: Array<(deltaMs: number) => void>;
}

const animatorOwners = new WeakMap<AnimationGroup, InternalAnimator>();
const playbackRecords = new WeakMap<AnimationPlayback, PlaybackRecord>();
let nextAnimatorId = 1;

/**
 * Creates an Animator and gives its dedicated Babylon Lite manager exclusive ownership
 * of every registered group.
 *
 * Imported groups are stopped and assigned zero weight before optional autoplay begins.
 *
 * @throws {@link AnimatorError} for invalid options or ownership conflicts.
 */
export function createAnimator(options: AnimatorOptions): Animator {
  validatePositive(options.speed ?? 1, "Animator speed");
  const registry = isClipRegistry(options.clips)
    ? options.aliases
      ? createClipRegistry(uniqueGroups(options.clips), { aliases: options.aliases })
      : options.clips
    : createClipRegistry(
        options.clips,
        options.aliases ? { aliases: options.aliases } : {}
      );
  const manager = createAnimationManager({ engine: options.engine });
  const animator: InternalAnimator = {
    id: `animator-${nextAnimatorId++}`,
    disposed: false,
    paused: false,
    speed: options.speed ?? 1,
    strict: options.strict ?? true,
    manager,
    registry,
    updateMode: options.update.mode,
    records: new Map(),
    activeByGroup: new Map(),
    markersByGroup: new Map(),
    markerListeners: new Set(),
    eventListeners: new Set(),
    transition: null,
    detachScene: () => undefined,
    nextPlaybackId: 1
  };

  const groups = uniqueGroups(registry);
  try {
    for (const group of groups) {
      const owner = animatorOwners.get(group);
      if (owner && !owner.disposed) {
        throw new AnimatorError(
          "ownership-conflict",
          `Animation group "${group.name}" is already owned by ${owner.id}.`,
          { group: group.name, owner: owner.id }
        );
      }
      addAnimationGroup(manager, group);
      animatorOwners.set(group, animator);
      // glTF loading starts its first animation group automatically. Animator must
      // establish a clean baseline or that untracked group joins weighted mixing
      // during the first crossfade and can over-apply root translation or scale.
      stopLiteAnimation(group);
      setAnimationWeight(group, 0);
    }
    enableAnimationBlending(manager);
    if (options.update.mode === "scene") {
      animator.detachScene = attachSceneUpdate(animator, options.update.scene);
    }
    if (options.autoplay) {
      playAnimation(animator, options.autoplay, { loop: true });
    }
  } catch (error) {
    releaseGroups(animator, groups);
    animator.detachScene();
    animator.disposed = true;
    if (error instanceof AnimatorError) throw error;
    throw new AnimatorError(
      "ownership-conflict",
      "Unable to attach animation groups to the Animator manager.",
      { cause: error }
    );
  }
  return animator;
}

/**
 * Releases an Animator, cancels active playback, detaches its groups, and removes its
 * scene callback. Calling this more than once has no effect.
 */
export function disposeAnimator(animator: Animator): void {
  const internal = asAnimator(animator);
  if (internal.disposed) return;
  internal.disposed = true;
  internal.detachScene();
  internal.transition = null;
  for (const record of [...internal.activeByGroup.values()]) {
    settle(record, "cancelled", "animator-disposed");
  }
  releaseGroups(internal, uniqueGroups(internal.registry));
  internal.activeByGroup.clear();
  internal.markerListeners.clear();
  internal.eventListeners.clear();
  internal.markersByGroup.clear();
}

/**
 * Advances a manual Animator by a delta expressed in seconds.
 *
 * Scene-driven Animators call the same update pipeline from their registered render hook.
 *
 * @throws {@link AnimatorError} when the delta is invalid or the Animator is disposed.
 */
export function updateAnimator(animator: Animator, deltaSeconds: number): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new AnimatorError(
      "invalid-option",
      "Animator delta time must be a finite non-negative number.",
      { deltaSeconds }
    );
  }
  if (internal.paused || deltaSeconds === 0) return;

  const scaledDelta = deltaSeconds * internal.speed;
  try {
    updateTransition(internal, scaledDelta);
    const activeBeforeUpdate = [...internal.activeByGroup.values()];
    for (const record of activeBeforeUpdate) {
      record.entry.group.speedRatio = record.speed * internal.speed;
    }
    updateAnimationManager(internal.manager, deltaSeconds * 1000);
    for (const record of activeBeforeUpdate) {
      if (record.settled || record.state === "paused") continue;
      const advance = deltaSeconds * record.speed * internal.speed;
      const previousAbsolute = record.absoluteTime;
      record.absoluteTime += advance;
      record.elapsed += advance;
      dispatchCrossedMarkers(record, previousAbsolute, record.absoluteTime);
      const duration = record.entry.group.duration;
      record.loopIndex =
        record.loop && duration > 0 ? Math.floor(record.absoluteTime / duration) : 0;
      if (!record.loop && duration >= 0 && record.absoluteTime >= duration) {
        record.entry.group.currentTime = duration;
        settle(record, "completed");
      }
    }
  } catch (error) {
    for (const record of [...internal.activeByGroup.values()]) {
      fail(record, error);
    }
    throw error;
  }
}

/**
 * Starts a clip by source name or semantic alias and returns its lifecycle handle.
 *
 * Replaying an active clip returns its existing handle unless `restart` is true.
 * Validation errors are thrown synchronously.
 */
export function playAnimation(
  animator: Animator,
  clipId: string,
  options: PlayAnimationOptions = {}
): AnimationPlayback {
  const internal = asAnimator(animator);
  assertUsable(internal);
  const entry = requireEntry(internal, clipId);
  validatePlayOptions(options, entry.group.duration);

  const existing = internal.activeByGroup.get(entry.group);
  if (existing && !options.restart) return existing.handle;
  if (existing) settle(existing, "interrupted", "restarted");

  const active = [...internal.activeByGroup.values()];
  const policy = options.interruption ?? "replace";
  const fadeDuration = options.fadeIn ?? 0.2;
  if (policy === "crossfade" && fadeDuration > 0) {
    for (const source of active) {
      if (!groupsAreCompatible(source.entry.group, entry.group)) {
        throw new AnimatorError(
          "incompatible-crossfade",
          `Animation groups "${source.entry.sourceName}" and "${entry.sourceName}" do not share animation targets.`,
          { from: source.entry.sourceName, to: entry.sourceName }
        );
      }
    }
  }

  const record = createPlaybackRecord(internal, entry, options);
  internal.records.set(record.handle.id, record);
  internal.activeByGroup.set(entry.group, record);
  playbackRecords.set(record.handle, record);

  const synchronizedSource = options.syncNormalizedTime
    ? dominantPlayback(active)
    : undefined;
  const synchronizedTime = synchronizedSource
    ? normalizedPlaybackTime(synchronizedSource) * entry.group.duration
    : undefined;
  const startTime =
    options.normalizedTime !== undefined
      ? options.normalizedTime * entry.group.duration
      : (options.startTime ?? synchronizedTime ?? 0);
  record.absoluteTime = startTime;
  seekRecord(record, startTime);
  entry.group.loopAnimation = record.loop;

  if (policy === "crossfade" && fadeDuration > 0 && active.length > 0) {
    setAnimationWeight(entry.group, 0);
    playLiteAnimation(entry.group);
    record.state = "playing";
    beginTransition(internal, record, active, fadeDuration);
  } else {
    for (const source of active) settle(source, "interrupted", "replaced");
    internal.transition = null;
    setAnimationWeight(entry.group, 1);
    playLiteAnimation(entry.group);
    record.state = "playing";
  }

  emit(internal, { type: "started", animator: internal, playback: record.handle });
  if (options.signal) bindAbort(record, options.signal);
  return record.handle;
}

/** Starts a clip and returns its completion, cancellation, or interruption result. */
export function playAnimationAsync(
  animator: Animator,
  clipId: string,
  options: PlayAnimationOptions = {}
): Promise<AnimationPlaybackResult> {
  return playAnimation(animator, clipId, options).finished;
}

/**
 * Stops one active clip, or every active clip when `clipId` is omitted.
 * Stopped handles resolve as cancelled.
 */
export function stopAnimation(animator: Animator, clipId?: string): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  if (clipId !== undefined) {
    const entry = requireEntry(internal, clipId);
    const record = internal.activeByGroup.get(entry.group);
    if (record) settle(record, "cancelled", "stopped");
    return;
  }
  for (const record of [...internal.activeByGroup.values()]) {
    settle(record, "cancelled", "stopped");
  }
}

/** Pauses every active playback and freezes Animator time, transitions, and markers. */
export function pauseAnimator(animator: Animator): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  if (internal.paused) return;
  internal.paused = true;
  for (const record of internal.activeByGroup.values()) {
    pauseLiteAnimation(record.entry.group);
  }
}

/** Resumes an Animator previously paused with {@link pauseAnimator}. */
export function resumeAnimator(animator: Animator): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  if (!internal.paused) return;
  internal.paused = false;
  for (const record of internal.activeByGroup.values()) {
    if (record.state !== "paused") playLiteAnimation(record.entry.group);
  }
}

/**
 * Changes the global playback multiplier for the Animator.
 *
 * @throws {@link AnimatorError} unless `speed` is finite and greater than zero.
 */
export function setAnimatorSpeed(animator: Animator, speed: number): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  validatePositive(speed, "Animator speed");
  internal.speed = speed;
}

/**
 * Silently seeks a playback to a time in seconds without emitting crossed markers.
 *
 * @throws {@link AnimatorError} when the time lies outside the clip.
 */
export function setPlaybackTime(playback: AnimationPlayback, seconds: number): void {
  const record = requirePlayback(playback);
  assertUsable(record.animator);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > record.entry.group.duration) {
    throw new AnimatorError(
      "invalid-option",
      `Playback time must be between 0 and ${record.entry.group.duration}.`,
      { seconds }
    );
  }
  record.absoluteTime = seconds;
  record.loopIndex = 0;
  seekRecord(record, seconds);
}

/**
 * Silently seeks a playback to a normalized time from zero through one.
 *
 * @throws {@link AnimatorError} when `normalizedTime` is outside `[0, 1]`.
 */
export function setPlaybackNormalizedTime(
  playback: AnimationPlayback,
  normalizedTime: number
): void {
  if (!Number.isFinite(normalizedTime) || normalizedTime < 0 || normalizedTime > 1) {
    throw new AnimatorError(
      "invalid-option",
      "Normalized playback time must be between 0 and 1.",
      { normalizedTime }
    );
  }
  const record = requirePlayback(playback);
  setPlaybackTime(playback, normalizedTime * record.entry.group.duration);
}

/** Returns handles for the Animator's currently contributing playbacks. */
export function getActivePlaybacks(animator: Animator): readonly AnimationPlayback[] {
  const internal = asAnimator(animator);
  return [...internal.activeByGroup.values()].map((record) => record.handle);
}

/** Finds a playback by its opaque ID, including handles that have already settled. */
export function getPlayback(
  animator: Animator,
  playbackId: PlaybackId
): AnimationPlayback | undefined {
  return asAnimator(animator).records.get(playbackId)?.handle;
}

/**
 * Replaces the marker definitions for a clip after validating and sorting them by time.
 *
 * @throws {@link AnimatorError} for unknown clips, duplicate IDs, or invalid times.
 */
export function defineAnimationMarkers(
  animator: Animator,
  clipId: string,
  markers: readonly AnimationMarkerDefinition[]
): void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  const entry = requireEntry(internal, clipId);
  const ids = new Set<string>();
  const validated = markers.map((definition) => {
    validateMarker(definition, entry.group.duration);
    if (ids.has(definition.id)) {
      throw new AnimatorError(
        "invalid-marker",
        `Duplicate marker "${definition.id}" for clip "${clipId}".`,
        { clipId, markerId: definition.id }
      );
    }
    ids.add(definition.id);
    return Object.freeze({ ...definition });
  });
  validated.sort(
    (left, right) =>
      markerTime(left, entry.group.duration) - markerTime(right, entry.group.duration)
  );
  internal.markersByGroup.set(entry.group, Object.freeze(validated));
}

/** Creates an immutable marker definition for use with {@link defineAnimationMarkers}. */
export function marker(
  id: string,
  options: AnimationMarkerOptions
): AnimationMarkerDefinition {
  return Object.freeze({ id, ...options });
}

/**
 * Subscribes to a marker ID across all clips.
 *
 * @returns An idempotent unsubscribe function.
 */
export function onAnimationMarker(
  animator: Animator,
  markerId: string,
  listener: AnimationMarkerListener
): () => void {
  return addMarkerListener(asAnimator(animator), { markerId, listener });
}

/**
 * Subscribes to one marker ID on one clip.
 *
 * @returns An idempotent unsubscribe function.
 */
export function onClipMarker(
  animator: Animator,
  clipId: string,
  markerId: string,
  listener: AnimationMarkerListener
): () => void {
  const internal = asAnimator(animator);
  const entry = requireEntry(internal, clipId);
  return addMarkerListener(internal, { group: entry.group, markerId, listener });
}

/**
 * Subscribes to Animator playback lifecycle events.
 *
 * @returns An idempotent unsubscribe function.
 */
export function onAnimatorEvent(
  animator: Animator,
  listener: AnimatorEventListener
): () => void {
  const internal = asAnimator(animator);
  assertUsable(internal);
  internal.eventListeners.add(listener);
  return unsubscribeFrom(internal.eventListeners, listener);
}

/** Returns a detached snapshot suitable for diagnostics and UI display. */
export function getAnimatorSnapshot(animator: Animator): AnimatorSnapshot {
  const internal = asAnimator(animator);
  const markerCounts: Record<string, number> = {};
  for (const entry of internal.registry.entries) {
    const count = internal.markersByGroup.get(entry.group)?.length ?? 0;
    if (count > 0) markerCounts[entry.id] = count;
  }
  return {
    id: internal.id,
    disposed: internal.disposed,
    paused: internal.paused,
    speed: internal.speed,
    updateMode: internal.updateMode,
    activePlaybacks: [...internal.activeByGroup.values()].map(toPlaybackSnapshot),
    transition: toTransitionSnapshot(internal.transition),
    markerCounts
  };
}

function createPlaybackRecord(
  animator: InternalAnimator,
  entry: ClipRegistryEntry,
  options: PlayAnimationOptions
): PlaybackRecord {
  let resolve!: (result: AnimationPlaybackResult) => void;
  let reject!: (error: unknown) => void;
  const finished = new Promise<AnimationPlaybackResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const id = `${animator.id}-playback-${animator.nextPlaybackId++}` as PlaybackId;
  const record = {
    animator,
    entry,
    handle: undefined as unknown as AnimationPlayback,
    state: "pending" as AnimationPlaybackState,
    speed: options.speed ?? 1,
    loop: options.loop ?? false,
    elapsed: 0,
    absoluteTime: 0,
    loopIndex: 0,
    onceMarkers: new Set<string>(),
    settled: false,
    resolve,
    reject,
    removeAbort: () => undefined
  };
  validatePositive(record.speed, "Playback speed");
  record.handle = {
    id,
    clipId: entry.id,
    get state() {
      return record.state;
    },
    finished,
    pause: () => pausePlayback(record),
    resume: () => resumePlayback(record),
    cancel: (reason?: unknown) => settle(record, "cancelled", reason),
    setSpeed: (speed: number) => {
      validatePositive(speed, "Playback speed");
      record.speed = speed;
      record.entry.group.speedRatio = speed * record.animator.speed;
    }
  };
  return record;
}

function pausePlayback(record: PlaybackRecord): void {
  if (record.settled || record.state === "paused") return;
  assertUsable(record.animator);
  record.state = "paused";
  pauseLiteAnimation(record.entry.group);
}

function resumePlayback(record: PlaybackRecord): void {
  if (record.settled || record.state !== "paused") return;
  assertUsable(record.animator);
  record.state = "playing";
  if (!record.animator.paused) playLiteAnimation(record.entry.group);
}

function beginTransition(
  animator: InternalAnimator,
  destination: PlaybackRecord,
  sources: readonly PlaybackRecord[],
  duration: number
): void {
  const sourceWeights = new Map<PlaybackRecord, number>();
  let total = 0;
  for (const source of sources) {
    const weight = Math.max(0, source.entry.group.weight);
    sourceWeights.set(source, weight);
    total += weight;
  }
  if (total <= 0) {
    const equalWeight = sources.length > 0 ? 1 / sources.length : 0;
    for (const source of sources) sourceWeights.set(source, equalWeight);
  } else {
    for (const [source, weight] of sourceWeights) sourceWeights.set(source, weight / total);
  }
  animator.transition = {
    destination,
    sources: sourceWeights,
    duration,
    elapsed: 0,
    destinationStart: 0
  };
}

function updateTransition(animator: InternalAnimator, deltaSeconds: number): void {
  const transition = animator.transition;
  if (!transition) return;
  transition.elapsed = Math.min(transition.duration, transition.elapsed + deltaSeconds);
  const progress = transition.duration === 0 ? 1 : transition.elapsed / transition.duration;
  let total = transition.destinationStart + (1 - transition.destinationStart) * progress;
  const weights = new Map<PlaybackRecord, number>();
  for (const [source, startWeight] of transition.sources) {
    if (source.settled) continue;
    const weight = startWeight * (1 - progress);
    weights.set(source, weight);
    total += weight;
  }
  const destinationWeight =
    transition.destinationStart + (1 - transition.destinationStart) * progress;
  const divisor = total > 0 ? total : 1;
  setAnimationWeight(transition.destination.entry.group, destinationWeight / divisor);
  for (const [source, weight] of weights) {
    setAnimationWeight(source.entry.group, weight / divisor);
  }
  if (progress < 1) return;
  for (const source of transition.sources.keys()) {
    if (!source.settled) settle(source, "interrupted", "crossfade");
  }
  if (!transition.destination.settled) {
    setAnimationWeight(transition.destination.entry.group, 1);
  }
  animator.transition = null;
}

function settle(
  record: PlaybackRecord,
  status: AnimationPlaybackResult["status"],
  reason?: unknown
): void {
  if (record.settled) return;
  record.settled = true;
  record.removeAbort();
  record.animator.activeByGroup.delete(record.entry.group);
  stopLiteAnimation(record.entry.group);
  setAnimationWeight(record.entry.group, 0);
  record.state = status === "completed" ? "completed" : "cancelled";
  const result: AnimationPlaybackResult = {
    clipId: record.handle.clipId,
    status,
    elapsed: record.elapsed,
    ...(reason === undefined ? {} : { reason })
  };
  record.resolve(result);
  emit(record.animator, {
    type: status,
    animator: record.animator,
    playback: record.handle,
    result
  });
}

function fail(record: PlaybackRecord, error: unknown): void {
  if (record.settled) return;
  record.settled = true;
  record.removeAbort();
  record.animator.activeByGroup.delete(record.entry.group);
  stopLiteAnimation(record.entry.group);
  setAnimationWeight(record.entry.group, 0);
  record.state = "failed";
  record.reject(error);
  emit(record.animator, {
    type: "failed",
    animator: record.animator,
    playback: record.handle,
    error
  });
}

function seekRecord(record: PlaybackRecord, seconds: number): void {
  const frameRate = record.entry.group.frameRate || 60;
  goToFrame(record.entry.group, seconds * frameRate);
  if (
    !record.settled &&
    record.state !== "paused" &&
    !record.animator.paused
  ) {
    playLiteAnimation(record.entry.group);
  }
}

function bindAbort(record: PlaybackRecord, signal: AbortSignal): void {
  if (signal.aborted) {
    settle(record, "cancelled", signal.reason);
    return;
  }
  const abort = (): void => settle(record, "cancelled", signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  record.removeAbort = () => signal.removeEventListener("abort", abort);
}

function dispatchCrossedMarkers(
  record: PlaybackRecord,
  previousAbsolute: number,
  currentAbsolute: number
): void {
  const markers = record.animator.markersByGroup.get(record.entry.group);
  const duration = record.entry.group.duration;
  if (!markers?.length || duration <= 0 || currentAbsolute <= previousAbsolute) return;
  const maximum = record.loop ? currentAbsolute : Math.min(currentAbsolute, duration);
  const firstLoop = Math.floor(previousAbsolute / duration);
  const lastLoop = Math.floor(maximum / duration);
  for (let loopIndex = firstLoop; loopIndex <= lastLoop; loopIndex++) {
    for (const definition of markers) {
      const time = markerTime(definition, duration);
      const absoluteMarkerTime = loopIndex * duration + time;
      if (absoluteMarkerTime <= previousAbsolute || absoluteMarkerTime > maximum) continue;
      if (definition.once && record.onceMarkers.has(definition.id)) continue;
      if (definition.once) record.onceMarkers.add(definition.id);
      dispatchMarker(record, definition, time, loopIndex);
    }
  }
}

function dispatchMarker(
  record: PlaybackRecord,
  definition: AnimationMarkerDefinition,
  time: number,
  loopIndex: number
): void {
  const event: AnimationMarkerEvent = {
    animator: record.animator,
    playback: record.handle,
    clipId: record.handle.clipId,
    markerId: definition.id,
    time,
    normalizedTime: record.entry.group.duration > 0 ? time / record.entry.group.duration : 0,
    loopIndex,
    ...(definition.metadata === undefined ? {} : { metadata: definition.metadata })
  };
  for (const subscription of [...record.animator.markerListeners]) {
    if (
      subscription.markerId === definition.id &&
      (!subscription.group || subscription.group === record.entry.group)
    ) {
      subscription.listener(event);
    }
  }
}

function addMarkerListener(
  animator: InternalAnimator,
  subscription: MarkerListenerRecord
): () => void {
  assertUsable(animator);
  animator.markerListeners.add(subscription);
  return unsubscribeFrom(animator.markerListeners, subscription);
}

function emit(animator: InternalAnimator, event: AnimatorEvent): void {
  if (animator.disposed) return;
  for (const listener of [...animator.eventListeners]) listener(event);
}

function toPlaybackSnapshot(record: PlaybackRecord): AnimationPlaybackSnapshot {
  const duration = record.entry.group.duration;
  return {
    id: record.handle.id,
    clipId: record.handle.clipId,
    sourceName: record.entry.sourceName,
    state: record.state,
    time: record.entry.group.currentTime,
    normalizedTime: duration > 0 ? record.entry.group.currentTime / duration : 0,
    elapsed: record.elapsed,
    loopIndex: record.loopIndex,
    loop: record.loop,
    speed: record.speed,
    weight: record.entry.group.weight
  };
}

function toTransitionSnapshot(
  transition: Transition | null
): AnimatorTransitionSnapshot | null {
  if (!transition) return null;
  return {
    destinationClipId: transition.destination.handle.clipId,
    duration: transition.duration,
    elapsed: transition.elapsed,
    progress: transition.duration > 0 ? transition.elapsed / transition.duration : 1,
    sources: [...transition.sources.keys()]
      .filter((record) => !record.settled)
      .map((record) => record.handle.clipId)
  };
}

function attachSceneUpdate(animator: InternalAnimator, scene: SceneContext): () => void {
  const callback = (deltaMs: number): void => {
    if (!animator.disposed) updateAnimator(animator, deltaMs / 1000);
  };
  onBeforeRender(scene, callback);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const callbacks = (scene as unknown as SceneCallbacks)._beforeRender;
    const index = callbacks.indexOf(callback);
    if (index >= 0) callbacks.splice(index, 1);
  };
}

function releaseGroups(animator: InternalAnimator, groups: readonly AnimationGroup[]): void {
  for (const group of groups) {
    try {
      stopLiteAnimation(group);
      removeAnimationGroup(animator.manager, group);
    } finally {
      if (animatorOwners.get(group) === animator) animatorOwners.delete(group);
    }
  }
}

function requireEntry(animator: InternalAnimator, id: string): ClipRegistryEntry {
  const entry = getClipRegistryEntry(animator.registry, id);
  if (!entry) {
    throw new AnimatorError("unknown-clip", `Unknown animation clip "${id}".`, { id });
  }
  return entry;
}

function dominantPlayback(
  records: readonly PlaybackRecord[]
): PlaybackRecord | undefined {
  let dominant: PlaybackRecord | undefined;
  let dominantWeight = -1;
  for (const record of records) {
    const weight = Math.max(0, record.entry.group.weight);
    if (weight > dominantWeight) {
      dominant = record;
      dominantWeight = weight;
    }
  }
  return dominant;
}

function normalizedPlaybackTime(record: PlaybackRecord): number {
  const duration = record.entry.group.duration;
  if (!(duration > 0)) return 0;
  const time = record.entry.group.currentTime;
  if (!record.loop) return Math.min(1, Math.max(0, time / duration));
  const wrapped = ((time % duration) + duration) % duration;
  return wrapped / duration;
}

function requirePlayback(playback: AnimationPlayback): PlaybackRecord {
  const record = playbackRecords.get(playback);
  if (!record) {
    throw new AnimatorError("invalid-option", "Playback is not owned by @litools/animator.");
  }
  return record;
}

function validatePlayOptions(options: PlayAnimationOptions, duration: number): void {
  if (options.startTime !== undefined && options.normalizedTime !== undefined) {
    throw new AnimatorError(
      "invalid-option",
      "startTime and normalizedTime are mutually exclusive."
    );
  }
  if (
    options.syncNormalizedTime &&
    (options.startTime !== undefined || options.normalizedTime !== undefined)
  ) {
    throw new AnimatorError(
      "invalid-option",
      "syncNormalizedTime cannot be combined with startTime or normalizedTime."
    );
  }
  if (
    options.startTime !== undefined &&
    (!Number.isFinite(options.startTime) || options.startTime < 0 || options.startTime > duration)
  ) {
    throw new AnimatorError(
      "invalid-option",
      `startTime must be between 0 and ${duration}.`
    );
  }
  if (
    options.normalizedTime !== undefined &&
    (!Number.isFinite(options.normalizedTime) ||
      options.normalizedTime < 0 ||
      options.normalizedTime > 1)
  ) {
    throw new AnimatorError(
      "invalid-option",
      "normalizedTime must be between 0 and 1."
    );
  }
  if (options.fadeIn !== undefined && (!Number.isFinite(options.fadeIn) || options.fadeIn < 0)) {
    throw new AnimatorError("invalid-option", "fadeIn must be a finite non-negative number.");
  }
  if (options.speed !== undefined) validatePositive(options.speed, "Playback speed");
}

function validateMarker(definition: AnimationMarkerDefinition, duration: number): void {
  if (!definition.id.trim()) {
    throw new AnimatorError("invalid-marker", "Animation marker IDs cannot be empty.");
  }
  const hasTime = definition.time !== undefined;
  const hasNormalized = definition.normalizedTime !== undefined;
  if (hasTime === hasNormalized) {
    throw new AnimatorError(
      "invalid-marker",
      `Marker "${definition.id}" requires exactly one of time or normalizedTime.`
    );
  }
  if (
    definition.time !== undefined &&
    (!Number.isFinite(definition.time) || definition.time < 0 || definition.time > duration)
  ) {
    throw new AnimatorError(
      "invalid-marker",
      `Marker "${definition.id}" time must be between 0 and ${duration}.`
    );
  }
  if (
    definition.normalizedTime !== undefined &&
    (!Number.isFinite(definition.normalizedTime) ||
      definition.normalizedTime < 0 ||
      definition.normalizedTime > 1)
  ) {
    throw new AnimatorError(
      "invalid-marker",
      `Marker "${definition.id}" normalizedTime must be between 0 and 1.`
    );
  }
}

function markerTime(definition: AnimationMarkerDefinition, duration: number): number {
  return definition.time ?? (definition.normalizedTime ?? 0) * duration;
}

function groupsAreCompatible(left: AnimationGroup, right: AnimationGroup): boolean {
  if (left === right) return true;
  const leftTargets = new Set(
    left.targetedAnimations
      .map((animation) => animation.target)
      .filter((target): target is object => target !== undefined)
  );
  if (
    right.targetedAnimations.some(
      (animation) => animation.target !== undefined && leftTargets.has(animation.target)
    )
  ) {
    return true;
  }
  const rightHasTargets = right.targetedAnimations.some(
    (animation) => animation.target !== undefined
  );
  if (leftTargets.size > 0 && rightHasTargets) return false;
  const leftKeys = new Set(
    left.targetedAnimations.map(
      (animation) => `${animation.nodeIndex ?? ""}:${animation.targetName ?? ""}`
    )
  );
  return right.targetedAnimations.some((animation) =>
    leftKeys.has(`${animation.nodeIndex ?? ""}:${animation.targetName ?? ""}`)
  );
}

function uniqueGroups(registry: ClipRegistry): AnimationGroup[] {
  return [...new Set(registry.entries.map((entry) => entry.group))];
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AnimatorError(
      "invalid-option",
      `${label} must be a finite positive number.`,
      { value }
    );
  }
}

function assertUsable(animator: InternalAnimator): void {
  if (animator.disposed) {
    throw new AnimatorError("disposed", `Animator "${animator.id}" has been disposed.`);
  }
}

function asAnimator(animator: Animator): InternalAnimator {
  return animator as InternalAnimator;
}

function unsubscribeFrom<T>(set: Set<T>, value: T): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    set.delete(value);
  };
}
