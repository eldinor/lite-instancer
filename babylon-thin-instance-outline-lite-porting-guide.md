# Porting `babylon-thin-instance-outline` to Babylon Lite

## Purpose

This document is an implementation specification for porting:

- Repository: `increasinglyHuman/babylon-thin-instance-outline`
- Current package: `@poqpoq/babylon-thin-instance-outline`
- Current renderer: Babylon.js 8.x
- Target renderer: Babylon Lite native API (`@babylonjs/lite`)

The intended reader is a coding agent or developer implementing the port.

## Implementation update (Babylon Lite 1.11)

The port is implemented in this repository under the optional `@litools/instancer/outline` entry point. The shipped integration supersedes the older frozen-slot sketches later in this document in these important ways:

- `createInstanceOutliner()` accepts an `InstanceSet` and highlights stable `InstanceId` values. It stores only highlighted instances in a compact internal pool, so source slot swaps, visibility packing, and capacity growth do not invalidate highlight identity.
- `createThinInstanceOutliner()` is the separate standalone API for ordinary meshes and raw thin-instance indices. Raw indices remain intentionally caller-managed and are validated against the current active count.
- `mesh.thinInstances.count` is the active draw count, not logical count or capacity. It must never be used to freeze an instancer attachment's lifetime capacity or decide permanently whether a host is instanced.
- Explicit geometry is the supported contract. `tryGetRetainedOutlineGeometry()` is isolated and version-sensitive because Babylon Lite still does not expose a stable public geometry getter.
- Babylon Lite 1.11 defines `SceneNode.metadata`, but outline ownership remains in manager maps so the renderer does not mutate application metadata.
- `setParent()` preserves world transform. The implementation parents the outline and then resets its local transform to identity; detach uses `setParent(outline, null)` before `removeFromScene()` so both sides of the hierarchy are cleaned.
- Outline meshes are non-pickable, are not registered as shadow casters, and expose `outlineMesh` so custom geometry/depth tasks can exclude them. Opaque hosts are supported; transparent hosts remain unsupported.
- Extrusion is object-space for parity. Non-uniform scale changes apparent width, while negative-determinant transforms can change winding parity and are explicitly covered by the gallery scenarios and unit/state tests.

The raw index/frozen `slotCount` algorithms below are retained only as historical technique notes for standalone ports; use the compact stable-ID implementation for `@litools/instancer` integration.

The port should preserve the original library's main behavior:

- inverted-hull silhouette outlines;
- per-thin-instance highlight and clear;
- per-instance color;
- optional animated effects;
- smooth outline normals for hard-edge geometry;
- single-mesh outlining;
- explicit attach, detach, and dispose lifecycle.

This should be a native Babylon Lite implementation, not a compatibility-layer wrapper.

It should be available as stand-alone outliner or used together with instancer.

---

# 1. Original technique

The original library does not use `EdgesRenderer`.

It creates a second mesh that:

1. copies the source mesh geometry;
2. uses a custom shader;
3. moves vertices outward along their normals;
4. renders only the reversed/back-facing hull;
5. mirrors the source thin-instance matrices;
6. hides inactive outline instances with a zero-scale matrix.

Conceptually:

```text
source mesh
    └── normal rendering

outline mesh
    ├── same positions and indices
    ├── optionally smoothed normals
    ├── expanded in the vertex shader
    ├── rendered behind the source
    └── one outline instance per source instance
```

The source mesh occludes most of the expanded outline mesh. Only the expanded silhouette remains visible.

This technique is fully compatible with Babylon Lite.

The implementation must be rewritten because Babylon Lite uses:

- factory functions instead of constructors;
- plain data instead of class instances;
- WGSL instead of GLSL;
- explicit scene registration;
- raw typed arrays for thin instances;
- different render-state controls.

---

# 2. Recommended package design

Create a separate addition to instancer rather than adding Lite conditionals to the existing Babylon.js implementation.

Do not share source files directly with the Babylon.js version unless they are renderer-independent.

Safe shared concepts:

- normal smoothing math;
- zero-scale matrix creation;
- color helpers;
- option and effect types.

Renderer-specific concepts should stay separate:

- mesh creation;
- material creation;
- shader source;
- instance buffer updates;
- scene registration;
- lifecycle and disposal.

---

# 3. Public API

Use a factory-function API that matches Babylon Lite conventions.

Recommended top-level factory:

```ts
import type { EngineContext, SceneContext, Mesh } from "@babylonjs/lite";

export function createThinInstanceOutliner(engine: EngineContext, scene: SceneContext): ThinInstanceOutliner;
```

Recommended returned interface:

```ts
export interface ThinInstanceOutliner {
  attach(host: Mesh, options?: AttachOptions): void;
  highlight(host: Mesh, instanceIndex: number, options?: HighlightOptions): void;
  clear(host: Mesh, instanceIndex: number): void;
  clearAll(host: Mesh): void;
  refresh(host: Mesh, instanceIndex?: number): void;
  isHighlighted(host: Mesh, instanceIndex: number): boolean;
  setEffectParams(host: Mesh, updates: EffectParamUpdates): void;
  detach(host: Mesh): void;
  dispose(): void;
}
```

Recommended geometry contract:

```ts
export interface OutlineGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
```

Recommended attach options:

```ts
export interface AttachOptions {
  geometry?: OutlineGeometry;

  thickness?: number;
  color?: readonly [number, number, number];

  smoothNormals?: boolean;

  renderOrderOffset?: number;

  pulse?: PulseOptions;
  colorCycle?: ColorCycleOptions;
  edgeFlow?: EdgeFlowOptions;
  rimFlow?: RimFlowOptions;
  sizzle?: SizzleOptions;

  gpuCullBoundsPad?: number;
}
```

Recommended highlight options:

```ts
export interface HighlightOptions {
  color?: readonly [number, number, number];
  phase?: number;
}
```

Use tuples or readonly arrays instead of Babylon.js `Color3`.

---

# 4. Babylon.js to Babylon Lite API mapping

| Babylon.js implementation                   | Babylon Lite implementation                                     |
| ------------------------------------------- | --------------------------------------------------------------- |
| `new Mesh(name, scene)`                     | `createMeshFromData(engine, name, positions, normals, indices)` |
| object auto-registers in scene              | `addToScene(scene, mesh)`                                       |
| `new ShaderMaterial(...)`                   | `createShaderMaterial({...})`                                   |
| GLSL                                        | WGSL                                                            |
| `Effect.ShadersStore`                       | shader source passed directly to material factory               |
| `mesh.thinInstanceSetBuffer("matrix", ...)` | `setThinInstances(mesh, matrices, count)`                       |
| `mesh.thinInstanceSetBuffer("color", ...)`  | `setThinInstanceColors(mesh, colors)`                           |
| `mesh.thinInstanceSetMatrixAt(...)`         | `setThinInstanceMatrix(mesh, index, matrix)`                    |
| `mesh.thinInstanceSetAttributeAt(...)`      | `setThinInstanceColor(...)` or storage buffer                   |
| `mesh.thinInstanceBufferUpdated(...)`       | `flushThinInstances(mesh)` after direct array edits             |
| `mesh.getVerticesData(...)`                 | no stable public equivalent; use explicit geometry input        |
| `mesh.getIndices()`                         | no stable public equivalent; use explicit geometry input        |
| `mesh.dispose()`                            | `removeFromScene(scene, mesh)`                                  |
| `scene.onBeforeRenderObservable.add(...)`   | `onBeforeRender(scene, callback)`                               |
| `renderingGroupId`                          | `renderOrder`                                                   |
| `Color3`                                    | RGB tuple                                                       |
| `Matrix`                                    | `Float32Array` / `Mat4`                                         |
| front-face culling option                   | reverse triangle winding and use back-face culling              |

---

# 5. Important design decision: geometry access

## 5.1 Problem

The Babylon.js version can read source geometry from a mesh:

```ts
host.getVerticesData(...)
host.getIndices(...)
```

Babylon Lite currently does not expose a stable public equivalent.

Some Lite meshes retain CPU-side fields such as:

```ts
host._cpuPositions;
host._cpuNormals;
host._cpuIndices;
```

These are internal fields and should not be the main package contract.

When this https://github.com/BabylonJS/Babylon-Lite/pull/425/ will be merger we can use new Lite public getMeshGeometry(mesh) helper

## 5.2 Required solution

The supported API should allow the caller to pass geometry explicitly:

```ts
outliner.attach(host, {
  geometry: {
    positions,
    normals,
    indices,
  },
});
```

This is the reliable implementation.

## 5.3 Optional convenience adapter

A convenience adapter may read retained geometry when available:

```ts
export function tryGetRetainedGeometry(host: Mesh): OutlineGeometry | null {
  const source = host as Mesh & {
    _cpuPositions?: Float32Array;
    _cpuNormals?: Float32Array;
    _cpuIndices?: Uint32Array;
  };

  if (!source._cpuPositions || !source._cpuNormals || !source._cpuIndices) {
    return null;
  }

  return {
    positions: source._cpuPositions,
    normals: source._cpuNormals,
    indices: source._cpuIndices,
  };
}
```

Rules:

- keep this helper isolated in one file;
- label it as version-sensitive;
- never mutate the host arrays;
- clone arrays before modifying normals or winding;
- fail gracefully when data is unavailable.

Recommended resolution order:

```ts
const geometry = options.geometry ?? tryGetRetainedGeometry(host);

if (!geometry) {
  return;
}
```

Do not silently create incorrect geometry.

---

# 6. Outline mesh creation

Use:

```ts
createMeshFromData(engine, `${host.name}-outline`, positions, normals, reversedIndices);
```

Always create independent typed arrays:

```ts
const positions = new Float32Array(source.positions);
const normals = new Float32Array(source.normals);
const indices = reverseTriangleWinding(source.indices);
```

Do not share GPU geometry with the host.

Reasons:

- outline normals may be modified;
- triangle winding must be reversed;
- independent disposal is safer;
- host geometry must not be affected;
- future geometry updates remain isolated.

After mesh creation:

```ts
outlineMesh.material = material;
outlineMesh.pickable = false;
outlineMesh.renderOrder = (host.renderOrder ?? 100) + renderOrderOffset;

addToScene(scene, outlineMesh);
```

Recommended default:

```ts
const DEFAULT_RENDER_ORDER_OFFSET = -1;
```

---

# 7. Transform strategy

## 7.1 Recommended strategy

Parent the outline mesh to the source host:

```ts
outlineMesh.parent = host;
host.children.push(outlineMesh);
```

Keep the outline mesh local transform at identity.

In the shader:

```wgsl
let instanceWorld = mat4x4<f32>(
    input.world0,
    input.world1,
    input.world2,
    input.world3
);

let finalWorld =
    shaderSystem.world *
    instanceWorld;
```

For the outline mesh, `shaderSystem.world` includes the inherited host transform.

This gives:

```text
host world matrix × thin-instance matrix
```

which is the desired final transform.

## 7.2 Advantages

This removes the need to copy the host's local position, rotation, quaternion, and scaling manually.

It also simplifies single-mesh mode:

- the outline mesh follows the host automatically;
- the one internal thin instance uses the identity matrix;
- no per-frame world-matrix mirroring is needed.

## 7.3 Parent bookkeeping

Babylon Lite scene nodes maintain both:

```ts
child.parent;
parent.children;
```

Set both consistently.

Create helpers:

```ts
function attachChild(parent: SceneNode, child: SceneNode): void {
  child.parent = parent;

  if (!parent.children.includes(child)) {
    parent.children.push(child);
  }
}

function detachChild(parent: SceneNode, child: SceneNode): void {
  if (child.parent === parent) {
    child.parent = null;
  }

  const index = parent.children.indexOf(child);

  if (index >= 0) {
    parent.children.splice(index, 1);
  }
}
```

Before removing the outline mesh from the scene, detach it from the host.

---

# 8. Front-face culling

## 8.1 Original behavior

An inverted hull normally renders only back-facing polygons relative to the original mesh.

The Babylon.js material can explicitly cull front faces.

## 8.2 Babylon Lite limitation

Babylon Lite ShaderMaterial currently exposes:

```ts
backFaceCulling: boolean;
```

It does not expose a public `cullMode: "front"` option.

## 8.3 Recommended solution

Reverse every triangle in the copied index buffer:

```ts
export function reverseTriangleWinding(indices: Uint32Array): Uint32Array {
  const result = new Uint32Array(indices.length);

  for (let i = 0; i < indices.length; i += 3) {
    result[i] = indices[i];
    result[i + 1] = indices[i + 2];
    result[i + 2] = indices[i + 1];
  }

  return result;
}
```

Then use normal back-face culling:

```ts
backFaceCulling: true;
```

This is equivalent to front-face culling on the original index order.

## 8.4 Alternative

A fragment shader may use `@builtin(front_facing)` and discard front-facing fragments.

Do not use that as the default because:

- both sides reach rasterization;
- front-facing fragments run the fragment shader before discard;
- it is less efficient;
- reversed winding is simpler and cheaper.

---

# 9. Thin-instance matrix storage

## 9.1 Outline slot count

At attach time:

```ts
const sourceCount = host.thinInstances?.count ?? 0;

const singleMesh = sourceCount === 0;

const slotCount = singleMesh ? 1 : sourceCount;
```

Freeze `slotCount` at attach time.

If the source host grows beyond that capacity, require detach and attach again.

This matches the existing library behavior and avoids hidden reallocations.

## 9.2 Matrix buffer

Allocate:

```ts
const outlineMatrices = new Float32Array(slotCount * 16);
```

Initialize every slot with a zero-scale matrix.

Example zero-scale matrix:

```ts
export const ZERO_SCALE_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
```

Initialize:

```ts
for (let i = 0; i < slotCount; i++) {
  outlineMatrices.set(ZERO_SCALE_MATRIX, i * 16);
}
```

Register:

```ts
setThinInstances(outlineMesh, outlineMatrices, slotCount);
```

---

# 10. Per-instance color and phase

## 10.1 Lite constraint

Babylon Lite provides one built-in optional per-instance RGBA stream:

```text
instanceColor: vec4<f32>
```

The original library uses:

- RGB or RGBA color;
- a separate float phase attribute.

Do not add a custom vertex-buffer implementation in the first port.

## 10.2 Pack phase into alpha

Store:

```text
instanceColor.rgb = outline color
instanceColor.a   = animation phase
```

The fragment shader should output alpha `1.0`, not the packed phase.

Allocate:

```ts
const colors = new Float32Array(slotCount * 4);

for (let i = 0; i < slotCount; i++) {
  const offset = i * 4;

  colors[offset] = defaultColor[0];
  colors[offset + 1] = defaultColor[1];
  colors[offset + 2] = defaultColor[2];
  colors[offset + 3] = 0;
}

setThinInstanceColors(outlineMesh, colors);
```

Update one slot:

```ts
setThinInstanceColor(outlineMesh, instanceIndex, color[0], color[1], color[2], phase);
```

In WGSL:

```wgsl
output.outlineColor =
    input.instanceColor.rgb;

output.phase =
    input.instanceColor.a;
```

Fragment output:

```wgsl
return vec4<f32>(
    finalColor,
    1.0
);
```

## 10.3 Future expansion

Use a storage buffer only when adding features that no longer fit in RGBA, such as:

- per-instance thickness;
- multiple animation phase values;
- per-instance effect masks;
- per-instance edge-flow parameters.

Do not add that complexity to the initial port.

---

# 11. ShaderMaterial creation

Use native Babylon Lite WGSL ShaderMaterial.

Recommended material factory:

```ts
function createOutlineMaterial(options: ResolvedAttachOptions): ShaderMaterial {
  return createShaderMaterial({
    name: options.name,

    vertexSource: OUTLINE_VERTEX_WGSL,
    fragmentSource: OUTLINE_FRAGMENT_WGSL,

    attributes: ["position", "normal"],

    uniforms: [
      "world",
      "view",
      "viewProjection",

      {
        name: "thickness",
        type: "f32",
        defaultValue: options.thickness,
      },
      {
        name: "time",
        type: "f32",
        defaultValue: 0,
      },

      // Declare only required effect uniforms.
    ],

    defines: {
      OUTLINE_PULSE: options.pulse !== null,

      OUTLINE_COLOR_CYCLE: options.colorCycle !== null,

      OUTLINE_EDGE_FLOW: options.edgeFlow !== null,

      OUTLINE_RIM_FLOW: options.rimFlow !== null,

      OUTLINE_SIZZLE: options.sizzle !== null,
    },

    useThinInstanceColors: true,

    backFaceCulling: true,
    depthWrite: true,
    depthCompare: "greater-equal",
  });
}
```

Check the current Lite depth convention before finalizing `depthCompare`.

Do not assume the Babylon.js default forward-Z state. Babylon Lite commonly uses reverse-Z camera rendering.

The material should use system uniforms:

```ts
"world";
"view";
"viewProjection";
```

Use typed declarations for custom uniforms.

---

# 12. WGSL vertex shader

Recommended base structure:

```wgsl
struct VertexOutput {
    @builtin(position)
    position: vec4<f32>,

    @location(0)
    outlineColor: vec3<f32>,

    @location(1)
    phase: f32,

    @location(2)
    objectPosition: vec3<f32>,

    @location(3)
    rimDirection: vec2<f32>,

    @location(4)
    flowCoordinate: f32,
};

@vertex
fn mainVertex(
    input: VertexInput,
) -> VertexOutput {
    var output: VertexOutput;

    let instanceWorld =
        mat4x4<f32>(
            input.world0,
            input.world1,
            input.world2,
            input.world3,
        );

    let finalWorld =
        shaderSystem.world *
        instanceWorld;

    let displaced =
        input.position +
        input.normal *
        shaderUniforms.thickness;

    output.position =
        shaderSystem.viewProjection *
        finalWorld *
        vec4<f32>(
            displaced,
            1.0,
        );

    output.outlineColor =
        input.instanceColor.rgb;

    output.phase =
        input.instanceColor.a;

    output.objectPosition =
        input.position;

    output.flowCoordinate = 0.0;
    output.rimDirection =
        vec2<f32>(0.0, 0.0);

    if (OUTLINE_EDGE_FLOW) {
        output.flowCoordinate =
            (
                dot(
                    input.position,
                    shaderUniforms.flowAxis,
                ) -
                shaderUniforms.flowMin
            ) *
            shaderUniforms.flowInvLength;
    }

    if (OUTLINE_RIM_FLOW) {
        let viewVertex =
            shaderSystem.view *
            finalWorld *
            vec4<f32>(
                displaced,
                1.0,
            );

        let viewCentroid =
            shaderSystem.view *
            finalWorld *
            vec4<f32>(
                shaderUniforms.geometryCentroid,
                1.0,
            );

        output.rimDirection =
            viewVertex.xy -
            viewCentroid.xy;
    }

    return output;
}
```

Notes:

- Lite automatically injects `world0`, `world1`, `world2`, `world3`;
- `instanceColor` is injected when instance colors are present;
- the shader must compose `shaderSystem.world * instanceWorld`;
- do not use `worldViewProjection` for thin instances;
- keep object-space displacement consistent with the original behavior.

---

# 13. WGSL fragment shader

Port effect functions from GLSL to WGSL.

Recommended base:

```wgsl
@fragment
fn mainFragment(
    input: VertexOutput,
) -> @location(0) vec4<f32> {
    var color =
        input.outlineColor;

    let phaseTime =
        shaderUniforms.time +
        input.phase *
        6.28318530718;

    if (OUTLINE_COLOR_CYCLE) {
        color =
            applyColorCycle(
                color,
                phaseTime,
                shaderUniforms.cyclePeriod,
            );
    }

    if (OUTLINE_EDGE_FLOW) {
        color +=
            evaluateEdgeFlow(
                input.flowCoordinate,
                phaseTime,
            );
    }

    if (OUTLINE_RIM_FLOW) {
        color +=
            evaluateRimFlow(
                input.rimDirection,
                phaseTime,
            );
    }

    if (OUTLINE_SIZZLE) {
        color +=
            evaluateSizzle(
                input.objectPosition,
                phaseTime,
            );
    }

    if (OUTLINE_PULSE) {
        color *=
            evaluatePulse(
                phaseTime,
            );
    }

    return vec4<f32>(
        color,
        1.0,
    );
}
```

WGSL conversion rules:

```text
GLSL vec3       -> WGSL vec3<f32>
GLSL vec4       -> WGSL vec4<f32>
GLSL mat4       -> WGSL mat4x4<f32>
GLSL mix        -> WGSL mix
GLSL fract      -> WGSL fract
GLSL smoothstep -> WGSL smoothstep
GLSL atan(y,x)  -> WGSL atan2(y,x)
```

Verify exact WGSL builtin names against the currently installed compiler.

---

# 14. Effect defines

WGSL does not support `#define` or `#ifdef`.

Babylon Lite material defines become generated constants.

Use:

```ts
defines: {
    OUTLINE_PULSE: true,
}
```

Then in WGSL:

```wgsl
if (OUTLINE_PULSE) {
    // Constant-folded by the shader compiler.
}
```

Do not generate shader strings with manual preprocessor substitution unless required.

The set of enabled effects remains fixed at attach time.

Changing the enabled effect set should require:

```text
detach -> attach
```

Uniform-backed effect values may be changed live.

---

# 15. Edge-flow axis improvement

The Babylon.js version uses a compile-time axis index.

Improve the Lite version by making the axis a uniform:

```ts
{
    name: "flowAxis",
    type: "vec3<f32>",
}
```

Map:

```ts
function axisVector(axis: "x" | "y" | "z"): readonly [number, number, number] {
  switch (axis) {
    case "x":
      return [1, 0, 0];
    case "y":
      return [0, 1, 0];
    case "z":
      return [0, 0, 1];
  }
}
```

WGSL:

```wgsl
dot(
    input.position,
    shaderUniforms.flowAxis,
)
```

This permits changing the flow axis without recompiling the shader.

---

# 16. Geometry measurements

Compute once during attach.

## 16.1 Centroid

Use object-space bounding-box center:

```ts
function computeBoundingBoxCenter(positions: Float32Array): readonly [number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;

  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);

    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
}
```

## 16.2 Flow extent

Project every position onto the flow axis:

```ts
function computeAxisExtent(
  positions: Float32Array,
  axis: readonly [number, number, number],
): {
  min: number;
  invLength: number;
} {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const value = positions[i] * axis[0] + positions[i + 1] * axis[1] + positions[i + 2] * axis[2];

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const length = max - min;

  return {
    min,
    invLength: length > 1e-6 ? 1 / length : 0,
  };
}
```

---

# 17. Smooth normals

The existing smooth-normal behavior should be preserved.

Only modify the outline mesh normals.

Never modify host mesh normals.

## 17.1 Improve algorithm complexity

The original implementation compares every vertex with every other vertex.

Replace the O(n²) implementation with spatial hashing.

Suggested method:

```ts
interface NormalGroup {
  indices: number[];
  sumX: number;
  sumY: number;
  sumZ: number;
}
```

Generate a quantized key:

```ts
function positionKey(x: number, y: number, z: number, epsilon: number): string {
  const qx = Math.round(x / epsilon);
  const qy = Math.round(y / epsilon);
  const qz = Math.round(z / epsilon);

  return `${qx},${qy},${qz}`;
}
```

Algorithm:

1. group vertices by quantized position;
2. sum normals in each group;
3. normalize the group sum;
4. write the normalized result to every group member.

This is approximately O(n).

Handle degenerate sums by retaining the original normal.

---

# 18. Attach implementation

Recommended state:

```ts
interface AttachedHost {
  host: Mesh;
  outlineMesh: Mesh;
  material: ShaderMaterial;

  slotCount: number;
  singleMesh: boolean;

  matrices: Float32Array;
  colors: Float32Array;

  shownIndices: Set<number>;

  defaultColor: readonly [number, number, number];

  hasEffects: boolean;

  effects: {
    pulse: boolean;
    colorCycle: boolean;
    edgeFlow: boolean;
    rimFlow: boolean;
    sizzle: boolean;
  };
}
```

Recommended flow:

```ts
function attach(host: Mesh, options: AttachOptions = {}): void {
  if (disposed) {
    return;
  }

  if (attached.has(host)) {
    return;
  }

  const sourceGeometry = options.geometry ?? tryGetRetainedGeometry(host);

  if (!sourceGeometry) {
    return;
  }

  const positions = new Float32Array(sourceGeometry.positions);

  const normals = new Float32Array(sourceGeometry.normals);

  if (options.smoothNormals ?? true) {
    averageNormalsAtSharedPositions(positions, normals);
  }

  const indices = reverseTriangleWinding(sourceGeometry.indices);

  const material = createOutlineMaterial(resolveOptions(host, positions, options));

  const outlineMesh = createMeshFromData(engine, `${host.name}-outline`, positions, normals, indices);

  outlineMesh.material = material;
  outlineMesh.pickable = false;
  outlineMesh.renderOrder = (host.renderOrder ?? 100) + (options.renderOrderOffset ?? 1);

  attachChild(host, outlineMesh);

  const sourceCount = host.thinInstances?.count ?? 0;

  const singleMesh = sourceCount === 0;

  const slotCount = singleMesh ? 1 : sourceCount;

  const matrices = createHiddenMatrixBuffer(slotCount);

  setThinInstances(outlineMesh, matrices, slotCount);

  const colors = createColorBuffer(slotCount, resolvedColor);

  setThinInstanceColors(outlineMesh, colors);

  addToScene(scene, outlineMesh);

  attached.set(host, {
    host,
    outlineMesh,
    material,
    slotCount,
    singleMesh,
    matrices,
    colors,
    shownIndices: new Set(),
    defaultColor: resolvedColor,
    hasEffects,
    effects,
  });
}
```

Potential scene-graph issue:

If `addToScene(scene, outlineMesh)` recursively adds children, ensure the outline is added only once.

Safe order:

1. create outline;
2. configure outline;
3. add outline directly to scene;
4. then parent it to the host.

Or explicitly verify that the host has already been added and the scene does not recursively re-add it.

Do not allow duplicate renderables.

---

# 19. Highlight implementation

## 19.1 Thin-instance host

Read directly from:

```ts
host.thinInstances.matrices;
```

Copy the selected source matrix into the outline slot.

Avoid allocating a new matrix each time.

Use:

```ts
function copyMatrixSlot(
  source: Float32Array | Float64Array,
  sourceIndex: number,
  target: Float32Array,
  targetIndex: number,
): void {
  const sourceOffset = sourceIndex * 16;

  const targetOffset = targetIndex * 16;

  for (let i = 0; i < 16; i++) {
    target[targetOffset + i] = source[sourceOffset + i];
  }
}
```

Then either:

```ts
flushThinInstances(outlineMesh);
```

or:

```ts
setThinInstanceMatrix(outlineMesh, index, matrixScratch);
```

Use `setThinInstanceMatrix` for isolated changes.

## 19.2 Single-mesh host

Set slot zero to identity:

```ts
setThinInstanceMatrix(outlineMesh, 0, IDENTITY_MATRIX);
```

Because the outline is parented to the host, identity is sufficient.

## 19.3 Color and phase

Resolve:

```ts
const color = options.color ?? state.defaultColor;

const phase = options.phase ?? 0;
```

Update:

```ts
setThinInstanceColor(state.outlineMesh, instanceIndex, color[0], color[1], color[2], phase);
```

Finally:

```ts
state.shownIndices.add(instanceIndex);
```

## 19.4 Bounds checks

Always validate against `state.slotCount`, not the host's current live count.

```ts
if (instanceIndex < 0 || instanceIndex >= state.slotCount) {
  return;
}
```

---

# 20. Clear and clearAll

Clear one:

```ts
function clear(host: Mesh, instanceIndex: number): void {
  const state = attached.get(host);

  if (!state || !state.shownIndices.has(instanceIndex)) {
    return;
  }

  setThinInstanceMatrix(state.outlineMesh, instanceIndex, ZERO_SCALE_MATRIX);

  state.shownIndices.delete(instanceIndex);
}
```

Clear all efficiently by editing the backing matrix array directly:

```ts
function clearAll(host: Mesh): void {
  const state = attached.get(host);

  if (!state || state.shownIndices.size === 0) {
    return;
  }

  for (const index of state.shownIndices) {
    state.matrices.set(ZERO_SCALE_MATRIX, index * 16);
  }

  flushThinInstances(state.outlineMesh);

  state.shownIndices.clear();
}
```

---

# 21. Refresh behavior

Thin-instance matrices may change after highlighting.

`refresh()` must re-copy source matrices for currently shown slots.

Recommended implementation:

```ts
function refresh(host: Mesh, instanceIndex?: number): void {
  const state = attached.get(host);

  if (!state) {
    return;
  }

  if (state.singleMesh) {
    return;
  }

  const source = host.thinInstances?.matrices;

  if (!source) {
    return;
  }

  const targets =
    instanceIndex === undefined ? state.shownIndices : state.shownIndices.has(instanceIndex) ? [instanceIndex] : [];

  for (const index of targets) {
    copyMatrixSlot(source, index, state.matrices, index);
  }

  flushThinInstances(state.outlineMesh);
}
```

Single-mesh mode requires no refresh because parenting tracks the host transform.

---

# 22. Per-frame effect time

Register exactly one callback for the complete outliner.

```ts
let elapsedSeconds = 0;

onBeforeRender(scene, (deltaMs) => {
  if (disposed) {
    return;
  }

  elapsedSeconds += deltaMs / 1000;

  for (const state of attached.values()) {
    if (!state.hasEffects) {
      continue;
    }

    setShaderUniform(state.material, "time", elapsedSeconds);
  }
});
```

Do not register one callback per attached host.

Babylon Lite's `onBeforeRender` does not currently expose callback removal.

After outliner disposal, the callback should perform an immediate no-op.

This leaves one harmless callback until scene disposal.

---

# 23. Live parameter updates

Implement `setEffectParams()` with `setShaderUniform()`.

Example:

```ts
function setEffectParams(host: Mesh, updates: EffectParamUpdates): void {
  const state = attached.get(host);

  if (!state) {
    return;
  }

  if (updates.thickness !== undefined) {
    setShaderUniform(state.material, "thickness", updates.thickness);
  }

  if (updates.pulse && state.effects.pulse) {
    if (updates.pulse.speed !== undefined) {
      setShaderUniform(state.material, "pulseSpeed", updates.pulse.speed);
    }

    if (updates.pulse.amplitude !== undefined) {
      setShaderUniform(state.material, "pulseAmplitude", updates.pulse.amplitude);
    }
  }
}
```

Apply the same pattern to every effect.

Only set uniforms declared on that material.

Changing which effects are enabled requires reattach.

---

# 24. Render ordering and depth

## 24.1 Opaque hosts

The first release should formally support opaque hosts.

Recommended:

```ts
outlineMesh.renderOrder = (host.renderOrder ?? 100) + 1;
```

Draw the outline before the host.

The outline writes depth.

The source host then draws over the front part of the expanded hull.

## 24.2 Transparent hosts

Transparent hosts are problematic because they usually do not write depth.

The inverted-hull outline may show through the host.

For version 1:

- document transparent hosts as unsupported;
- do not attempt to solve this with arbitrary render-order values.

Future solutions:

- explicit depth prepass;
- stencil mask;
- screen-space outline;
- dedicated render task.

---

# 25. GPU frustum culling

The outline shader expands geometry beyond original bounds.

If GPU thin-instance culling is enabled for the outline mesh, silhouettes can pop near the viewport edge.

Default recommendation:

```text
Do not enable GPU thin-instance culling on the outline mesh.
```

Optional support:

```ts
setThinInstanceCullBoundsPad(outlineMesh, maximumThickness);
```

If allowing animated thickness, use the maximum possible outline displacement.

Do not simply copy the source host's GPU-culling state.

---

# 26. Detach and dispose

Detach:

```ts
function detach(host: Mesh): void {
  const state = attached.get(host);

  if (!state) {
    return;
  }

  detachChild(host, state.outlineMesh);

  removeFromScene(scene, state.outlineMesh);

  attached.delete(host);
}
```

Confirm whether `removeFromScene()` already disposes the material.

If the material has separate disposable resources, clean them explicitly.

Outliner disposal:

```ts
function dispose(): void {
  if (disposed) {
    return;
  }

  for (const host of Array.from(attached.keys())) {
    detach(host);
  }

  disposed = true;
}
```

Do not mutate the map while iterating directly without copying keys.

---

# 27. Metadata

The original app stores outline references in `host.metadata`.

Babylon Lite mesh types do not define a standard metadata field.

Do not mutate public mesh types with arbitrary properties in the core implementation.

Use the internal map:

```ts
const attached = new Map<Mesh, AttachedHost>();
```

Optional debug helper:

```ts
function getOutlineMesh(host: Mesh): Mesh | null {
  return attached.get(host)?.outlineMesh ?? null;
}
```

Expose this only if useful.

---

# 28. Demo port

Create a Babylon Lite demo with:

- one box thin-instance host;
- one torus-knot or sphere host;
- one single normal mesh;
- pointer picking;
- click to toggle highlight;
- several outline colors;
- at least one animated effect;
- a control for outline thickness.

Suggested demo flow:

```ts
const engine =
    await createEngine(canvas);

const scene =
    createSceneContext(engine);

const outliner =
    createThinInstanceOutliner(
        engine,
        scene,
    );

// Create host geometry and retain source arrays.
const boxData =
    createBoxData(...);

const host =
    createMeshFromData(
        engine,
        "boxes",
        boxData.positions,
        boxData.normals,
        boxData.indices,
    );

setThinInstances(
    host,
    matrices,
    count,
);

addToScene(
    scene,
    host,
);

outliner.attach(
    host,
    {
        geometry: {
            positions:
                boxData.positions,
            normals:
                boxData.normals,
            indices:
                boxData.indices,
        },
    },
);

await registerScene(scene);
await startEngine(engine);
```

Important:

- create and attach outline meshes before scene registration when possible;
- verify post-registration attach behavior separately;
- avoid duplicate scene registration;
- ensure picking ignores the outline mesh.

---

# 29. Tests

## 29.1 Pure unit tests

Test:

- zero-scale matrix generation;
- identity matrix use;
- triangle winding reversal;
- normal smoothing;
- geometry cloning;
- flow extent calculation;
- centroid calculation;
- color/phase packing;
- index bounds checks.

## 29.2 Outliner state tests

Test:

- attach is idempotent;
- highlight before attach is a no-op;
- clear before attach is a no-op;
- out-of-range indices are ignored;
- clear only affects shown indices;
- clearAll hides every shown slot;
- isHighlighted reports correct state;
- detach removes state;
- dispose detaches all hosts;
- calls after dispose are no-ops.

## 29.3 Rendering tests

Create screenshot or pixel tests for:

1. one outlined box;
2. one outlined sphere;
3. only one thin instance highlighted;
4. several instances highlighted with different colors;
5. hard-edge cube with smooth normals enabled;
6. smooth normals disabled;
7. single-mesh mode;
8. pulse effect;
9. color cycle;
10. edge flow;
11. rim flow;
12. sizzle;
13. parent transform updates;
14. non-uniform instance scale;
15. negative scale and winding parity.

## 29.4 Important edge case: negative determinant

Reversing triangle winding works for normal positive-scale transforms.

A transform containing a negative scale changes winding parity.

Test:

```text
scale = [-1, 1, 1]
scale = [1, -1, 1]
scale = [1, 1, -1]
```

If inverted hull fails for mirrored instances, document the limitation or add determinant-aware handling.

A single pipeline cannot dynamically switch cull mode per instance.

Possible future solution:

- separate mirrored and non-mirrored instance hosts;
- shader discard using front-facing information;
- no-cull fragment discard path.

Do not ignore this test.

---

# 30. Performance requirements

The port should retain the main performance property:

```text
one outline draw call per attached host
```

Avoid:

- one outline mesh per selected instance;
- one material per selected instance;
- new matrix allocations during highlight;
- full matrix-buffer uploads for a single update;
- full color-buffer uploads for a single update;
- per-host frame callbacks;
- O(n²) normal smoothing.

Preferred update paths:

```text
single matrix  -> setThinInstanceMatrix
single color   -> setThinInstanceColor
batch matrices -> direct array edits + flushThinInstances
uniform        -> setShaderUniform
```

---

# 31. Compatibility and versioning

Babylon Lite is evolving rapidly.

Use a strict peer dependency range.

Example:

```json
{
  "peerDependencies": {
    "@babylonjs/lite": ">=0.x.y <0.x+1.0"
  }
}
```

Choose the real supported range during implementation.

Avoid depending on internal APIs except the optional geometry adapter.

Add CI against:

- minimum supported Lite version;
- latest supported Lite version.

The retained-geometry adapter should have its own compatibility test.

---

# 32. Suggested implementation milestones

## Milestone 1: static outline

Implement:

- explicit geometry input;
- independent outline geometry;
- reversed winding;
- WGSL base shader;
- one static outline color;
- one highlighted thin instance;
- clear;
- detach.

Acceptance:

- one selected box instance receives a clean silhouette outline.

## Milestone 2: complete thin-instance API

Implement:

- multiple highlighted instances;
- clearAll;
- refresh;
- per-instance colors;
- slot count checks;
- single-mesh mode.

Acceptance:

- several instances can be independently highlighted and moved.

## Milestone 3: normal smoothing

Implement:

- spatial-hash smoothing;
- enabled by default;
- disable option.

Acceptance:

- box corners have continuous outlines.

## Milestone 4: effects

Port:

- pulse;
- color cycle;
- edge flow;
- rim flow;
- sizzle;
- per-instance phase in color alpha;
- setEffectParams.

Acceptance:

- effects match the Babylon.js app visually within reasonable tolerance.

## Milestone 5: demo and tests

Implement:

- interactive Lite demo;
- screenshot tests;
- lifecycle tests;
- documentation;
- package exports.

---

# 33. Acceptance criteria

The port is complete when all of the following are true:

- The package uses only native `@babylonjs/lite` APIs.
- The renderer uses WGSL.
- The outline is rendered as one instanced draw per host.
- One thin instance can be highlighted without highlighting all instances.
- Several instances can use different colors.
- Inactive outline slots use zero-scale matrices.
- Hard-edge meshes have continuous outlines when smoothing is enabled.
- Single non-instanced meshes can be outlined.
- Animated effects work.
- `refresh()` tracks changed source matrices.
- `detach()` and `dispose()` release outline scene resources.
- The outline mesh never intercepts picking.
- Opaque host rendering is stable.
- Transparent-host limitations are documented.
- Negative-scale behavior is tested and documented.
- No Babylon.js core classes are imported.
- No GLSL is present.
- No `Effect.ShadersStore` is used.
- No per-instance mesh creation is used.
- No O(n²) normal smoothing remains.

---

# 34. Coding-agent task summary

Implement a native Babylon Lite port of `babylon-thin-instance-outline`.

Preserve the inverted-hull technique.

Core implementation rules:

1. Accept explicit source geometry.
2. Clone positions and normals.
3. Reverse triangle winding.
4. Smooth only the outline normals.
5. Create outline geometry with `createMeshFromData`.
6. Create a WGSL ShaderMaterial.
7. Parent the outline mesh to the host.
8. Compose `shaderSystem.world * instanceWorld` in the vertex shader.
9. Use zero-scale matrices to hide outline instances.
10. Use Lite's built-in instance RGBA stream.
11. Pack animation phase into color alpha.
12. Update one matrix with `setThinInstanceMatrix`.
13. Update one color with `setThinInstanceColor`.
14. Batch updates with direct array edits and `flushThinInstances`.
15. Use reversed winding plus back-face culling.
16. Use `renderOrder` instead of rendering groups.
17. Register one outliner-level frame callback.
18. Do not support transparent hosts in v1.
19. Do not enable GPU culling on outline meshes by default.
20. Dispose with `removeFromScene`.

The implementation should prioritize correctness, stable public Lite APIs, low allocations, and one outline draw call per host.
