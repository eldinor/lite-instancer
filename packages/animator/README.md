# @litools/animator

Semantic animation playback, promises, cancellation, deterministic crossfades, and markers for Babylon Lite.

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
    idle: "Character_Idle",
    walk: "Character_Walk"
  }
});

const animator = createAnimator({
  engine,
  clips,
  update: { mode: "scene", scene },
  autoplay: "idle"
});

await playAnimation(animator, "walk", {
  interruption: "crossfade",
  fadeIn: 0.2
}).finished;
```

## Runtime contract

- One Animator exclusively owns its registered Babylon Lite `AnimationGroup` objects.
- Animator stops and zeroes every imported group during creation, removing Babylon Lite's auto-started first glTF clip before semantic autoplay or manual playback begins.
- Every Animator uses a dedicated `AnimationManager`, preventing scene and manager paths from advancing a group twice.
- Public time values are seconds. Babylon Lite manager updates are converted to milliseconds internally.
- Scene mode registers one removable before-render callback. Manual mode advances only through `updateAnimator(animator, deltaSeconds)`.
- Pausing an Animator freezes playback time, crossfade progression, elapsed time, and marker delivery.
- Completion, cancellation, and interruption resolve `playback.finished`. Unexpected runtime failures reject it.
- Looping playback remains pending until cancelled, stopped, interrupted, or disposed.
- Disposal cancels active handles, detaches groups, removes the scene callback, and suppresses later events.

The minimum supported Babylon Lite version is `1.14.0`. It includes the fix that prevents glTF animation groups owned by an `AnimationManager` from also being advanced by the scene’s legacy animation path.

## Playback

```ts
const playback = playAnimation(animator, "open", {
  loop: false,
  speed: 1,
  signal: abortController.signal
});

playback.pause();
playback.resume();
playback.setSpeed(0.5);
playback.cancel("user-cancelled");

const result = await playback.finished;
```

`startTime` and `normalizedTime` are mutually exclusive. Negative speed and reverse playback are not supported in 0.1.

Repeatedly playing an active clip returns its current handle. Pass `restart: true` to create a new request and interrupt the old handle.

## Crossfades

```ts
playAnimation(animator, "run", {
  loop: true,
  interruption: "crossfade",
  fadeIn: 0.25,
  syncNormalizedTime: true
});
```

Animator owns the transition timeline rather than delegating it to Babylon Lite’s `crossFadeAnimationGroups()` helper. Incoming clips start at zero weight, override weights remain normalized, pause freezes the transition, and a third request starts from the exact current weights.

Version 0.1 guarantees crossfades between compatible glTF groups loaded from the same asset. Linear transitions are the only supported curve.

For compatible cyclic clips such as Walk and Run, `syncNormalizedTime: true`
starts the destination at the dominant source's normalized phase. It cannot be
combined with an explicit `startTime` or `normalizedTime`.

## Markers

```ts
import {
  defineAnimationMarkers,
  marker,
  onClipMarker
} from "@litools/animator";

defineAnimationMarkers(animator, "walk", [
  marker("left-foot", { normalizedTime: 0.2 }),
  marker("right-foot", { normalizedTime: 0.7 }),
  marker("first-stride", { normalizedTime: 0.4, once: true })
]);

const unsubscribe = onClipMarker(
  animator,
  "walk",
  "left-foot",
  (event) => console.log(event.loopIndex)
);
```

All markers crossed by an update fire chronologically, including loop boundaries and large delta steps. Seeking is silent. `once` means once per playback handle. Subscriptions return idempotent cleanup functions.

## Manual updates and snapshots

```ts
const animator = createAnimator({
  engine,
  clips,
  update: { mode: "manual" }
});

updateAnimator(animator, 1 / 60);
console.log(getAnimatorSnapshot(animator));
```

Snapshots expose active clip time, normalized time, speed, loop index, weight, current transition progress, and marker counts as detached read-only data.

## Examples

Run:

```sh
npm run examples:dev --workspace @litools/animator
```

The examples reuse GLBs already established by this repository:

- **Samba Girl Playback Lab** — `HVGirl.glb`: promises, looping, cancellation, `AbortSignal`, pause, speed, seeking, snapshots, disposal, and recreation.
- **Ready Player Crossfade Lab** — `all-anim.glb`: semantic aliases, immediate replacement, idle/walk/run crossfades, rapid interruption, one-shots, cancellation, and weight inspection.
- **Unarmed Marker Lab** — the local `/public/Unarmed.glb`: manual updates, fixed stepping, GLB-calibrated walk/run footsteps, large delta crossings, impact markers, once markers, silent seek, unsubscription, and lifecycle safety.

Asset URLs and attribution follow the existing repository examples and credits.

## API documentation

Generate the TypeDoc API site without running a production build:

```sh
npm run docs --workspace @litools/animator
```

The generated site is written to `packages/animator/docs/api`. Its landing
guide covers ownership, updates, playback settlement, crossfades, markers,
snapshots, disposal, and structured errors.

## Deliberately excluded from 0.1

- reverse playback;
- queues;
- state machines and parameters;
- layers and additive transitions;
- generalized property-animation crossfades;
- graph serialization;
- Stager, Interacter, and Instancer adapters.
