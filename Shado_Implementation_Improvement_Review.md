# Shado Implementation Improvement Review

Research date: 2026-07-21  
Reviewed package: [`@knervous/shado` 1.0.5](https://www.npmjs.com/package/@knervous/shado)  
Additional context: [Babylon.js forum announcement](https://forum.babylonjs.com/t/shado-50k-instances-auto-vat-full-custom-properties-dynamic-webassembly/63830)

## Executive Summary

Shado is technically strong, but there are several concrete ways to improve it. The highest-value change is not another VAT or WASM feature: it is separating compact visibility output from the large actor AoS buffer.

The forum announcement clarifies the intended model: approximately 50–100k live entities, a smaller rendered subset, custom GPU properties, VAT, and optional WASM reducers. The demonstrated scene reports approximately 51k live instances, 11k rendered instances, 60 FPS, and about 2 ms for the WASM culling scan.

The package's next stage should emphasize hardening and simplification:

- Upload less data after culling.
- Make unsupported paths fail clearly.
- Stabilize Babylon.js integration boundaries.
- Make identity safe outside the packed array.
- Reduce VAT worker startup and peak memory.
- Make releases and benchmarks reproducible.

Relevant upstream sources:

- [Shado package on npm](https://www.npmjs.com/package/@knervous/shado)
- [Shado repository directory](https://github.com/knervous/eqrequiem/tree/main/shader-object)
- [Shado source tree](https://github.com/knervous/eqrequiem/tree/main/shader-object/src)
- [ShadoMaterial implementation](https://github.com/knervous/eqrequiem/blob/main/shader-object/src/materials/ShadoMaterial.ts)
- [ShadoInstanceContainer implementation](https://github.com/knervous/eqrequiem/blob/main/shader-object/src/extensions/ShadoInstanceContainer/ShadoInstanceContainer.ts)
- [VAT worker implementation](https://github.com/knervous/eqrequiem/blob/main/shader-object/src/extensions/VATBuilder/VATWorker.ts)
- [Headless VAT baking implementation](https://github.com/knervous/eqrequiem/blob/main/shader-object/src/extensions/VATBuilder/VATHeadlessBake.ts)

## Highest-Priority Improvements

### 1. Stop Culling from Dirtying the Entire Actor Arena

The current culler writes:

- `visibleFlag` into every actor.
- `visibleIndex` into the first N actor records.
- `visibleCount` into the container.
- Then calls `_arena.markDirty()`.

Because these fields are interleaved throughout the actor AoS, dirty-page tracking cannot help much. For the showcase's reported 192-byte actor stride, 50k actors represent approximately 9.6 MB of arena data potentially marked for upload after every culling pass. The data-texture backend uploads its entire staging texture whenever anything changes.

The compact result should instead be a separate stream:

```ts
visibleActorIndices: Uint32Array;
visibleCount: number;
visibleFlags?: Uint32Array; // Optional bitset for CPU queries.
```

The shader would become conceptually:

```glsl
int sourceIndex = visibleActorIndices[gl_InstanceID];
Actor actor = actors[sourceIndex];
```

At 11k visible actors, the principal culling output becomes approximately 44 KB rather than touching a multi-megabyte actor arena. Static actor properties remain clean.

This separation also creates clearer ownership:

- Actor arena: durable actor state.
- Visible-index stream: frame-local draw indirection.
- Optional visibility bitset: CPU inspection and picking.
- Visible count: draw submission count.

This is likely the single largest improvement to the actual 50k-instance design.

### 2. Implement or Explicitly Reject WebGPU Storage Rendering

`ShadoMaterial` selects WGSL when WebGPU uses the storage backend. However, `ShadoInstanceContainer.generateWGSLPair()` currently returns literal placeholder strings:

```ts
return { vs: "moduleSource", fs: "moduleSource" };
```

Until real WGSL generation exists, initialization should fail immediately with a descriptive capability error:

```ts
await ShadoInstanceContainer.initialize(engine, {
  backend: "storage"
});

// UnsupportedBackendError:
// Actor storage rendering is not implemented for WebGPU.
```

That is safer than accepting a documented backend and failing later during shader compilation. A real-browser WebGPU storage test should accompany the eventual implementation.

### 3. Isolate Babylon.js Private API Usage

`ShadoMaterial` overrides `mesh.render` and uses Babylon.js internals including `_getDrawWrapper`, `_preBind`, `_currentEffect`, `_bind`, and `_draw`.

This may be necessary for Shado's custom instanced draw, but it is the largest compatibility risk across Babylon.js releases. It also introduces lifecycle hazards:

- Multiple wrappers attached to the same mesh are not safely composable.
- Disposal order can restore the wrong `mesh.render` function.
- Another library changing `mesh.render` can be silently overwritten.
- A Babylon.js minor release can change an internal draw contract.

All private access should live behind one adapter:

```ts
interface ShadoBabylonRenderAdapter {
  attach(mesh: Mesh, renderer: ShadoRenderer): ShadoRenderAttachment;
  supports(engine: AbstractEngine): ShadoRenderCapabilities;
}
```

Use a `WeakMap<Mesh, RenderInterception>` so there is exactly one managed interception per mesh. Disposal should restore the previous render function only when the mesh still contains Shado's own wrapper.

The adapter should also:

- Perform runtime capability checks.
- Report the detected Babylon.js version.
- Centralize internal property names.
- Provide descriptive errors when a required internal is absent.
- Have compatibility tests against the minimum and current supported Babylon.js releases.

### 4. Make Class Initialization Engine- and Configuration-Specific

`Shado.initialize()` stores schema, backend preference, WASM mode, and related state statically on the constructor. Initializing one actor class for different engines or configurations can therefore overwrite class-global state.

Replace this with an engine/configuration runtime registry:

```ts
const classRuntimeByEngine = new WeakMap<
  AbstractEngine,
  Map<string, ShadoClassRuntime>
>();
```

The map key should incorporate a deterministic runtime configuration hash covering:

- Backend.
- Schema and additional fields.
- WASM mode and kernel identity.
- Shader strategy.
- Relevant engine capabilities.

Each Shado instance should retain the runtime selected during construction. This safely supports:

- Simultaneous WebGL and WebGPU engines.
- Data-texture and storage configurations.
- Different schema extensions.
- Test engines alongside a real engine.

At minimum, incompatible repeated initialization should throw instead of silently mutating class-global configuration.

### 5. Clean Up Generated Shader-Store Entries

Shader names contain an ever-increasing instance ID and are inserted into Babylon's global shader stores. Disposal frees arena and GPU resources, but generated shader entries do not appear to be removed.

Pool churn in editors, previews, tests, and hot reload can therefore accumulate shader source indefinitely.

Recommended changes:

- Derive shader names from a schema and configuration hash when the generated source is identical.
- Reference-count shader registrations.
- Delete generated shaders when their final user is disposed.
- Include schema hashes in include names to prevent same-name/different-layout collisions.
- Expose shader-cache counts in diagnostic builds.

## VAT Pipeline Improvements

### Reuse Headless Workers

`bakeVatWithHeadlessWorker()` creates and terminates a worker for each model. A roster containing many models repeatedly initializes Babylon.js, GLB loaders, WASM kernels, and `NullEngine`.

A reusable worker pool would be more efficient:

```ts
const pool = createVatBakeWorkerPool({
  concurrency: 3
});

const packed = await pool.bake(model, {
  signal,
  onProgress
});
```

It should support:

- Persistent workers.
- Queueing and configurable concurrency.
- `AbortSignal` cancellation.
- Timeout and `messageerror` handling.
- Worker replacement after failure.
- Progress events by clip and frame.
- Explicit disposal.

### Cache Kernels and Compiled Modules

`selectVatKernel()` decodes base64 and validates candidate kernels when packing is requested. Cache:

- Decoded bytes by kernel flavor.
- Selected flavor by runtime capabilities.
- Compiled `WebAssembly.Module` objects.
- SIMD and relaxed-SIMD detection results.

This is particularly useful when baking multiple models independently.

### Reduce Peak Packing Memory

VAT packing can simultaneously hold:

1. Input matrices.
2. WASM packed DQ output.
3. A reordered float32 atlas.
4. A float16 atlas.

For large animation libraries, temporary memory can greatly exceed the final artifact.

The WASM kernel should write directly into final atlas order and optionally emit float16 directly. That removes one or two full-size intermediate buffers. If direct float16 output is not desirable, process the atlas in bounded chunks rather than creating both complete float32 and float16 results.

### Add Hostile-Input Limits

The Playground supports dropped GLBs, so worker isolation is not sufficient protection against memory exhaustion.

Add configurable limits:

```ts
interface VatBakeLimits {
  maxModelBytes: number;
  maxBones: number;
  maxFramesPerClip: number;
  maxTotalFrames: number;
  maxAtlasBytes: number;
  maxAnimations: number;
  timeoutMs: number;
}
```

Validate all allocation arithmetic before constructing typed arrays. Failure messages should identify the exceeded limit and the requested allocation.

## Correctness and API Improvements

### Fix Direct CPU Culling

`frustumCull()` refreshes cached planes before falling back to CPU culling, but public `frustumCullCPU()` does not refresh the planes itself. Calling `frustumCullCPU()` directly can therefore use zero or stale planes.

Plane extraction should be shared internally and invoked by both methods:

```ts
private updateFrustumPlanes(camera: Camera): readonly Plane[];
```

The cached 24-float plane array should also be reused rather than allocated every frame.

### Add Stable or Generational Actor Handles

Removal uses swap compaction and public picking returns a current array index. This is fragile for networking, UI state, deferred commands, and the MMO-style use cases described in the forum announcement.

A generational handle could look like:

```ts
interface ShadoActorHandle {
  index: number;
  generation: number;
}
```

Another option is a stable numeric ID with an ID-to-slot mapping. Raw indices can remain available for shader and WASM hot paths.

Removed actor wrappers should be invalidated so stale references cannot silently mutate reused arena memory. Useful APIs include:

```ts
container.has(handle);
container.get(handle);
container.getSlot(handle);
container.remove(handle);
```

### Reuse Visibility Output for Picking

Picking scans the complete live actor collection even when culling has already produced a much smaller visible set.

Normal picking should iterate the compact visible-index stream. An `includeInvisible` option can retain the full scan when explicitly requested. For very large visible sets, optional spatial buckets or a BVH can reduce the remaining work.

### Support Per-Actor or Per-Clip Bounds

Culling currently accepts one `baseRadius`, scaled by each actor. Mixed models and energetic VAT clips require bounds derived from actual geometry and animation.

Recommended bound precedence:

1. Explicit per-actor override.
2. Per-clip baked bound.
3. Per-model bound.
4. Pool-wide fallback radius.

The VAT preprocessing artifact should contain conservative clip bounds so runtime culling does not need to inspect animated vertices.

### Improve Initialization Errors

`Shado.initialize()` catches errors, logs them, and returns `false`. This can hide the original failure and encourages consumers to continue with a partially configured type.

Prefer a throwing default:

```ts
await ActorPool.initialize(engine, config);
```

If a boolean path is useful, make it explicit:

```ts
const result = await ActorPool.tryInitialize(engine, config);

if (!result.ok) {
  console.error(result.error);
}
```

Structured error categories should distinguish unsupported capabilities, shader generation, WASM compilation, schema validation, and resource allocation.

## Data-Texture Backend

Dirty-page tracking reduces CPU-side encoding, but the data-texture backend still uploads its entire staging texture when any range changes. This is an important limitation for large WebGL pools.

Possible improvements:

- Keep the compact visible-index stream in a separate small texture.
- Partition mostly static actor data from frequently changing frame data.
- Investigate row-aligned texture sub-updates through a narrowly isolated Babylon.js adapter.
- Select texture width based on expected update locality rather than a fixed width alone.
- Expose upload statistics prominently so applications can detect full-texture updates.

Even without portable texture sub-updates, separating hot and cold data prevents a small visibility change from forcing upload of every actor property.

## Packaging and Release Quality

The npm registry reports 1.0.5, while the public repository's `package.json`, exported `VERSION`, and parts of its README still identify 1.0.3 or the former unscoped `shado` package. This makes the published release difficult to reproduce and review precisely.

Recommended release checks:

```json
{
  "prepublishOnly": "npm run typecheck && npm run lint && npm test && npm run test:browser && npm run build && npm run pack:check"
}
```

The exact browser-test command and runner can remain an implementation choice.

Also publish:

- Version tags.
- GitHub releases.
- The exact release commit.
- Package provenance where supported.
- A changelog entry for every published version.

### Split the Root Entry Point

The root entry point re-exports Babylon core, rendering, showcases, and utilities. It also makes showcase-oriented dependencies part of the production package surface.

Prefer explicit boundaries:

```text
@knervous/shado/core
@knervous/shado/babylon
@knervous/shado/vat
@knervous/shado/render
@knervous/shado/net
@knervous/shado/showcase
```

`@knervous/shado/core` should contain engine-neutral schema, arena, dirty tracking, layouts, and codecs without importing the full Babylon.js namespace.

Showcase-only dependencies such as fantasy-name generation should move to the showcase subpath, a separate package, or development dependencies.

The existing root can remain as a compatibility facade during a deprecation period.

## Testing and Benchmark Credibility

The existing non-browser tests cover layouts, dirty tracking, DQ math, reducers, schema inheritance, and memory synchronization reasonably well. Keep strengthening these tests around the proposed changes, especially:

- Dirty-range generation when culling changes visibility.
- Partial arena uploads and exact upload-byte accounting.
- Storage-backend capability selection and failure behavior.
- Multiple pools using different engines or configurations.
- Attach, dispose, and reattach lifecycle behavior.
- Shader-store cleanup after repeated pool creation and disposal.
- VAT worker scheduling, cancellation, cache reuse, and hostile-input limits.
- Stable actor-handle generation and stale-handle rejection.

### Reproducible Performance Benchmarks

The forum's 51k-live, 11k-visible, 60-FPS result is impressive, but it should become a reproducible benchmark rather than a screenshot claim.

Every published benchmark should record:

- Hardware, browser, operating system, and graphics backend.
- Live and visible actor counts.
- Vertices and triangles per actor.
- CPU culling p50 and p95.
- CPU frame time p50 and p95.
- GPU frame time.
- Upload calls and bytes.
- Draw calls.
- JavaScript heap size.
- WASM memory size.
- Texture or storage-buffer memory.
- VAT bake time and peak memory.

Add benchmark scenarios for:

1. Static actors with camera movement.
2. Culling with stable visibility.
3. Rapidly changing visibility.
4. Per-instance animation and property edits.
5. Data-texture versus storage backends.
6. Scalar, SIMD128, and relaxed-SIMD kernels.
7. Single-model and multi-model rosters.

Upload statistics already exposed by Shado can become regression assertions for non-visual benchmark stages.

## Capability Reporting

Because Shado selects among several backends and execution paths, provide one diagnostic capability report:

```ts
const capabilities = await Shado.inspectCapabilities(engine);
```

It could report:

```ts
interface ShadoCapabilities {
  engine: "webgl2" | "webgpu";
  dataTexture: boolean;
  storageBuffer: boolean;
  actorStorageRendering: boolean;
  wasm: boolean;
  simd128: boolean;
  relaxedSimd: boolean;
  worker: boolean;
  float16Texture: boolean;
  selectedBackend?: string;
  warnings: string[];
}
```

This gives consumers a clear explanation of selected fallbacks and prevents failures from appearing only as shader compiler errors.

## Recommended Implementation Order

1. Separate the visible-index output from actor AoS data.
2. Reject or implement storage-backed WGSL actor rendering.
3. Isolate Babylon.js private rendering access.
4. Fix direct CPU culling and add stable actor handles.
5. Add reusable VAT worker pools, kernel caching, cancellation, and input limits.
6. Key runtime initialization by engine/configuration and clean generated shader entries.
7. Split package entry points and synchronize published source, versions, and tags.
8. Add real WebGL/WebGPU browser CI and reproducible performance benchmarks.

## Final Assessment

Shado already demonstrates sophisticated engineering:

- One packed schema shared across TypeScript, GPU shaders, and optional WASM.
- Dual-quaternion VAT with scalar and SIMD kernels.
- Dirty-page tracking and partial storage-buffer updates.
- Headless runtime baking.
- Dynamic entity reducers.
- Generated shader layouts and inspector-facing published controls.

Its largest remaining risks are concentrated at boundaries rather than in the underlying concept:

- Visibility output is mixed into durable actor data.
- Some advertised backend combinations are incomplete.
- Rendering depends on Babylon.js internals without a narrow compatibility layer.
- Actor identity remains tied to mutable array positions.
- Worker and shader resources are not optimized for repeated lifecycle use.
- Published artifacts are ahead of the public source state.

Addressing those issues would make Shado easier to trust in long-lived applications without weakening the specialized high-performance framework described by its author.
