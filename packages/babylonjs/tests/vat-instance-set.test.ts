import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Animation } from "@babylonjs/core/Animations/animation.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createVatCharacterSet } from "../src/vat-character-set.js";
import { createVatInstanceSet } from "../src/vat-instance-set.js";

describe("Babylon.js VatInstanceSet", () => {
  it("keeps playback settings attached to stable IDs after compaction and growth", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    const mesh = new Mesh("vat-source", scene);
    const skeleton = new Skeleton("skeleton", "skeleton", scene);
    const bone = new Bone("root", skeleton, null, Matrix.Identity());
    mesh.skeleton = skeleton;

    const animation = new Animation(
      "sway",
      "rotationQuaternion",
      20,
      Animation.ANIMATIONTYPE_QUATERNION,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    animation.setKeys([
      { frame: 0, value: Quaternion.Identity() },
      { frame: 2, value: Quaternion.RotationAxis(Vector3.Forward(), 0.25) }
    ]);
    bone.animations.push(animation);
    const group = new AnimationGroup("Sway", scene);
    group.addTargetedAnimation(animation, bone);

    const vat = createVatInstanceSet(engine, mesh, [group], { capacity: 1, grow: "double" });
    const removed = vat.create({ offset: 0.1, fps: 10 });
    const survivor = vat.create({ offset: 0.35, fps: 12 });
    expect(vat.capacity).toBe(2);

    vat.remove(removed);
    expect(vat.getSlot(survivor)).toBe(0);
    expect(vat.getPlaybackSample(survivor)).toMatchObject({ clip: "Sway", offsetSeconds: 0.35, fps: 12 });

    vat.create({ offset: 0.5, fps: 16 });
    const grown = vat.create({ offset: 0.75, fps: 24 });
    expect(vat.capacity).toBe(4);
    expect(vat.getPlaybackSample(survivor)).toMatchObject({ offsetSeconds: 0.35, fps: 12 });
    expect(vat.getPlaybackSample(grown)).toMatchObject({ offsetSeconds: 0.75, fps: 24 });
    vat.dispose();
    engine.dispose();
  });

  it("keeps multi-part character visibility and slots synchronized", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    const root = new TransformNode("character-root", scene);
    const animatedNode = new TransformNode("animated-joint", scene);
    animatedNode.parent = root;
    animatedNode.rotationQuaternion = Quaternion.Identity();
    const body = new Mesh("body", scene);
    const equipment = new Mesh("equipment", scene);
    body.parent = root;
    equipment.parent = root;
    const skeleton = new Skeleton("shared-skeleton", "shared-skeleton", scene);
    const bone = new Bone("root", skeleton, null, Matrix.Identity());
    bone.linkTransformNode(animatedNode);
    body.skeleton = skeleton;
    equipment.skeleton = skeleton;

    const animation = new Animation(
      "idle",
      "rotationQuaternion",
      20,
      Animation.ANIMATIONTYPE_QUATERNION,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    animation.setKeys([
      { frame: 0, value: Quaternion.Identity() },
      { frame: 2, value: Quaternion.RotationAxis(Vector3.Forward(), 0.1) }
    ]);
    animatedNode.animations.push(animation);
    const group = new AnimationGroup("Idle", scene);
    group.addTargetedAnimation(animation, animatedNode);
    const bakedMatrices = new Set<string>();
    const getTransformMatrices = skeleton.getTransformMatrices.bind(skeleton);
    vi.spyOn(skeleton, "getTransformMatrices").mockImplementation((targetMesh) => {
      const matrices = getTransformMatrices(targetMesh);
      bakedMatrices.add(Array.from(matrices.subarray(0, 16), (value) => value.toFixed(4)).join(","));
      return matrices;
    });

    const characters = createVatCharacterSet<{ label: string }>(engine, root, [group], {
      capacity: 1,
      grow: "double",
      visibleStrategy: "active-count"
    });
    const first = characters.create({ offset: 0.1, metadata: { label: "first" } });
    const survivor = characters.create({ offset: 0.4, fps: 12, metadata: { label: "survivor" } });
    expect(body.thinInstanceCount).toBe(2);
    expect(equipment.thinInstanceCount).toBe(2);
    expect(bakedMatrices.size).toBeGreaterThan(1);

    characters.setVisible(survivor, false);
    expect(body.thinInstanceCount).toBe(1);
    expect(equipment.thinInstanceCount).toBe(1);
    characters.setVisible(survivor, true);
    characters.remove(first);
    expect(characters.primary.getSlot(survivor)).toBe(0);
    expect(characters.getSlot(survivor)).toBe(0);
    expect(Array.from(characters.ids())).toEqual([survivor]);
    expect(characters.getMetadata(survivor)).toEqual({ label: "survivor" });
    expect(characters.getPosition(survivor)).toEqual(new Float32Array([0, 0, 0]));
    expect(characters.getPlaybackSample(survivor)).toMatchObject({ offsetSeconds: 0.4, fps: 12 });
    expect(body.thinInstanceCount).toBe(1);
    expect(equipment.thinInstanceCount).toBe(1);
    characters.dispose();
    engine.dispose();
  });
});
