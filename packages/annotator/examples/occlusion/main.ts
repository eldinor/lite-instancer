import {
  createLabel,
  getAnnotationSnapshot,
  updateLabel,
  type AnnotationOcclusionMode,
  type LabelCollisionMode,
  type LabelHandle
} from "@litools/annotator";
import { createBabylonDepthOcclusionProvider } from "@litools/annotator/babylon-occlusion";
import type { DemoContext } from "../shared/demo.js";

export function configureOcclusion(ctx: DemoContext): void {
  ctx.panel.describe(
    "Orbit to move targets behind the wall. Compare fade, hide, and off modes; transitions and two-sample hysteresis keep changes calm at edges."
  );

  const wall = ctx.addBox("Occluder", [0, 0.55, 0], [0.1, 0.22, 0.2], 1);
  wall.scaling.x = 5.2;
  wall.scaling.y = 4.3;
  wall.scaling.z = 0.55;

  const targets = [
    ctx.addBox("Unit A", [-4.1, -0.35, 2.8], [0.12, 0.58, 0.48], 1.7),
    ctx.addBox("Unit B", [-1.45, -0.35, 2.8], [0.16, 0.42, 0.72], 1.7),
    ctx.addBox("Unit C", [1.45, -0.35, 2.8], [0.72, 0.36, 0.12], 1.7),
    ctx.addBox("Unit D", [4.1, -0.35, 2.8], [0.52, 0.25, 0.68], 1.7)
  ];

  const provider = createBabylonDepthOcclusionProvider({
    scene: ctx.scene,
    camera: ctx.camera,
    canvas: ctx.canvas,
    sampleRadius: 1,
    minimumOccludingSamples: 3,
    enterHysteresis: 2,
    exitHysteresis: 2
  });
  const layer = ctx.recreateLayer("raf", undefined, provider);
  const labels: LabelHandle[] = targets.map((mesh, index) =>
    createLabel(layer, {
      anchor: { kind: "mesh", mesh, point: [0, 1.05, 0] },
      text: `Unit ${String.fromCharCode(65 + index)}`,
      occlusion: "fade",
      occludedOpacity: 0.25,
      occlusionBias: 0.0005,
      collision: "shift",
      collisionMaxShift: 48,
      leaderLine: true,
      style: {
        color: "#f4fffb",
        backgroundColor: "#081713ed",
        borderColor: "#58e6bd",
        borderWidth: 1,
        borderRadius: 7,
        padding: 7,
        opacityTransitionDuration: 180,
        className: "annotation-label"
      }
    })
  );

  const modes: readonly AnnotationOcclusionMode[] = ["fade", "hide", "none"];
  let modeIndex = 0;
  const modeButton = ctx.panel.button("Mode: fade", () => {
    modeIndex = (modeIndex + 1) % modes.length;
    const mode = modes[modeIndex]!;
    for (const label of labels) updateLabel(label, { occlusion: mode });
    modeButton.textContent = `Mode: ${mode === "none" ? "off" : mode}`;
  });

  const opacitySteps = [0.25, 0.5, 0.75] as const;
  let opacityIndex = 0;
  const opacityButton = ctx.panel.button("Fade: 25%", () => {
    opacityIndex = (opacityIndex + 1) % opacitySteps.length;
    const opacity = opacitySteps[opacityIndex]!;
    for (const label of labels) updateLabel(label, { occludedOpacity: opacity });
    opacityButton.textContent = `Fade: ${Math.round(opacity * 100)}%`;
  });

  const collisionModes: ReadonlyArray<
    Readonly<{ mode: LabelCollisionMode; label: string }>
  > = [
    { mode: "none", label: "Off" },
    { mode: "hide", label: "Hide" },
    { mode: "shift", label: "Shift" },
    { mode: "shift-x", label: "Shift X" },
    { mode: "shift-y", label: "Shift Y" },
    { mode: "radial", label: "Radial" },
    { mode: "cluster", label: "Cluster" },
    { mode: "repel", label: "Repel" }
  ];
  let collisionMode: LabelCollisionMode = "shift";
  for (const entry of collisionModes) {
    ctx.panel.button(entry.label, () => {
      collisionMode = entry.mode;
      for (const label of labels) updateLabel(label, { collision: collisionMode });
    });
  }

  let elapsed = 0;
  let statusElapsed = 0;
  ctx.frame((deltaMs) => {
    elapsed += deltaMs / 1000;
    statusElapsed += deltaMs;
    targets.forEach((mesh, index) => {
      mesh.position.y = -0.35 + Math.sin(elapsed * 1.15 + index * 0.8) * 0.16;
      mesh.rotation.y += deltaMs * (0.00008 + index * 0.000015);
    });
    if (statusElapsed < 250) return;
    statusElapsed = 0;
    const occluded = labels.filter(
      (label) => getAnnotationSnapshot(label).occluded
    ).length;
    const mode = modes[modeIndex]!;
    const stats = provider.getStats();
    ctx.panel.status(
      `${mode === "none" ? "off" : mode} · collision ${collisionMode} · ${labels.length - occluded} clear · ${occluded} occluded · ${stats.lastQueryCount} queries · ${stats.averageReadbackMs.toFixed(2)} ms avg`
    );
  });
}
