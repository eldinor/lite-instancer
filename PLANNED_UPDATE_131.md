# Planned Babylon Lite 1.31 Update

## Implementation status

Implemented on September 22, 2026. The root package and every workspace package now use `@babylonjs/lite` 1.31.0 with `^1.31.0` peer ranges and an exact 1.31.0 development dependency.

Because the new Lite baseline is breaking for these pre-1.0 packages, the release versions are `@litools/instancer` 0.7.0, `@litools/interacter` 0.3.0, `@litools/annotator` 0.3.0, `@litools/animator` 0.2.0, and `@litools/stager` 0.2.0. The independent Babylon.js backend remains at 0.2.0.

Completed migration work includes:

- Renaming the removed matrix APIs.
- Migrating PBR emissive materials to `setPbrEmissive`.
- Updating Annotator's guarded private text adapter to Lite 1.31's compact glyph slots, style palette, run records, and layout result.
- Adding a real Lite 1.31 hierarchy regression test for a mirrored glTF-style template root.
- Updating npm and pnpm lockfiles.
- Passing all workspace typechecks, 286 unit tests, all package builds, and all example-catalog builds.

Browser visual and performance benchmarking remains a release-time follow-up on WebGPU hardware.

## Pre-migration status

Babylon Lite `@babylonjs/lite` 1.31.0 was released on September 21, 2026. Before this migration, the repository was locked to 1.14.0 and was 17 minor releases behind.

The dependency could not be upgraded without source changes. Although the upstream releases remained within major version 1, releases 1.15 through 1.31 contained multiple explicitly documented breaking changes.

Official references:

- [npm package](https://www.npmjs.com/package/@babylonjs/lite)
- [Babylon Lite 1.31.0 release](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.31.0)
- [All Babylon Lite releases](https://github.com/BabylonJS/Babylon-Lite/releases)

## Confirmed pre-migration impact

The repository's original 1.14.0 source passed its typecheck. Checking that source against the Babylon Lite 1.31.0 declarations produced 18 TypeScript diagnostics; the migration resolved all of them.

### Renamed math exports

Babylon Lite 1.29 removed several old math names without compatibility aliases:

| Before | After |
| --- | --- |
| `mat4Compose` | `composeMat4` |
| `mat4Multiply` | `multiplyMat4` |
| `mat4Decompose` | `decomposeMat4` |

These names are used by production VAT attachment and socket code as well as several examples. Principal production files include:

- `src/vat-attachment-controller.ts`
- `src/vat-attachment-binding.ts`
- `src/vat-socket-babylon-baker.ts`

The migration is mechanical because the replacement functions retain the relevant signatures. See [Babylon Lite PR #688](https://github.com/BabylonJS/Babylon-Lite/pull/688).

### PBR emissive setup

Optional PBR features became explicit, tree-shakable operations in 1.20. `emissiveColor` is no longer a public `PbrMaterialProps` property and cannot be supplied to `createPbrMaterial`.

Code must change from property initialization:

```ts
const material = createPbrMaterial({
  emissiveColor: [1, 0, 0]
});
```

to explicit opt-in setup:

```ts
const material = createPbrMaterial();
setPbrEmissive(material, [1, 0, 0]);
```

Four current example sites fail the 1.31 declaration check:

- `examples/glb-vat-socket-configurator/src/main.ts`
- `examples/massive-avatar-arena/src/main.ts` (two sites)
- `examples/unarmed-vat-arena/src/main.ts`

See [Babylon Lite PR #543](https://github.com/BabylonJS/Babylon-Lite/pull/543).

### Hierarchy-instance matrix semantics

Babylon Lite 1.17 changed `addHierarchyInstance` and `setHierarchyInstanceMatrix` behavior. Instance matrices now compose with the template hierarchy instead of replacing the template root's world matrix.

This affects `src/hierarchy-instance-set.ts`, especially glTF templates whose root contains the right-handed-to-left-handed conversion. The new behavior fixes the previous need to compensate for a glTF root's negative-X scale and is likely preferable, but it changes rendered transforms without producing a type error.

The hierarchy-instance examples and tests need visual or matrix-level regression coverage before the upgrade is accepted. See [Babylon Lite PR #525](https://github.com/BabylonJS/Babylon-Lite/pull/525).

### Annotator private text bridge

`packages/annotator/src/textrender-private.ts` is explicitly coupled to Babylon Lite 1.14 internals.

By 1.31:

- The private `layoutText` result uses underscored fields such as `_glyphs`, `_width`, `_height`, and `_pixelsPerFontUnit`.
- Text run records and draw-group fields have been renamed to underscored internal fields.
- Text GPU instances are compacted from the 1.14 layout assumed by the bridge; the existing 20-float slot patching logic is no longer compatible.

The current guards should reject these structures and fall back to the public path, preserving correctness. However, private shaping and the in-place patch/translation fast paths will be disabled, which may cause a performance regression. This path must either be updated specifically for 1.31 or deliberately retired before claiming 1.31 support.

## Other breaking changes since 1.14

- **1.15:** Package subpath exports were removed. Public APIs must be imported from `@babylonjs/lite`. This repository already uses root imports for supported APIs, though Annotator intentionally bypasses the export map for its private bridge. [PR #447](https://github.com/BabylonJS/Babylon-Lite/pull/447)
- **1.16:** The Node Particle Editor runtime and package-root particle API were replaced by the canonical typed-array API.
- **1.17:** Dirty-tracked scene-node properties became readonly proxy objects. Callers must mutate them, such as with `.set(...)`, rather than replace them.
- **1.18:** Cascaded shadow-map caching and rendering-update behavior became explicit opt-ins.
- **1.20:** Optional PBR features moved from direct properties to setter functions.
- **1.22:** Optional `StandardMaterial` texture properties moved to setter functions. [PR #554](https://github.com/BabylonJS/Babylon-Lite/pull/554)
- **1.23:** `SceneContext.envRotationY` was removed in favor of `setEnvironmentRotation`. [PR #577](https://github.com/BabylonJS/Babylon-Lite/pull/577)
- **1.25:** Havok query/trigger APIs and moving particle-emitter APIs changed.
- **1.27:** Public physics and flow-graph `const enum` declarations became const-object values with matching union types. Reverse enum lookup is no longer supported. [PR #665](https://github.com/BabylonJS/Babylon-Lite/pull/665)
- **1.29:** Public math exports were renamed without aliases.
- **1.30:** Lights became full `SceneNode`s. Custom structural implementations of `LightBase` must now provide the standard scene-node transform and hierarchy fields. [PR #718](https://github.com/BabylonJS/Babylon-Lite/pull/718)
- **1.31:** Render-resource lifetimes became explicit. `RenderTask.addMesh` was replaced by `addMeshToTask`; surface-sized render targets use `createSurfaceRenderTargetTexture`; sampled depth must be requested explicitly; and some render tasks require explicit mesh-refresh enablement. [PR #728](https://github.com/BabylonJS/Babylon-Lite/pull/728)

Most breaking changes outside math, PBR emissive setup, hierarchy instancing, and private text integration do not currently intersect the repository's main code paths. They should nevertheless be checked during the full upgrade because examples and optional packages cover a broader surface than the core library.

## The most relevant new capabilities

The following additions are the most useful to this repository and its Instancer, Interacter, Animator, and Annotator packages:

- **Offline VAT preparation and GPU idle waiting (1.22):** potentially useful for moving VAT preprocessing out of interactive startup and for synchronizing asset preparation with GPU work.
- **GPU picking for skinned and morphed vertices (1.23):** relevant to Interacter's detailed picking and animated-character workflows.
- **Text shaping and compact GPU-instance improvements (1.25):** particularly relevant to Annotator. These upstream improvements may replace some reasons for maintaining the private 1.14 text bridge, but require new performance measurements.
- **Sprite2D view utilities and renderer-native Y sorting (1.25):** useful for GPU markers and screen-facing annotation components.
- **Inspector Lite introspection APIs (1.27) and Playground Inspector support (1.30):** potentially useful for the existing Explorer integration and debugging stable instances.
- **World-to-screen projection (1.29):** may replace or simplify parts of Annotator's projection implementation.
- **Partial geometry uploads (1.29):** potentially useful for dynamic geometry and reducing upload costs.
- **Shared instance-world WGSL (1.29):** relevant to custom instancing and outline shaders.
- **Configurable camera pointer mappings and arc-rotate keyboard controls (1.29):** useful for examples and interactive tooling.
- **Havok thin-instance bodies (1.29):** relevant if stable Instancer IDs are extended to physics-backed crowds.
- **Targeted render-frame surfaces (1.30):** useful for tools or previews that render to auxiliary surfaces.
- **Frame-graph compute shaders (1.31):** creates a path for compute-driven instance updates, culling, preprocessing, and simulation.
- **Storage-backed geometry for compute integration (1.31):** relevant to future GPU-driven instance and annotation workflows.
- **Scaled surface render targets (1.31):** useful for lower-cost auxiliary, picking, post-process, or diagnostic passes.
- **Mesh blending APIs (1.31):** potentially useful for animation and mesh-transition workflows.
- **KTX2 texture arrays (1.31):** useful for layered or array-backed texture workflows.
- **Explicit material-view GPU lifetime controls (1.31):** relevant to long-lived dynamic scenes and device-resource management.

## Dependency-range risk

The current package manifests use peer ranges such as `^1.13.0` and `^1.14.0`, while development dependencies remain pinned to 1.14.0. Those peer ranges admit 1.31.0 even though the current source does not compile against it.

This creates a consumer risk: local development and CI continue testing 1.14.0, while downstream package resolution may select a breaking newer Lite release.

Before publishing another release, either:

1. Narrow the peer range to the versions actually supported and tested, or
2. Complete the 1.31 migration and test both the minimum supported version and 1.31.0.

## Proposed migration sequence

1. Temporarily narrow the Babylon Lite peer ranges so unsupported minor versions are not advertised.
2. Rename the removed math imports and usages.
3. Migrate PBR emissive options to `setPbrEmissive`.
4. Add matrix and browser-level regression tests for glTF hierarchy instances under the new composition semantics.
5. Decide whether to update or remove Annotator's guarded private 1.14 bridge.
6. Update the development dependency and lockfiles to 1.31.0.
7. Run all workspace typechecks and unit tests.
8. Build the root package, every workspace package, and all example catalogs.
9. Run browser validation for hierarchy instances, VAT characters and attachments, detailed picking, outlines, GPU text, and annotation benchmarks.
10. Measure bundle size and Annotator text performance before accepting the migration.

## Acceptance criteria

- All workspace typechecks pass against Babylon Lite 1.31.0.
- All unit and browser tests pass.
- glTF hierarchy instances retain the intended handedness, placement, scale, and winding.
- VAT socket attachments retain correct world transforms.
- PBR emissive examples render as before.
- Annotator public shaping remains correct, and any retained private path is explicitly version-compatible.
- Text shaping, patching, and translation performance is measured and documented.
- Package peer ranges match the versions actually validated.
- All example and documentation imports use supported public APIs, except any private dependency that is clearly isolated and version-guarded.
