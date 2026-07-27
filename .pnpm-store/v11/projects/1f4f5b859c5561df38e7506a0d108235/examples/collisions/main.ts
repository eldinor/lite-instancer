import {
  createLabel,
  getAnnotationSnapshot,
  updateLabel,
  type AnnotationId,
  type LabelCollisionMode,
  type LabelHandle
} from "@litools/annotator";
import {
  interpolateArcRotateCamera,
  type Mesh
} from "@babylonjs/lite";
import type { DemoContext } from "../shared/demo.js";

interface LineDemo {
  readonly name: "Short" | "Middle" | "Long";
  readonly column: number;
  readonly collisionPadding: number;
  readonly collisionMaxShift: number;
  readonly color: string;
  shiftedLabel?: LabelHandle;
}

export function configureCollisions(ctx: DemoContext): void {
  const labelTargets = new Map<AnnotationId, Mesh>();
  let focusController: AbortController | undefined;
  const layer = ctx.recreateLayer("raf", (annotationId) => {
    const mesh = labelTargets.get(annotationId);
    if (!mesh) return;
    focusController?.abort();
    focusController = new AbortController();
    void interpolateArcRotateCamera(
      ctx.camera,
      ctx.scene,
      { target: mesh.position },
      focusController.signal,
      { interpolationFactor: 0.08 }
    ).catch(() => {});
    ctx.panel.status(`focusing ${mesh.name}`);
  });
  ctx.cleanup(() => focusController?.abort());
  ctx.panel.describe(
    "Compare hiding, free or axis shifts, radial spread, count clusters, and repulsion. Fourteen cubes frame short, middle, and long leader lines; click a label to focus its cube."
  );

  const lineDemos: LineDemo[] = [
    {
      name: "Short",
      column: 0,
      collisionPadding: 0,
      collisionMaxShift: 72,
      color: "#71d7ff"
    },
    {
      name: "Middle",
      column: 3,
      collisionPadding: 22,
      collisionMaxShift: 120,
      color: "#9affdf"
    },
    {
      name: "Long",
      column: 6,
      collisionPadding: 50,
      collisionMaxShift: 168,
      color: "#ffc766"
    }
  ];
  const shiftedLabels: LabelHandle[] = [];
  const cubeColors = [
    [0.12, 0.58, 0.48],
    [0.16, 0.4, 0.7],
    [0.68, 0.38, 0.14]
  ] as const;

  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 7; column++) {
      const x = (column - 3) * 1.5;
      const y = -0.92 + row * 1.08;
      const z = row === 0 ? -0.72 + (column % 2) * 0.18 : 0.45 - (column % 2) * 0.18;
      const mesh = ctx.addBox(
        `Grid cube ${row * 7 + column + 1}`,
        [x, y, z],
        cubeColors[(row + column) % cubeColors.length]!,
        0.48
      );
      if (row !== 1) continue;
      const demo = lineDemos.find((candidate) => candidate.column === column);
      if (!demo) continue;

      const anchor = { kind: "mesh" as const, mesh, point: [0, 0.42, 0] as const };
      const anchorLabel = createLabel(layer, {
        anchor,
        text: `${demo.name} anchor`,
        zIndex: 200,
        clampToViewport: true,
        style: {
          color: "#b8c8c3",
          backgroundColor: "#0a1715e8",
          borderColor: "#365c51",
          borderWidth: 1,
          borderRadius: 5,
          padding: 5,
          fontSize: 11,
          className: "annotation-label"
        }
      });
      labelTargets.set(anchorLabel.id, mesh);
      demo.shiftedLabel = createLabel(layer, {
        anchor,
        text: `${demo.name} line`,
        collision: "shift",
        collisionPadding: demo.collisionPadding,
        collisionMaxShift: demo.collisionMaxShift,
        leaderLine: {
          color: demo.color,
          width: 2,
          opacity: 0.95,
          minLength: 4
        },
        zIndex: 100,
        clampToViewport: true,
        style: {
          color: "#f5fffc",
          backgroundColor: "#071411f2",
          borderColor: demo.color,
          borderWidth: 1,
          borderRadius: 6,
          padding: 6,
          className: "annotation-label"
        }
      });
      labelTargets.set(demo.shiftedLabel.id, mesh);
      shiftedLabels.push(demo.shiftedLabel);
    }
  }

  const modes: ReadonlyArray<Readonly<{ mode: LabelCollisionMode; label: string }>> = [
    { mode: "none", label: "Off" },
    { mode: "hide", label: "Hide" },
    { mode: "shift", label: "Shift" },
    { mode: "shift-x", label: "Shift X" },
    { mode: "shift-y", label: "Shift Y" },
    { mode: "radial", label: "Radial" },
    { mode: "cluster", label: "Cluster" },
    { mode: "repel", label: "Repel" }
  ];
  let activeMode: LabelCollisionMode = "shift";
  for (const entry of modes) ctx.panel.button(entry.label, () => {
    activeMode = entry.mode;
    const mode = entry.mode;
    for (const label of shiftedLabels) updateLabel(label, { collision: mode });
    updateStatus();
  });

  let statusElapsed = 0;
  ctx.frame((deltaMs) => {
    statusElapsed += deltaMs;
    if (statusElapsed >= 250) {
      statusElapsed = 0;
      updateStatus();
    }
  });

  function updateStatus(): void {
    const lengths = lineDemos.map((demo) => {
      const offset = demo.shiftedLabel
        ? getAnnotationSnapshot(demo.shiftedLabel).layoutOffset
        : null;
      return `${demo.name.toLowerCase()} ${offset ? Math.round(Math.hypot(offset.x, offset.y)) : 0}px`;
    });
    ctx.panel.status(`${activeMode} · ${lengths.join(" · ")}`);
  }
}
