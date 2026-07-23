import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Animation } from "@babylonjs/core/Animations/animation.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Bone } from "@babylonjs/core/Bones/bone.js";
import { Skeleton } from "@babylonjs/core/Bones/skeleton.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  computeBabylonVatAssetIntegrity,
  decodeBabylonVatAsset,
  encodeBabylonVatAsset,
  type BabylonVatAsset
} from "../src/vat-asset.js";
import { bakeBabylonVatAsset, packBabylonVatAsset } from "../src/vat-asset-baker.js";
import { createVatInstanceSetFromAsset } from "../src/vat-instance-set.js";

function createFrameData(boneCount = 1, frameCount = 2): Float32Array {
  const data = new Float32Array((boneCount + 1) * 16 * frameCount);
  for (let offset = 0; offset < data.length; offset += 16) {
    data[offset] = 1;
    data[offset + 5] = 1;
    data[offset + 10] = 1;
    data[offset + 15] = 1;
  }
  return data;
}

function createAsset(): BabylonVatAsset {
  const frameData = createFrameData();
  return {
    version: 1,
    encoding: "babylon-matrix-vat",
    basis: "gltf-rh-model-world",
    boneCount: 1,
    frameCount: 2,
    texture: { width: 8, height: 2, format: "rgba32float" },
    clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
    frameData,
    bounds: {
      model: { min: [-1, -2, -1], max: [1, 2, 1] },
      clips: { Idle: { min: [-1, -1, -1], max: [1, 1, 1] } }
    },
    source: { generator: "vat-asset.test", name: "fixture" },
    integrity: computeBabylonVatAssetIntegrity(frameData)
  };
}

function createSkinnedMesh(name: string): { engine: NullEngine; scene: Scene; mesh: Mesh; bone: Bone } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera("camera", new Vector3(0, 0, -5), scene);
  const mesh = new Mesh(name, scene);
  const skeleton = new Skeleton(`${name}-skeleton`, `${name}-skeleton`, scene);
  const bone = new Bone("root", skeleton, null, Matrix.Identity());
  mesh.skeleton = skeleton;
  return { engine, scene, mesh, bone };
}

describe("Babylon.js VAT asset envelope", () => {
  it("round-trips deterministically without sharing payload storage", () => {
    const asset = createAsset();
    const first = encodeBabylonVatAsset(asset);
    const second = encodeBabylonVatAsset(asset);
    expect(first.manifest).toBe(second.manifest);
    expect(new Uint8Array(first.payload)).toEqual(new Uint8Array(second.payload));

    const decoded = decodeBabylonVatAsset(first.manifest, first.payload);
    expect(decoded).toMatchObject({
      encoding: "babylon-matrix-vat",
      boneCount: 1,
      frameCount: 2,
      clips: asset.clips,
      bounds: asset.bounds,
      source: asset.source
    });
    expect(decoded.frameData).toEqual(asset.frameData);
    expect(decoded.frameData.buffer).not.toBe(asset.frameData.buffer);
  });

  it("rejects malformed metadata, truncated payloads, and corruption", () => {
    const encoded = encodeBabylonVatAsset(createAsset());
    expect(() => decodeBabylonVatAsset(encoded.manifest, encoded.payload.slice(0, -4))).toThrow(/payload length/i);

    const wrongEncoding = JSON.parse(encoded.manifest) as Record<string, unknown>;
    wrongEncoding.encoding = "lite-matrix-rgba32float";
    expect(() => decodeBabylonVatAsset(JSON.stringify(wrongEncoding), encoded.payload)).toThrow(/encoding/i);

    const corrupt = encoded.payload.slice(0);
    const corruptBytes = new Uint8Array(corrupt);
    corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 1;
    expect(() => decodeBabylonVatAsset(encoded.manifest, corrupt)).toThrow(/integrity/i);

    const missingTexture = JSON.parse(encoded.manifest) as Record<string, unknown>;
    delete missingTexture.texture;
    expect(() => decodeBabylonVatAsset(JSON.stringify(missingTexture), encoded.payload)).toThrow(/texture/i);
  });

  it("enforces preprocessing allocation limits before packing", () => {
    expect(() => packBabylonVatAsset({
      boneCount: 1,
      clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
      frameData: createFrameData(),
      sourceBytes: 11
    }, {
      maxModelBytes: 10,
      maxBones: 1,
      maxFramesPerClip: 2,
      maxTotalFrames: 2,
      maxAtlasBytes: 512,
      maxAnimations: 1
    })).toThrow(/model bytes limit/i);
  });

  it("loads a decoded asset without replaying scene animation", () => {
    const { engine, scene, mesh } = createSkinnedMesh("asset-runtime");
    const render = vi.spyOn(scene, "render");
    const asset = createAsset();
    const vat = createVatInstanceSetFromAsset(engine, mesh, asset, { capacity: 2 });
    const id = vat.create({ offset: 0.25 });

    expect(render).not.toHaveBeenCalled();
    expect(vat.asset).toBe(asset);
    expect(vat.animatedBounds).toBe(asset.bounds);
    expect(vat.getPlaybackSample(id)).toMatchObject({ clip: "Idle", offsetSeconds: 0.25, fps: 30 });
    expect(mesh.bakedVertexAnimationManager).toBe(vat.handle.manager);

    vat.dispose();
    expect(mesh.bakedVertexAnimationManager).toBeNull();
    engine.dispose();
  });

  it("bakes Babylon animation groups into the same validated envelope", () => {
    const { engine, mesh, bone } = createSkinnedMesh("asset-bake");
    const render = vi.spyOn(mesh.getScene(), "render");
    const animation = new Animation("turn", "rotationQuaternion", 20, Animation.ANIMATIONTYPE_QUATERNION);
    animation.setKeys([
      { frame: 0, value: Quaternion.Identity() },
      { frame: 1, value: Quaternion.RotationAxis(Vector3.Up(), 0.25) }
    ]);
    bone.animations.push(animation);
    const group = new AnimationGroup("Turn", mesh.getScene());
    group.addTargetedAnimation(animation, bone);

    const asset = bakeBabylonVatAsset(mesh, [group], { source: { name: "animated.glb" } });
    expect(asset.clips.Turn).toEqual({ fromRow: 0, frameCount: 2, fps: 20 });
    expect(asset.texture).toEqual({ width: 8, height: 2, format: "rgba32float" });
    expect(asset.frameData).toHaveLength(64);
    expect(asset.integrity).toBe(computeBabylonVatAssetIntegrity(asset.frameData));
    expect(render).not.toHaveBeenCalled();
    engine.dispose();
  });
});
