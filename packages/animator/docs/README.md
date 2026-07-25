# Animator API

`@litools/animator` is a semantic playback controller for Babylon Lite animation
groups. It adds aliases, lifecycle-safe playback handles, deterministic
crossfades, markers, snapshots, and either scene-driven or manual updates.

## Quick start

```ts
import { addToScene, loadGltf } from "@babylonjs/lite";
import {
  createAnimator,
  createClipRegistry,
  playAnimation
} from "@litools/animator";

const container = await loadGltf(engine, "/character.glb");
addToScene(scene, container);

const clips = createClipRegistry(container.animationGroups ?? [], {
  aliases: {
    idle: "Idle",
    walk: "Walk",
    run: "Run"
  }
});

const animator = createAnimator({
  engine,
  clips,
  update: { mode: "scene", scene },
  autoplay: "idle"
});

const playback = playAnimation(animator, "walk", {
  loop: true,
  interruption: "crossfade",
  fadeIn: 0.25
});
```

All public times are expressed in seconds. Negative speed and reverse playback
are intentionally unsupported in version 0.1.

## Ownership and updates

An Animator exclusively owns every registered `AnimationGroup` and attaches it
to a dedicated Babylon Lite `AnimationManager`. Babylon Lite 1.14 or newer
prevents the scene's legacy glTF tick from also advancing manager-owned groups.

Scene mode installs one removable before-render callback:

```ts
const animator = createAnimator({
  engine,
  clips,
  update: { mode: "scene", scene }
});
```

Manual mode advances only when the application supplies a delta:

```ts
const animator = createAnimator({
  engine,
  clips,
  update: { mode: "manual" }
});

updateAnimator(animator, 1 / 60);
```

## Playback results

Every play request returns an `AnimationPlayback`. Its `finished` promise
resolves for completion, cancellation, and interruption:

```ts
const playback = playAnimation(animator, "jump");
const result = await playback.finished;

switch (result.status) {
  case "completed":
  case "cancelled":
  case "interrupted":
    console.log(result.status, result.elapsed);
}
```

Validation failures throw synchronously. Unexpected update failures mark the
handle as failed and reject `finished`. Looping handles remain pending until
they are stopped, cancelled, interrupted, or disposed.

## Crossfades

Crossfades are controlled by Animator rather than Babylon Lite's
`crossFadeAnimationGroups()` helper:

```ts
playAnimation(animator, "run", {
  loop: true,
  interruption: "crossfade",
  fadeIn: 0.2,
  syncNormalizedTime: true
});
```

The destination starts at zero weight. Animator updates and normalizes weights
before animation sampling, freezes transitions while paused, and begins rapid
interruptions from the current weights without snapping. Version 0.1 uses
linear fades and supports compatible glTF groups loaded from the same asset.
For cyclic locomotion, `syncNormalizedTime` carries the dominant source's
normalized phase into the destination even when the clips have different
durations.

## Markers

Markers describe semantic moments inside a clip:

```ts
defineAnimationMarkers(animator, "run", [
  marker("left-foot", { normalizedTime: 0.2 }),
  marker("right-foot", { normalizedTime: 0.7 })
]);

const unsubscribe = onClipMarker(
  animator,
  "run",
  "left-foot",
  (event) => playFootstep(event.loopIndex)
);
```

An update emits every crossed marker in chronological order, including markers
crossed by a large delta or loop boundary. Seeking is silent. A `once` marker
fires once per playback handle.

## Observability and disposal

Use `getAnimatorSnapshot()` for detached debug data containing active times,
weights, loop indices, transition progress, and marker counts.

Call `disposeAnimator()` when the controller is no longer needed. Disposal is
idempotent, cancels active handles, stops and detaches groups, removes the scene
callback, and prevents later events.

## Errors

Validation errors are instances of `AnimatorError` with a stable `code` and
structured `details`. Codes cover disposed controllers, duplicate clips,
invalid aliases, invalid markers/options, ownership conflicts, unknown clips,
and incompatible crossfades.

## Examples

- Samba Girl Playback Lab demonstrates completion, cancellation, seeking,
  speed, pause, snapshots, disposal, and recreation.
- Ready Player Crossfade Lab demonstrates locomotion crossfades, rapid
  interruption, one-shots, live weights, and camera framing.
- Unarmed Marker Lab demonstrates manual stepping, walk/run footsteps, impact
  markers, GLB-calibrated foot-contact phases, large-delta crossings, silent
  seeking, and subscription cleanup.
