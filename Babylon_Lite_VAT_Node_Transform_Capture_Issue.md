# Feature request: public VAT-frame node-transform capture

## Problem

`@babylonjs/lite` can bake a skinned mesh into a vertex-animation texture (VAT), but it does not expose the corresponding animated node transforms at the same discrete frames. Rigid attachments therefore cannot reliably follow a VAT character's hand, head, muzzle, or other rig socket.

The current instancer prototype can demonstrate the flow only by reading the private animation-controller field `_ctrl._debugWorldMat`. That is intentionally isolated in one adapter and must not become an application or library contract.

## Requested API

Extend VAT baking with an optional request to capture named or indexed rig nodes at the exact rows produced by `bakeVat()`.

```ts
const baked = bakeVat(engine, mesh, animationGroups, {
  captureNodes: ["RightHand", "Head"]
});

const handFrames = baked.nodeTransforms["Walk"]["RightHand"];
// one model-space transform per VAT frame, including the endpoint convention
```

An equivalent standalone API is also acceptable, provided it consumes the same animation groups and returns transforms aligned to a supplied `VatClip`:

```ts
captureVatNodeTransforms(engine, animationGroups, {
  clips: baked.clips,
  nodes: ["RightHand", "Head"]
});
```

## Required contract

- Capture exactly the frames and loop/endpoint convention used by `bakeVat()`.
- Return transforms in an explicitly documented model space that composes directly with a VAT instance matrix.
- Apply glTF right-handed to Lite left-handed conversion exactly once.
- Permit stable node identifiers as well as names, so duplicate names are not ambiguous.
- Keep this optional: users who only bake mesh VAT should not allocate or process node tracks.
- Return serializable data (TRS arrays or matrices); no live skeleton/controller is required at playback.

## Why it matters

This enables instanced swords, shields, muzzle flashes, particles, and hitboxes to stay synchronized with each character's independent VAT clip, phase offset, and FPS override. The tracks are baked once per rig and then sampled on the CPU without a runtime skeleton.

It also avoids relying on debug-only controller state and gives all Lite consumers one coordinate-space contract instead of separate, fragile private-field integrations.

## Acceptance criteria

1. Ready Player and `HVGirl.glb` capture a right-hand transform for each frame of several clips.
2. A rigid attachment composed as `instanceWorld * socketModel * gripOffset` remains aligned through clip changes and loop wrap.
3. Captured frame indices match VAT rows at the first, middle, final, and wrapped frames.
4. No public consumer needs `_ctrl`, `_debugWorldMat`, or another private Lite field.
5. VAT baking without capture produces no node-track data or additional persistent allocation.

## Prototype reference

The accompanying instancer implementation currently uses a private-field bridge only as a temporary feasibility adapter. It stores a versioned socket asset with a documented coordinate-space basis, samples it from the `VatInstanceSet` playback clock, and binds attachments by stable instance IDs. It can be replaced directly by this API once available.
