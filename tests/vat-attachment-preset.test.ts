import { describe, expect, it } from "vitest";
import { createVatAttachmentPreset, quaternionFromEulerDegrees, serializeVatAttachmentPreset } from "../src/vat-attachment-preset.js";

describe("VAT attachment presets", () => {
  it("serializes a detached, portable JSON preset", () => {
    const grip = { translation: [1, 2, 3] as [number, number, number], rotationEulerDegrees: [0, 90, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
    const preset = createVatAttachmentPreset({
      version: 1,
      character: { kind: "local-glb", fileName: "hero.glb" },
      attachment: { kind: "url", url: "/fantasy_sword.glb" },
      socket: { key: "weapon", nodeIndex: 8, nodeName: "RightHand" },
      clipScope: "all",
      grip
    });
    grip.translation[0] = 99;
    expect(preset.grip.translation).toEqual([1, 2, 3]);
    expect(JSON.parse(serializeVatAttachmentPreset(preset))).toMatchObject({ version: 1, clipScope: "all", socket: { nodeIndex: 8 } });
  });

  it("converts UI Euler degrees to an XYZW quaternion", () => {
    const rotation = quaternionFromEulerDegrees(0, 90, 0);
    expect(rotation[0]).toBeCloseTo(0);
    expect(rotation[1]).toBeCloseTo(Math.SQRT1_2);
    expect(rotation[2]).toBeCloseTo(0);
    expect(rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });
});
