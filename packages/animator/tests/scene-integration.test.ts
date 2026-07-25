import {
  addToScene,
  createAnimationManager,
  createPropertyAnimationClip,
  createPropertyAnimationGroup,
  removeAnimationGroup,
  type AssetContainer,
  type EngineContext,
  type SceneContext
} from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import {
  createAnimator,
  disposeAnimator,
  getAnimatorSnapshot,
  playAnimation
} from "../src/index.js";

describe("Babylon Lite scene integration", () => {
  it("advances a manager-owned group exactly once when the legacy scene hook also runs", () => {
    const engine = {} as EngineContext;
    const bootstrapManager = createAnimationManager({ engine });
    const target = { value: 0 };
    const clip = createPropertyAnimationClip("Move", [
      {
        path: "value",
        keys: [
          { time: 0, value: 0 },
          { time: 1, value: 1 }
        ]
      }
    ]);
    const group = createPropertyAnimationGroup(bootstrapManager, target, clip, {
      loop: true
    });
    removeAnimationGroup(bootstrapManager, group);

    const callbacks: Array<(deltaMs: number) => void> = [];
    const scene = {
      surface: { engine },
      animationGroups: [],
      _beforeRender: callbacks
    } as unknown as SceneContext;
    const container: AssetContainer = {
      entities: [],
      animationGroups: [group]
    };

    // This installs Babylon Lite's ordinary AssetContainer animation hook first.
    addToScene(scene, container);
    const animator = createAnimator({
      engine,
      clips: [group],
      update: { mode: "scene", scene }
    });
    playAnimation(animator, "Move", { loop: true });

    expect(callbacks).toHaveLength(2);
    for (const callback of [...callbacks]) callback(250);

    expect(group.currentTime).toBeCloseTo(0.25);
    expect(target.value).toBeCloseTo(0.25);
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.time).toBeCloseTo(0.25);

    disposeAnimator(animator);
    expect(callbacks).toHaveLength(1);
  });
});
