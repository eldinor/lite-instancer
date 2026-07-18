import { createShaderMaterial, type ShaderMaterial, type ShaderUniformOption } from "@babylonjs/lite";
import type { OutlineAttachOptions } from "./outline-types.js";
import type { PreparedOutlineGeometry } from "./outline-geometry.js";
import { computeOutlineAxisExtent } from "./outline-geometry.js";

export interface OutlineEffects {
  pulse: boolean;
  colorCycle: boolean;
  edgeFlow: boolean;
  rimFlow: boolean;
  sizzle: boolean;
}

export interface OutlineSkinning {
  hasEightInfluences: boolean;
}

/**
 * Convert optional effect configurations into shader feature flags.
 *
 * @param options - Outline attachment options to inspect.
 * @returns Flags indicating which effect shader branches must be generated.
 */
export function resolveOutlineEffects(options: OutlineAttachOptions): OutlineEffects {
  return {
    pulse: options.pulse !== undefined,
    colorCycle: options.colorCycle !== undefined,
    edgeFlow: options.edgeFlow !== undefined,
    rimFlow: options.rimFlow !== undefined,
    sizzle: options.sizzle !== undefined
  };
}

/**
 * Create the Babylon Lite WGSL material used by an outline attachment.
 *
 * @param options - Thickness, animation effects, and their initial values.
 * @param geometry - Prepared geometry used to derive effect uniforms.
 * @param skinning - Skinning layout for an animated mesh, when applicable.
 * @returns A configured shader material for the expanded back-face outline pass.
 */
export function createOutlineMaterial(
  options: OutlineAttachOptions,
  geometry: PreparedOutlineGeometry,
  skinning?: OutlineSkinning
): ShaderMaterial {
  const effects = resolveOutlineEffects(options);
  const hasEffects = Object.values(effects).some(Boolean);
  const uniforms: ShaderUniformOption[] = [
    "world",
    "view",
    "viewProjection",
    { name: "thickness", type: "f32", defaultValue: options.thickness ?? 0.03 },
    { name: "time", type: "f32", defaultValue: 0 }
  ];
  if (effects.pulse) {
    uniforms.push(
      { name: "pulseSpeed", type: "f32", defaultValue: options.pulse!.speed },
      { name: "pulseAmplitude", type: "f32", defaultValue: options.pulse!.amplitude }
    );
  }
  if (effects.colorCycle) {
    uniforms.push({ name: "cyclePeriod", type: "f32", defaultValue: options.colorCycle!.period });
  }
  if (effects.edgeFlow) {
    const extent = computeOutlineAxisExtent(geometry.positions, options.edgeFlow!.axis);
    uniforms.push(
      { name: "flowAxis", type: "vec3<f32>", defaultValue: axisVector(options.edgeFlow!.axis) },
      { name: "flowMin", type: "f32", defaultValue: extent.min },
      { name: "flowInvLength", type: "f32", defaultValue: extent.invLength },
      { name: "flowSpeed", type: "f32", defaultValue: options.edgeFlow!.speed },
      { name: "flowWidth", type: "f32", defaultValue: options.edgeFlow!.width },
      { name: "flowAccentColor", type: "vec3<f32>", defaultValue: options.edgeFlow!.accentColor ?? [1, 1, 1] },
      { name: "flowBoost", type: "f32", defaultValue: options.edgeFlow!.boost ?? 1 }
    );
  }
  if (effects.rimFlow) {
    uniforms.push(
      { name: "geometryCentroid", type: "vec3<f32>", defaultValue: geometry.center },
      { name: "rimSpeed", type: "f32", defaultValue: options.rimFlow!.speed },
      { name: "rimWidth", type: "f32", defaultValue: options.rimFlow!.width },
      { name: "rimAccentColor", type: "vec3<f32>", defaultValue: options.rimFlow!.accentColor ?? [1, 1, 1] },
      { name: "rimBoost", type: "f32", defaultValue: options.rimFlow!.boost ?? 1 }
    );
  }
  if (effects.sizzle) {
    uniforms.push(
      { name: "sizzleScale", type: "f32", defaultValue: options.sizzle!.scale },
      { name: "sizzleSpeed", type: "f32", defaultValue: options.sizzle!.speed },
      { name: "sizzleThreshold", type: "f32", defaultValue: options.sizzle!.threshold ?? 0.6 },
      { name: "sizzleColor", type: "vec3<f32>", defaultValue: options.sizzle!.color ?? [1, 1, 1] },
      { name: "sizzleBoost", type: "f32", defaultValue: options.sizzle!.boost ?? 1 }
    );
  }
  const sources = buildOutlineShaderSources(effects, skinning);
  const attributes: Array<"position" | "normal" | "joints" | "weights" | "joints1" | "weights1"> = ["position", "normal"];
  if (skinning) {
    attributes.push("joints", "weights");
    if (skinning.hasEightInfluences) attributes.push("joints1", "weights1");
  }
  return createShaderMaterial({
    name: "instancer-outline",
    vertexSource: sources.vertex,
    fragmentSource: sources.fragment,
    attributes,
    uniforms,
    ...(skinning ? { storageBuffers: [{ name: "outlineBones", type: "array<vec4<f32>>" }] } : {}),
    defines: {
      OUTLINE_HAS_EFFECTS: hasEffects,
      OUTLINE_PULSE: effects.pulse,
      OUTLINE_COLOR_CYCLE: effects.colorCycle,
      OUTLINE_EDGE_FLOW: effects.edgeFlow,
      OUTLINE_RIM_FLOW: effects.rimFlow,
      OUTLINE_SIZZLE: effects.sizzle
    },
    useThinInstanceColors: true,
    backFaceCulling: true,
    depthWrite: true,
    depthCompare: "greater-equal"
  });
}

function axisVector(axis: "x" | "y" | "z"): readonly number[] {
  return axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
}

/**
 * Generate native WGSL vertex and fragment sources for a set of outline features.
 *
 * @param effects - Compile-time effect flags.
 * @param skinning - Optional four- or eight-influence skinning layout.
 * @returns Matching vertex and fragment shader source strings.
 */
export function buildOutlineShaderSources(
  effects: OutlineEffects,
  skinning?: OutlineSkinning
): { vertex: string; fragment: string } {
  const hasEffects = Object.values(effects).some(Boolean);
  const fields = ["@builtin(position) position: vec4<f32>", "@location(0) outlineColor: vec3<f32>"];
  let location = 1;
  if (hasEffects) fields.push(`@location(${location++}) phase: f32`);
  if (effects.edgeFlow) fields.push(`@location(${location++}) flowCoordinate: f32`);
  if (effects.rimFlow) fields.push(`@location(${location++}) rimDirection: vec2<f32>`);
  if (effects.sizzle) fields.push(`@location(${location++}) objectPosition: vec3<f32>`);
  const output = `struct VertexOutput {\n  ${fields.join(",\n  ")},\n};`;
  const vertexWrites = ["out.outlineColor = input.instanceColor.rgb;"];
  if (hasEffects) vertexWrites.push("out.phase = input.instanceColor.a;");
  if (effects.edgeFlow) vertexWrites.push("out.flowCoordinate = (dot(input.position, shaderUniforms.flowAxis) - shaderUniforms.flowMin) * shaderUniforms.flowInvLength;");
  if (effects.rimFlow) vertexWrites.push(`let viewVertex = shaderSystem.view * finalWorld * vec4<f32>(displaced, 1.0);
  let viewCentroid = shaderSystem.view * finalWorld * vec4<f32>(shaderUniforms.geometryCentroid, 1.0);
  out.rimDirection = viewVertex.xy - viewCentroid.xy;`);
  if (effects.sizzle) vertexWrites.push("out.objectPosition = input.position;");

  const skinningHelpers = skinning ? buildSkinningHelpers(skinning.hasEightInfluences) : "";
  const positionSetup = skinning
    ? `let influence = outlineSkinMatrix(input);
  let finalWorld = shaderSystem.world * instanceWorld * influence;`
    : "let finalWorld = shaderSystem.world * instanceWorld;";
  const vertex = `${output}
${skinningHelpers}
@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  ${positionSetup}
  let displaced = input.position + input.normal * shaderUniforms.thickness;
  out.position = shaderSystem.viewProjection * finalWorld * vec4<f32>(displaced, 1.0);
  ${vertexWrites.join("\n  ")}
  return out;
}`;

  const helpers: string[] = [];
  const body = ["var color = input.outlineColor;"];
  if (hasEffects) body.push("let effectTime = shaderUniforms.time + input.phase * 6.28318530718;");
  if (effects.colorCycle) {
    helpers.push(HSL_HELPERS);
    body.push(`var hsl = rgbToHsl(color);
  hsl.x = fract(hsl.x + effectTime / shaderUniforms.cyclePeriod);
  color = hslToRgb(hsl);`);
  }
  if (effects.edgeFlow) body.push(`let bandPosition = fract(input.flowCoordinate + effectTime * shaderUniforms.flowSpeed);
  let bandDistance = abs(bandPosition - 0.5);
  let bandIntensity = 1.0 - smoothstep(0.0, shaderUniforms.flowWidth, bandDistance);
  color += shaderUniforms.flowBoost * bandIntensity * shaderUniforms.flowAccentColor;`);
  if (effects.rimFlow) body.push(`let rimAngle = atan2(input.rimDirection.y, input.rimDirection.x);
  let rimU = rimAngle * 0.15915494309 + 0.5;
  let rimHotspot = fract(rimU - effectTime * shaderUniforms.rimSpeed);
  let rimDistance = abs(rimHotspot - 0.5);
  let rimIntensity = 1.0 - smoothstep(0.0, shaderUniforms.rimWidth, rimDistance);
  color += shaderUniforms.rimBoost * rimIntensity * shaderUniforms.rimAccentColor;`);
  if (effects.sizzle) {
    helpers.push(SIZZLE_HELPERS);
    body.push(`let noiseValue = 0.65 * sizzleNoise(input.objectPosition * shaderUniforms.sizzleScale + vec3<f32>(0.0, effectTime * shaderUniforms.sizzleSpeed, effectTime * shaderUniforms.sizzleSpeed * 0.7))
    + 0.35 * sizzleNoise(input.objectPosition * shaderUniforms.sizzleScale * 2.7 + vec3<f32>(effectTime * shaderUniforms.sizzleSpeed * 1.3, 0.0, 0.0));
  let flecks = smoothstep(shaderUniforms.sizzleThreshold, 1.0, noiseValue);
  color += shaderUniforms.sizzleBoost * flecks * shaderUniforms.sizzleColor;`);
  }
  if (effects.pulse) body.push(`let intensity = 1.0 - shaderUniforms.pulseAmplitude + shaderUniforms.pulseAmplitude * (0.5 + 0.5 * sin(effectTime * shaderUniforms.pulseSpeed));
  color *= intensity;`);
  body.push("return vec4<f32>(color, 1.0);");
  const fragment = `${output}
${helpers.join("\n")}
@fragment
fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  ${body.join("\n  ")}
}`;
  return { vertex, fragment };
}

function buildSkinningHelpers(hasEightInfluences: boolean): string {
  const extra = hasEightInfluences ? `
  influence += outlineBoneMatrix(input.joints1.x) * input.weights1.x;
  influence += outlineBoneMatrix(input.joints1.y) * input.weights1.y;
  influence += outlineBoneMatrix(input.joints1.z) * input.weights1.z;
  influence += outlineBoneMatrix(input.joints1.w) * input.weights1.w;` : "";
  return `fn outlineBoneMatrix(index: u32) -> mat4x4<f32> {
  let offset = index * 4u;
  return mat4x4<f32>(outlineBones[offset], outlineBones[offset + 1u], outlineBones[offset + 2u], outlineBones[offset + 3u]);
}
fn outlineSkinMatrix(input: VertexInput) -> mat4x4<f32> {
  var influence = outlineBoneMatrix(input.joints.x) * input.weights.x;
  influence += outlineBoneMatrix(input.joints.y) * input.weights.y;
  influence += outlineBoneMatrix(input.joints.z) * input.weights.z;
  influence += outlineBoneMatrix(input.joints.w) * input.weights.w;${extra}
  return influence;
}`;
}

const HSL_HELPERS = `
fn hueToRgb(p: f32, q: f32, sourceT: f32) -> f32 {
  let t = fract(sourceT);
  if (t < 0.166666667) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 0.666666667) { return p + (q - p) * (0.666666667 - t) * 6.0; }
  return p;
}
fn rgbToHsl(c: vec3<f32>) -> vec3<f32> {
  let maximum = max(max(c.r, c.g), c.b);
  let minimum = min(min(c.r, c.g), c.b);
  let lightness = (maximum + minimum) * 0.5;
  let delta = maximum - minimum;
  var hue = 0.0;
  var saturation = 0.0;
  if (delta > 0.00001) {
    saturation = select(delta / (maximum + minimum), delta / (2.0 - maximum - minimum), lightness > 0.5);
    if (maximum == c.r) { hue = (c.g - c.b) / delta + select(0.0, 6.0, c.g < c.b); }
    else if (maximum == c.g) { hue = (c.b - c.r) / delta + 2.0; }
    else { hue = (c.r - c.g) / delta + 4.0; }
    hue /= 6.0;
  }
  return vec3<f32>(hue, saturation, lightness);
}
fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
  if (hsl.y < 0.00001) { return vec3<f32>(hsl.z); }
  let q = select(hsl.z * (1.0 + hsl.y), hsl.z + hsl.y - hsl.z * hsl.y, hsl.z >= 0.5);
  let p = 2.0 * hsl.z - q;
  return vec3<f32>(hueToRgb(p, q, hsl.x + 0.333333333), hueToRgb(p, q, hsl.x), hueToRgb(p, q, hsl.x - 0.333333333));
}`;

const SIZZLE_HELPERS = `
fn sizzleHash(source: vec3<f32>) -> f32 {
  var p = fract(source * 0.3183099 + vec3<f32>(0.1));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
fn sizzleNoise(source: vec3<f32>) -> f32 {
  let i = floor(source);
  var f = fract(source);
  f = f * f * (vec3<f32>(3.0) - 2.0 * f);
  return mix(
    mix(mix(sizzleHash(i), sizzleHash(i + vec3<f32>(1.0, 0.0, 0.0)), f.x), mix(sizzleHash(i + vec3<f32>(0.0, 1.0, 0.0)), sizzleHash(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(sizzleHash(i + vec3<f32>(0.0, 0.0, 1.0)), sizzleHash(i + vec3<f32>(1.0, 0.0, 1.0)), f.x), mix(sizzleHash(i + vec3<f32>(0.0, 1.0, 1.0)), sizzleHash(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}`;
