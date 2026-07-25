import type {
  AnimationGroup,
  AnimationManager,
  EngineContext,
  SceneContext
} from "@babylonjs/lite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => {
  const owners = new WeakMap<object, object>();
  return {
    createAnimationManager: ({ engine }: { engine: unknown }) => ({
      animations: [],
      fixedDeltaMs: 0,
      running: false,
      engine,
      groups: []
    }),
    addAnimationGroup: (manager: { groups: TestGroup[] }, group: TestGroup) => {
      const owner = owners.get(group);
      if (owner && owner !== manager) throw new Error("already attached");
      if (!owner) {
        owners.set(group, manager);
        manager.groups.push(group);
      }
    },
    removeAnimationGroup: (manager: { groups: TestGroup[] }, group: TestGroup) => {
      const index = manager.groups.indexOf(group);
      if (index >= 0) manager.groups.splice(index, 1);
      if (owners.get(group) === manager) owners.delete(group);
    },
    enableAnimationBlending: vi.fn(),
    updateAnimationManager: (manager: { groups: TestGroup[] }, deltaMs: number) => {
      for (const group of manager.groups) {
        if (!group.isPlaying) continue;
        group.currentTime += (deltaMs / 1000) * group.speedRatio;
        if (group.loopAnimation && group.duration > 0) {
          group.currentTime %= group.duration;
        } else {
          group.currentTime = Math.min(group.currentTime, group.duration);
        }
      }
    },
    playAnimation: (group: TestGroup) => {
      group.isPlaying = true;
    },
    pauseAnimation: (group: TestGroup) => {
      group.isPlaying = false;
    },
    stopAnimation: (group: TestGroup) => {
      group.isPlaying = false;
    },
    setAnimationWeight: (group: TestGroup, weight: number) => {
      group.weight = weight;
    },
    goToFrame: (group: TestGroup, frame: number) => {
      group.currentTime = frame / (group.frameRate || 60);
      group.isPlaying = false;
    },
    onBeforeRender: (
      scene: { _beforeRender: Array<(deltaMs: number) => void> },
      callback: (deltaMs: number) => void
    ) => {
      scene._beforeRender.unshift(callback);
    }
  };
});

import {
  AnimatorError,
  createAnimator,
  createClipRegistry,
  defineAnimationMarkers,
  disposeAnimator,
  getActivePlaybacks,
  getAnimatorSnapshot,
  marker,
  onAnimationMarker,
  onAnimatorEvent,
  pauseAnimator,
  playAnimation,
  resumeAnimator,
  setPlaybackNormalizedTime,
  updateAnimator
} from "../src/index.js";

interface TestGroup extends AnimationGroup {
  currentTime: number;
  isPlaying: boolean;
  speedRatio: number;
  loopAnimation: boolean;
  weight: number;
}

const engine = {} as EngineContext;
let target: object;

beforeEach(() => {
  target = {};
});

describe("clip registry", () => {
  it("registers source names and semantic aliases", () => {
    const idle = group("Idle");
    const registry = createClipRegistry([idle], { aliases: { idle: "Idle" } });
    expect(registry.entries.map((entry) => entry.id)).toEqual(["Idle", "idle"]);
  });

  it("rejects duplicate names and aliases to unknown sources", () => {
    expect(() => createClipRegistry([group("Idle"), group("Idle")])).toThrow(
      AnimatorError
    );
    expect(() =>
      createClipRegistry([group("Idle")], { aliases: { walk: "Walk" } })
    ).toThrow(/unknown source/i);
  });
});

describe("playback lifecycle", () => {
  it("stops Babylon Lite's auto-started glTF group during initialization", () => {
    const autoStarted = group("ImportedDefault");
    autoStarted.isPlaying = true;
    const idle = group("Idle");
    const animator = manualAnimator([autoStarted, idle]);

    expect(autoStarted.isPlaying).toBe(false);
    expect(autoStarted.weight).toBe(0);
    expect(getActivePlaybacks(animator)).toHaveLength(0);

    playAnimation(animator, "Idle", { loop: true });
    expect(idle.weight).toBe(1);
    expect(autoStarted.weight).toBe(0);
  });

  it("plays by alias and resolves non-looping completion", async () => {
    const animator = manualAnimator([group("Samba", 1)], { dance: "Samba" });
    const events: string[] = [];
    onAnimatorEvent(animator, (event) => events.push(event.type));

    const playback = playAnimation(animator, "dance");
    updateAnimator(animator, 0.4);
    expect(playback.state).toBe("playing");
    updateAnimator(animator, 0.6);

    await expect(playback.finished).resolves.toMatchObject({
      clipId: "dance",
      status: "completed",
      elapsed: 1
    });
    expect(events).toEqual(["started", "completed"]);
    expect(getActivePlaybacks(animator)).toHaveLength(0);
  });

  it("keeps looping playback pending until cancellation", async () => {
    const animator = manualAnimator([group("Idle", 1)]);
    const playback = playAnimation(animator, "Idle", { loop: true });
    updateAnimator(animator, 2.4);
    expect(playback.state).toBe("playing");
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.loopIndex).toBe(2);

    playback.cancel("test");
    await expect(playback.finished).resolves.toMatchObject({
      status: "cancelled",
      reason: "test"
    });
  });

  it("freezes playback while the animator is paused", () => {
    const animator = manualAnimator([group("Idle", 2)]);
    playAnimation(animator, "Idle", { loop: true });
    updateAnimator(animator, 0.5);
    pauseAnimator(animator);
    updateAnimator(animator, 1);
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.time).toBeCloseTo(0.5);
    resumeAnimator(animator);
    updateAnimator(animator, 0.5);
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.time).toBeCloseTo(1);
  });

  it("supports silent normalized seeking", () => {
    const animator = manualAnimator([group("Run", 2)]);
    const markers: string[] = [];
    defineAnimationMarkers(animator, "Run", [marker("step", { normalizedTime: 0.25 })]);
    onAnimationMarker(animator, "step", (event) => markers.push(event.markerId));
    const playback = playAnimation(animator, "Run", { loop: true });

    setPlaybackNormalizedTime(playback, 0.75);
    expect(markers).toEqual([]);
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.time).toBeCloseTo(1.5);
  });

  it("cancels immediately for an already-aborted signal", async () => {
    const animator = manualAnimator([group("Action")]);
    const controller = new AbortController();
    controller.abort("gone");
    const playback = playAnimation(animator, "Action", { signal: controller.signal });
    await expect(playback.finished).resolves.toMatchObject({
      status: "cancelled",
      reason: "gone"
    });
  });

  it("cancels active handles and becomes inert on disposal", async () => {
    const animator = manualAnimator([group("Idle")]);
    const playback = playAnimation(animator, "Idle", { loop: true });
    disposeAnimator(animator);
    disposeAnimator(animator);
    await expect(playback.finished).resolves.toMatchObject({
      status: "cancelled",
      reason: "animator-disposed"
    });
    expect(() => updateAnimator(animator, 0.1)).toThrow(/disposed/i);
  });
});

describe("crossfades", () => {
  it("synchronizes cyclic destinations to the dominant source normalized time", () => {
    const walk = group("Walk", 2);
    const run = group("Run", 1);
    const animator = manualAnimator([walk, run]);
    playAnimation(animator, "Walk", { loop: true });
    updateAnimator(animator, 0.5);

    playAnimation(animator, "Run", {
      loop: true,
      interruption: "crossfade",
      fadeIn: 0.4,
      syncNormalizedTime: true
    });

    expect(walk.currentTime).toBeCloseTo(0.5);
    expect(run.currentTime).toBeCloseTo(0.25);
    expect(
      getAnimatorSnapshot(animator).activePlaybacks.find(
        (playback) => playback.clipId === "Run"
      )?.normalizedTime
    ).toBeCloseTo(0.25);
  });

  it("rejects phase synchronization combined with an explicit start time", () => {
    const animator = manualAnimator([group("Walk")]);
    expect(() =>
      playAnimation(animator, "Walk", {
        syncNormalizedTime: true,
        normalizedTime: 0.5
      })
    ).toThrow(/cannot be combined/i);
  });

  it("blends linearly and settles the outgoing handle at completion", async () => {
    const idle = group("Idle");
    const walk = group("Walk");
    const animator = manualAnimator([idle, walk]);
    const idlePlayback = playAnimation(animator, "Idle", { loop: true });
    playAnimation(animator, "Walk", {
      loop: true,
      interruption: "crossfade",
      fadeIn: 1
    });

    updateAnimator(animator, 0.5);
    expect(idle.weight).toBeCloseTo(0.5);
    expect(walk.weight).toBeCloseTo(0.5);
    updateAnimator(animator, 0.5);
    expect(walk.weight).toBeCloseTo(1);
    await expect(idlePlayback.finished).resolves.toMatchObject({
      status: "interrupted",
      reason: "crossfade"
    });
  });

  it("starts a third transition from current normalized weights", () => {
    const idle = group("Idle");
    const walk = group("Walk");
    const run = group("Run");
    const animator = manualAnimator([idle, walk, run]);
    playAnimation(animator, "Idle", { loop: true });
    playAnimation(animator, "Walk", {
      loop: true,
      interruption: "crossfade",
      fadeIn: 1
    });
    updateAnimator(animator, 0.5);
    playAnimation(animator, "Run", {
      loop: true,
      interruption: "crossfade",
      fadeIn: 1
    });
    updateAnimator(animator, 0.5);

    expect(idle.weight).toBeCloseTo(0.25);
    expect(walk.weight).toBeCloseTo(0.25);
    expect(run.weight).toBeCloseTo(0.5);
    expect(idle.weight + walk.weight + run.weight).toBeCloseTo(1);
  });

  it("does not advance weights while paused", () => {
    const idle = group("Idle");
    const walk = group("Walk");
    const animator = manualAnimator([idle, walk]);
    playAnimation(animator, "Idle", { loop: true });
    playAnimation(animator, "Walk", {
      loop: true,
      interruption: "crossfade",
      fadeIn: 1
    });
    updateAnimator(animator, 0.25);
    pauseAnimator(animator);
    updateAnimator(animator, 0.5);
    expect(walk.weight).toBeCloseTo(0.25);
  });

  it("rejects groups without shared targets", () => {
    const idle = group("Idle");
    const other = group("Other", 1, {});
    const animator = manualAnimator([idle, other]);
    playAnimation(animator, "Idle", { loop: true });
    expect(() =>
      playAnimation(animator, "Other", {
        interruption: "crossfade",
        fadeIn: 1
      })
    ).toThrow(/do not share animation targets/i);
  });
});

describe("markers and scene updates", () => {
  it("dispatches every crossed marker in chronological loop order", () => {
    const animator = manualAnimator([group("Run", 1)]);
    defineAnimationMarkers(animator, "Run", [
      marker("left", { normalizedTime: 0.2 }),
      marker("right", { normalizedTime: 0.7 }),
      marker("once", { normalizedTime: 0.4, once: true })
    ]);
    const received: string[] = [];
    for (const id of ["left", "right", "once"]) {
      onAnimationMarker(animator, id, (event) => {
        received.push(`${event.loopIndex}:${event.markerId}`);
      });
    }
    playAnimation(animator, "Run", { loop: true });
    updateAnimator(animator, 2.3);
    expect(received).toEqual([
      "0:left",
      "0:once",
      "0:right",
      "1:left",
      "1:right",
      "2:left"
    ]);
  });

  it("supports idempotent marker unsubscription", () => {
    const animator = manualAnimator([group("Run")]);
    defineAnimationMarkers(animator, "Run", [marker("step", { normalizedTime: 0.2 })]);
    const listener = vi.fn();
    const unsubscribe = onAnimationMarker(animator, "step", listener);
    unsubscribe();
    unsubscribe();
    playAnimation(animator, "Run");
    updateAnimator(animator, 0.5);
    expect(listener).not.toHaveBeenCalled();
  });

  it("registers and removes its scene callback", () => {
    const callbacks: Array<(deltaMs: number) => void> = [];
    const scene = { _beforeRender: callbacks } as unknown as SceneContext;
    const animator = createAnimator({
      engine,
      clips: [group("Idle")],
      update: { mode: "scene", scene }
    });
    expect(callbacks).toHaveLength(1);
    playAnimation(animator, "Idle", { loop: true });
    callbacks[0]?.(500);
    expect(getAnimatorSnapshot(animator).activePlaybacks[0]?.time).toBeCloseTo(0.5);
    disposeAnimator(animator);
    expect(callbacks).toHaveLength(0);
  });

  it("prevents a group from being owned by two animators", () => {
    const shared = group("Idle");
    const first = manualAnimator([shared]);
    expect(() => manualAnimator([shared])).toThrow(/already owned/i);
    disposeAnimator(first);
    expect(() => manualAnimator([shared])).not.toThrow();
  });
});

function manualAnimator(
  groups: readonly AnimationGroup[],
  aliases?: Readonly<Record<string, string>>
) {
  return createAnimator({
    engine,
    clips: groups,
    ...(aliases ? { aliases } : {}),
    update: { mode: "manual" }
  });
}

function group(name: string, duration = 1, animationTarget = target): TestGroup {
  return {
    name,
    duration,
    frameRate: 60,
    isPlaying: false,
    currentTime: 0,
    targetedAnimations: [
      {
        target: animationTarget,
        targetName: "Root",
        nodeIndex: 0,
        path: "rotation"
      }
    ],
    speedRatio: 1,
    loopAnimation: true,
    weight: 1
  };
}

type TestManager = AnimationManager & { groups: TestGroup[] };
void ({} as TestManager);
