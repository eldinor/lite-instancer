import { describe, expect, it } from "vitest";
import { getVatSocketCandidates, validateVatAttachmentPreset } from "../src/vat-socket-candidates.js";

const animations = [
  {
    targetedAnimations: [
      { nodeIndex: 3, targetName: "Hips" },
      { nodeIndex: 7, targetName: "RightHand" }
    ]
  },
  {
    targetedAnimations: [
      { nodeIndex: 7, targetName: "RightHand" },
      { nodeIndex: 11, targetName: "OnlyThisClip" }
    ]
  }
];

describe("VAT socket candidates", () => {
  it("returns only nodes animated by every clip", () => {
    expect(getVatSocketCandidates(animations)).toEqual([{ nodeIndex: 7, nodeName: "RightHand" }]);
  });

  it("rejects a preset when its node index or readable name no longer matches", () => {
    const valid = validateVatAttachmentPreset({
      version: 1,
      character: { kind: "url", url: "/hero.glb" },
      attachment: { kind: "url", url: "/sword.glb" },
      socket: { key: "weapon", nodeIndex: 7, nodeName: "RightHand" },
      clipScope: "all",
      grip: { translation: [0, 0, 0], rotationEulerDegrees: [0, 0, 0], scale: [1, 1, 1] }
    }, animations);
    const staleName = validateVatAttachmentPreset({
      version: 1,
      character: { kind: "url", url: "/hero.glb" },
      attachment: { kind: "url", url: "/sword.glb" },
      socket: { key: "weapon", nodeIndex: 7, nodeName: "OldRightHand" },
      clipScope: "all",
      grip: { translation: [0, 0, 0], rotationEulerDegrees: [0, 0, 0], scale: [1, 1, 1] }
    }, animations);

    expect(valid).toEqual({ valid: true, socket: { nodeIndex: 7, nodeName: "RightHand" } });
    expect(staleName).toMatchObject({ valid: false });
  });
});
