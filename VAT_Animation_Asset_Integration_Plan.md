# VAT Animation Asset Integration Plan

## Status

Architecture and implementation plan only. No runtime API is committed by this document.

## Goal

Add baked VAT socket sampling and instanced attachments to `@litools/instancer` without turning the existing instance pool into a monolithic animation framework.

The first deliverable must:

- keep a weapon synchronized with each VAT character's clip, phase offset, and FPS override;
- work with stable `InstanceId` values even when backing slots move;
- evaluate no skeleton at runtime;
- support CPU-side attachment transforms for hundreds of visible instances;
- add no socket, attachment, or baker code to applications that only import the core instancer;
- leave room for root motion, events, bounds, and custom tracks without pretending that they all have identical runtime semantics.

## Main architectural decision

Treat this as three composable features, not one enlarged `createVatInstanceSet()`:

```text
Animation timeline data
        |
        +-- VAT rendering adapter      existing VatInstanceSet
        |
        +-- Socket sampler             pure timeline/TRS sampling
        |
        +-- Attachment controller      InstanceId -> weapon InstanceId
```

The VAT instance set owns playback state. Socket tracks consume that state. An optional attachment controller composes character, socket, and grip transforms into a separate weapon instance set.

Do not add a large `bakeAnimationAsset(..., { vat, sockets, rootMotion, events })` implementation to the core module. That shape makes every future feature depend on one entry point and makes optional behavior harder to tree-shake, test, and evolve.

## What belongs where

### Babylon Lite

Babylon Lite owns animation evaluation, skeleton internals, coordinate conversion, and VAT baking. It should provide a public way to capture selected animated node transforms at the exact frames used by `bakeVat()`.

The working examples currently read `_ctrl._debugWorldMat`. That is useful for experiments but must not become a published `@litools/instancer` dependency. The production implementation needs one of these public Babylon Lite contracts:

1. preferred: extend VAT baking with an optional node-transform capture hook/result;
2. acceptable: expose public animation evaluation and node-world-matrix accessors;
3. fallback for an initial prototype only: isolate private access in one adapter and pin it with compatibility tests.

### Animation data module

This module owns serializable clip metadata and transform tracks. It should not create GPU resources or import Babylon Lite runtime functions.

### Instancer VAT module

`VatInstanceSet` continues to own stable character IDs, per-ID clip overrides, phase offsets, FPS overrides, visibility, and the shared playback clock.

### Optional attachment module

This module binds stable character IDs to stable IDs in a separate weapon `InstanceSet`. It samples a socket and writes weapon matrices. It must not own weapon selection, inventory, or gameplay rules.

## Data model

Store decomposed transforms, not matrices. Matrix interpolation would be incorrect, while decomposing matrices for every socket and character on every frame would waste CPU.

```ts
export interface AnimationClipTimeline {
  readonly name: string;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
}

export interface TransformTrack {
  /** XYZ, frameCount * 3 floats. */
  readonly translations: Float32Array;
  /** XYZW, frameCount * 4 floats. */
  readonly rotations: Float32Array;
  /** Optional XYZ scale. Omit for unit-scale sockets. */
  readonly scales?: Float32Array;
}

export interface VatSocketAsset {
  readonly version: 1;
  readonly clips: Readonly<Record<string, AnimationClipTimeline>>;
  readonly sockets: Readonly<
    Record<string, Readonly<Record<string, TransformTrack>>>
  >;
}
```

The clip metadata must be derived from the same frame calculation as the VAT bake. Socket tracks are rig-level data and must be baked once, not once per mesh primitive. This matters for assets such as `HVGirl.glb`, which has eleven skinned primitives sharing one rig.

Use translation lerp, shortest-path quaternion slerp, and scale lerp. Sampling APIs must accept caller-owned output buffers so the per-frame path can be allocation-free.

## Coordinate-space contract

The phrase "character root" is too ambiguous for a public format. The baker must name and document the exact model-space root used for attachments.

For every captured frame:

```text
socketModel = inverse(modelPlacementWorld) * socketWorld
weaponWorld = characterInstanceWorld * socketModel * gripOffset
```

`modelPlacementWorld` must include the loader's glTF right-handed to Babylon Lite left-handed conversion and authored model-root transforms in exactly the same way as the VAT-rendered mesh. Consumers must not apply a second handedness conversion. The temporary implementation stores glTF-right-handed TRS tracks plus an explicit RH-to-LH basis matrix because a reflection cannot be faithfully represented as quaternion plus positive scale.

The asset should record a coordinate-space/version tag so incompatible baking changes fail clearly instead of producing subtly mirrored attachments.

## Playback contract

The current `VatInstanceSet` already stores the necessary state privately:

- active shared clip;
- optional per-ID clip override;
- phase offset in seconds;
- optional FPS override;
- VAT handle time advanced by `update(deltaSeconds)`.

Socket sampling cannot remain synchronized while the VAT handle clock is opaque. Refactor `VatInstanceSet` to own the elapsed time explicitly and expose a read-only, allocation-free playback query.

Proposed API:

```ts
export interface VatPlaybackSample {
  clip: string;
  timeSeconds: number;
  offsetSeconds: number;
  fps: number;
  frame: number;
  nextFrame: number;
  alpha: number;
}

vat.getPlaybackSample(id, out): VatPlaybackSample | undefined;
vat.get timeSeconds(): number;
```

One pure frame-selection function must drive both socket sampling tests and the parameters uploaded for VAT rendering. It must define:

- whether phase is measured in seconds (recommended, matching the current API);
- looping at the duplicated final VAT frame;
- negative time or playback rates, if supported;
- FPS overrides;
- clip switching behavior;
- pause and time scaling behavior.

Do not maintain a second independent socket clock.

## Proposed public API

Keep baking, sampling, and attachment synchronization separate.

```ts
// Optional bake-time adapter. Uses the public Babylon Lite capture contract.
const sockets = bakeVatSocketAsset(engine, animationGroups, {
  root: "Idle", // explicit model-space root/node
  sockets: {
    sword: "mixamorig:RightHand",
    head: "mixamorig:Head"
  },
  clips: warriors.clips
});

// Low-level sampling for gameplay, particles, or custom attachment logic.
sampleVatSocket(sockets, playbackSample, "sword", outTransform);

// Optional convenience controller for instanced rigid attachments.
const swords = createVatAttachmentController({
  characters: warriors,
  attachments: swordInstances,
  socketAsset: sockets,
  socket: "sword"
});

swords.bind(characterId, swordId, { gripOffset });
swords.unbind(characterId);
swords.update();
```

The controller uses `InstanceId`, never backing slots, as its durable key. Each update resolves current character and weapon slots through their sets, so removal swaps, active-count visibility changes, and capacity growth remain safe.

The controller should iterate only bound, visible characters and batch all weapon matrix writes. It should reuse scratch matrices/transforms and perform no per-character allocation.

## Multi-part characters

Socket data belongs to a rig, but the current `createVatInstanceSet()` represents one mesh. The first socket implementation can use one canonical VAT set as the playback/ID owner while applications mirror its transforms to the other mesh-part sets, as the existing examples do.

Do not duplicate socket tracks for each primitive.

A later, separate feature can introduce a `VatCharacterSet`/`VatRigInstanceSet` that coordinates multiple VAT mesh parts under one stable character ID. This is useful for HVGirl-style assets but is not required to prove socket sampling.

## Tree-shakable packaging plan

### Module boundaries

Use separate source modules with no top-level registration or side effects:

```text
src/instance-set.ts                 core pooling
src/vat-instance-set.ts             VAT rendering/playback
src/animation-timeline.ts            pure frame/TRS sampling
src/vat-socket-asset.ts              socket data and sampler
src/vat-socket-babylon-baker.ts      optional Babylon Lite baker adapter
src/vat-attachment-controller.ts     optional instancer integration
```

The core and VAT modules must not import the socket baker or attachment controller. Dependency arrows only point from optional modules toward lower-level modules.

### Package entry points

Add explicit subpath exports so consumers can guarantee the dependency boundary:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core.js",
    "./vat": "./dist/vat.js",
    "./animation": "./dist/animation.js",
    "./vat-sockets": "./dist/vat-sockets.js"
  },
  "sideEffects": false
}
```

The root barrel must continue to re-export all existing APIs and may also re-export the new socket APIs. Existing consumer imports must remain valid:

```ts
import {
  createInstanceSet,
  createVatInstanceSet,
  bakeVatSocketAsset,
  sampleVatSocket,
  createVatAttachmentController
} from "@litools/instancer";
```

This backward-compatible root import is a required public surface, not a temporary alias. Documentation should still recommend subpath imports when consumers want explicit feature and bundle boundaries.

The current Vite library build produces one bundled `dist/index.js`. Change it to multiple ESM entries with shared chunks, or emit preserved ESM modules. `sideEffects: false` alone is not a sufficient acceptance test.

### Tree-shaking acceptance fixtures

Add small production-build fixtures and inspect their bundler metafiles/output:

1. `import { createInstanceSet } from "@litools/instancer/core"` contains no VAT, socket, animation-evaluation, or attachment-controller code.
2. `import { createVatInstanceSet } from "@litools/instancer/vat"` contains no socket baker or attachment controller.
3. Importing only `sampleVatSocket` does not include the Babylon Lite bake adapter.
4. Importing the attachment controller includes sampling and instance-set code, but not root motion, events, or future channel modules.
5. Every package entry remains free of import-time GPU or shader registration.
6. Existing root imports compile and run unchanged against the packed package.

Record bundle sizes in the fixture tests to catch accidental dependency regressions.

## Phased implementation

### Phase 0: contracts and feasibility spike

- Confirm a public Babylon Lite API for capturing selected node TRS at VAT frames.
- Define the model-space root and handedness contract using both Xbot and HVGirl.
- Write golden frame tests comparing a baked right-hand socket against the live skeleton at several frames per clip.
- Confirm the exact VAT shader frame/loop formula, including the duplicated endpoint frame.

Exit criterion: no published code reads `_ctrl` or `_debugWorldMat`, and socket matrices match the live rig within a documented tolerance. **Temporary implementation exception approved:** `vat-socket-babylon-baker.ts` isolates this private access until a Lite-team public API exists.

### Phase 1: playback state extraction

- Make `VatInstanceSet` own `timeSeconds` while continuing to advance `VatHandle`.
- Add the pure playback/frame calculation.
- Add `getPlaybackSample(id, out)` and tests for shared clips, overrides, offsets, FPS overrides, loop boundaries, removal swaps, and visibility slot changes.
- Preserve the existing `VatInstanceSet` API behavior.

Exit criterion: a test can predict the exact VAT row for any stable character ID without accessing Babylon Lite internals.

### Phase 2: socket asset and sampler

- Add versioned clip and TRS track types.
- Implement allocation-free exact-frame and interpolated sampling.
- Validate array lengths, finite values, normalized quaternions, clip compatibility, and missing sockets.
- Add serialization-friendly tests; GPU objects must not appear in the socket asset.

Exit criterion: pure unit tests sample known poses correctly without creating an engine.

### Phase 3: Babylon Lite bake adapter

- Capture requested node transforms once per rig and clip.
- Convert every pose into the declared model space.
- Reuse VAT clip FPS/frame counts rather than recomputing an independent timeline.
- Bake socket data once for multi-primitive rigs.
- Add Xbot and HVGirl golden comparisons.

Exit criterion: all sampled clips remain aligned with VAT at the first, middle, last, and loop-wrap frames.

### Phase 4: attachment controller

- Bind character `InstanceId` to attachment `InstanceId` with an optional grip offset.
- Batch weapon matrix updates.
- Handle character/weapon removal, hidden instances, clip changes, phase changes, and slot swaps.
- Define whether hidden characters hide attachments automatically (recommended default: yes, configurable).
- Add performance tests for 100, 500, and 1,000 bindings and assert zero steady-state allocations.

Exit criterion: attachment transforms remain correct after arbitrary instance removals and visibility changes.

### Phase 5: packaging and tree-shaking

- Add multi-entry/preserved-module ESM output and subpath exports.
- Keep type declarations aligned with every export path.
- Add the bundle fixtures described above.
- Verify Node ESM and Vite consumption from the packed npm tarball, not only from source aliases.

Exit criterion: core-only and VAT-only fixtures contain none of the optional socket implementation.

### Phase 6: examples and documentation

- Refactor Xbot sword sync to use baked socket tracks and the attachment controller.
- Refactor Samba Girl to prove multi-primitive reuse and clip switching.
- Add one per-instance phase/FPS example to prove attachments do not drift.
- Document coordinate space, grip offsets, stable-ID binding, memory cost, and the tree-shakable import paths.

Exit criterion: examples no longer keep a hidden runtime skeleton or read private animation controller fields.

## Explicitly deferred work

Do not include these in the first socket release:

- root-motion integration;
- event crossing and dispatch;
- per-frame animated bounds;
- arbitrary scalar channels;
- GPU socket sampling;
- GPU-driven attachment transforms;
- a multi-mesh `VatRigInstanceSet` abstraction.

They can share clip metadata and the playback clock later, but each needs its own semantics. In particular, events require interval-crossing logic across loops, and root motion requires stateful delta accumulation; neither is just another instantaneous socket sample.

## Risks and mitigations

### Private Babylon Lite animation state

Risk: the examples prove the concept through debug fields that may change.

Mitigation: make the public capture API a Phase 0 gate.

### Coordinate-space ambiguity

Risk: glTF conversion, authored root scale, or a second mirror produces displaced or reversed weapons.

Mitigation: version the space contract and use Xbot plus HVGirl golden tests.

### CPU cost

Risk: decomposing matrices and allocating objects for every binding every frame scales poorly.

Mitigation: store TRS, use caller-owned outputs, batch writes, and benchmark steady-state allocations.

### Multi-part duplication

Risk: eleven mesh primitives lead to eleven copies of identical socket data.

Mitigation: make socket assets rig-level and reusable across VAT mesh parts.

### False tree-shaking confidence

Risk: `sideEffects: false` is present, but one bundled entry or accidental imports still retain optional code.

Mitigation: explicit subpaths plus production bundle fixture tests.

## Recommended first implementation slice

The smallest valuable vertical slice is:

1. public Babylon Lite node-transform capture at VAT frames;
2. `VatInstanceSet.timeSeconds` and `getPlaybackSample()`;
3. versioned TRS socket tracks and `sampleVatSocket()`;
4. a stable-ID attachment controller;
5. one Xbot example, one multi-part HVGirl example;
6. subpath exports and bundle fixtures.

This delivers the sword/shield/particle attachment foundation described in the proposals while keeping the existing instancer small, composable, and genuinely tree-shakable.
