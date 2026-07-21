import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Animation } from "@babylonjs/core/Animations/animation.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createVatAttachmentBinding } from "../src/vat-attachment-binding.js";
import { bakeVatSocketAsset } from "../src/vat-socket-babylon-baker.js";

describe("Babylon.js VAT socket integration", () => {
  it("bakes named nodes relative to the character root", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    const root = new TransformNode("character", scene);
    root.position.set(40, 0, 0);
    root.scaling.setAll(2);
    const hand = new TransformNode("RightHand", scene);
    hand.parent = root;

    const animation = new Animation("hand-x", "position.x", 10, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([{ frame: 0, value: 1 }, { frame: 2, value: 3 }]);
    const group = new AnimationGroup("Wave", scene);
    group.addTargetedAnimation(animation, hand);

    const asset = bakeVatSocketAsset(engine, [group], { root, sockets: { weapon: "RightHand" } });
    const track = asset.sockets.weapon?.Wave;
    expect(asset.space).toBe("gltf-rh-model-world");
    expect(asset.clips.Wave).toMatchObject({ fps: 10, frameCount: 3 });
    expect(Array.from(asset.basis)).toEqual([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(track?.translations[0]).toBeCloseTo(1);
    expect(track?.translations[6]).toBeCloseTo(3);
    engine.dispose();
  });

  it("creates a preset-backed rigid hierarchy attachment", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("sword-root", scene);
    const blade = new Mesh("blade", scene);
    blade.parent = root;
    const characters = {
      has: () => true,
      getVisible: () => true,
      getMatrix: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      getPlaybackSample: () => ({ clip: "Samba", timeSeconds: 0, offsetSeconds: 0, fps: 30, frame: 0, nextFrame: 0, alpha: 0 })
    };
    const binding = createVatAttachmentBinding({
      engine,
      character: characters,
      attachmentRoot: root,
      socketAsset: {
        version: 1,
        space: "babylon-model-world",
        basis: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        clips: { Samba: { name: "Samba", fps: 30, frameCount: 1, durationSeconds: 1 / 30 } },
        sockets: { weapon: { Samba: { translations: new Float32Array(3), rotations: new Float32Array([0, 0, 0, 1]), scales: new Float32Array([1, 1, 1]) } } }
      },
      preset: {
        version: 1,
        character: { kind: "url", url: "character.glb" },
        attachment: { kind: "url", url: "sword.glb" },
        socket: { key: "weapon", nodeIndex: 0, nodeName: "RightHand" },
        clipScope: "all",
        grip: { translation: [0, 1, 0], rotationEulerDegrees: [0, 0, 0], scale: [1, 1, 1] }
      },
      instanceOptions: { capacity: 1 }
    });
    const attachmentId = binding.create();
    expect(binding.bind(1 as never, attachmentId)).toBe(true);
    expect(binding.update()).toBe(1);
    expect(binding.attachments.getPosition(attachmentId)[1]).toBeCloseTo(1);
    binding.dispose();
    engine.dispose();
  });
});
