import { addToScene, createBox, createStandardMaterial } from "@babylonjs/lite";
import { createInstanceSet, type InstanceId } from "@litools/instancer";
import {
  createLabel,
  invalidateAnnotation,
  type LabelHandle
} from "@litools/annotator";
import { createInstanceAnchor } from "@litools/annotator/instancer";
import type { DemoContext } from "../shared/demo.js";

interface CrateMetadata {
  name: string;
}

export function configureInstancer(ctx: DemoContext): void {
  const layer = ctx.layer!;
  ctx.panel.describe("Every label resolves a stable Instance ID each update—never a thin-instance slot.");

  const source = createBox(ctx.engine, 1.05);
  source.name = "Crate instances";
  const sourceMaterial = createStandardMaterial();
  sourceMaterial.diffuseColor = [0.15, 0.52, 0.68];
  sourceMaterial.specularColor = [0.04, 0.08, 0.08];
  source.material = sourceMaterial;
  addToScene(ctx.scene, source);
  const crates = createInstanceSet<CrateMetadata>(source, {
    capacity: 8,
    grow: "double",
    colors: true,
    engine: ctx.engine,
    visibleStrategy: "active-count"
  });
  const ids: InstanceId[] = [];
  const labels = new Map<InstanceId, LabelHandle>();
  for (let index = 0; index < 12; index++) {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const id = crates.create(
      { position: [column * 2 - 3, row * 1.65 - 0.7, 0] },
      { name: `Crate ${String(index + 1).padStart(2, "0")}` }
    );
    crates.setColor(id, [0.15 + column * 0.11, 0.48 + row * 0.09, 0.78, 1]);
    ids.push(id);
    const label = createLabel(layer, {
      anchor: createInstanceAnchor(crates, id, {
        preset: "top",
        localBounds: { minimum: [-0.525, -0.525, -0.525], maximum: [0.525, 0.525, 0.525] }
      }),
      text: () => crates.getMetadata(id)?.name ?? `ID ${Number(id)}`,
      screenOffset: [0, -7],
      maxDistance: 24,
      style: {
        color: "#eafaff",
        backgroundColor: "#0a171aeb",
        borderColor: "#71d7ff",
        borderWidth: 1,
        borderRadius: 5,
        padding: 4,
        fontSize: 11,
        className: "annotation-label annotation-label--cyan"
      }
    });
    labels.set(id, label);
  }

  let trackedId = ids[5]!;
  let hidden = false;
  ctx.panel.status(`tracking stable ID ${Number(trackedId)}`);
  ctx.panel.button("Hide / show tracked", () => {
    if (!crates.has(trackedId)) return;
    hidden = !hidden;
    crates.setVisible(trackedId, !hidden);
    ctx.panel.status(`${hidden ? "hidden" : "shown"} ID ${Number(trackedId)} · slot ${crates.getSlot(trackedId)}`);
  });
  ctx.panel.button("Compact another slot", () => {
    const removable = ids.find((id) => id !== trackedId && crates.has(id));
    if (removable === undefined) return;
    const before = crates.getSlot(trackedId);
    crates.remove(removable);
    const after = crates.getSlot(trackedId);
    ctx.panel.status(`tracked ID ${Number(trackedId)} stayed attached · slot ${before} → ${after}`);
  });
  ctx.panel.button("Rename tracked", () => {
    if (!crates.has(trackedId)) return;
    crates.setMetadata(trackedId, { name: `Priority ${Number(trackedId)}` });
    invalidateAnnotation(labels.get(trackedId)!);
    ctx.panel.status("metadata label invalidated");
  });
  ctx.panel.button("Remove tracked ID", () => {
    if (!crates.has(trackedId)) return;
    crates.remove(trackedId);
    ctx.panel.status("ID removed · annotation hides as anchor-unavailable on the next update");
  });
  ctx.panel.button("Force pool growth", () => {
    const previous = crates.capacity;
    let added = 0;
    while (crates.capacity === previous) {
      const index = ids.length + added;
      const id = crates.create(
        { position: [(index % 7) * 1.4 - 4.2, 4 + Math.floor(added / 7) * 1.3, 0] },
        { name: `Added ${index + 1}` }
      );
      crates.setColor(id, [0.86, 0.42, 0.18, 1]);
      added++;
    }
    ctx.panel.status(`capacity ${previous} → ${crates.capacity}; stable labels remain attached`);
  });

  ctx.cleanup(() => crates.dispose());
}
