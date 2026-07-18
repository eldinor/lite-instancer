import { describe, expect, it } from "vitest";
import { buildOutlineShaderSources } from "../src/outline-shader.js";

describe("outline WGSL generation", () => {
  it("keeps disabled effect fields out of the shader", () => {
    const source = buildOutlineShaderSources({
      pulse: false,
      colorCycle: false,
      edgeFlow: false,
      rimFlow: false,
      sizzle: false
    });
    expect(source.vertex).toContain("shaderSystem.world * instanceWorld");
    expect(source.fragment).not.toContain("sizzleNoise");
    expect(source.fragment).not.toContain("cyclePeriod");
  });

  it("emits all effect paths and opaque output", () => {
    const source = buildOutlineShaderSources({
      pulse: true,
      colorCycle: true,
      edgeFlow: true,
      rimFlow: true,
      sizzle: true
    });
    expect(source.vertex).toContain("flowCoordinate");
    expect(source.fragment).toContain("rgbToHsl");
    expect(source.fragment).toContain("atan2");
    expect(source.fragment).toContain("sizzleNoise");
    expect(source.fragment).toContain("vec4<f32>(color, 1.0)");
  });

  it("emits four- and eight-influence skeleton deformation", () => {
    const effects = { pulse: false, colorCycle: false, edgeFlow: false, rimFlow: false, sizzle: false };
    const four = buildOutlineShaderSources(effects, { hasEightInfluences: false });
    const eight = buildOutlineShaderSources(effects, { hasEightInfluences: true });

    expect(four.vertex).toContain("outlineBones[offset]");
    expect(four.vertex).toContain("outlineSkinMatrix(input)");
    expect(four.vertex).not.toContain("input.joints1");
    expect(eight.vertex).toContain("input.joints1");
    expect(eight.vertex).toContain("shaderSystem.world * instanceWorld * influence");
  });
});
