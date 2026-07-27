import { createLabel, createMarker, updateMarker, type MarkerHandle } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

const palette = ["#5bf0bd", "#72e6ff", "#ffc766"] as const;

export function configureAnimatedGpuMarkers(context: TextDemoContext): void {
  context.panel.describe("Sprite FX pulses every marker on the GPU; the CPU only projects anchors and handles occasional control changes.");
  const pulsing: Array<{ marker: MarkerHandle; phase: number; ring: boolean }> = [];
  let speed = 1;
  let running = true;

  for (let index = 0; index < 15; index++) {
    const angle = index / 15 * Math.PI * 2;
    const position = [Math.cos(angle) * 4.8, Math.sin(angle * 2) * 0.7 + 0.35, Math.sin(angle) * 4.8] as const;
    const color = palette[index % palette.length]!;
    const ring = index % 5 === 0;
    const phase = index / 15;
    const marker = createMarker(context.layer, {
      anchor: { kind: "world", position },
      shape: ring ? "ring" : "dot",
      size: ring ? 30 : 18,
      animation: pulse(phase, ring),
      style: ring ? { color, borderWidth: 3 } : { color }
    });
    pulsing.push({ marker, phase, ring });
  }
  createLabel(context.layer, {
    anchor: { kind: "world", position: [0, 2.8, 0] },
    text: "Live GPU marker signals",
    style: { color: "#ffffff", fontSize: 22 }
  });

  context.panel.button("Pause / resume", () => {
    running = !running;
    applyAnimations();
  });
  const speedButton = context.panel.button("Speed ×1", () => {
    speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
    speedButton.textContent = `Speed ×${speed}`;
    applyAnimations();
  });
  context.frame(() => {
    const stats = context.backend.getStats();
    context.panel.status(`${running ? "GPU pulse running" : "paused"} · ${stats.liveAnimatedMarkers} animated · ${stats.markerDrawCalls} draw call`);
  });

  function applyAnimations(): void {
    for (const entry of pulsing) {
      updateMarker(entry.marker, { animation: running ? pulse(entry.phase, entry.ring) : null });
    }
  }

  function pulse(phase: number, ring: boolean) {
    return {
      type: "pulse" as const,
      frequency: (ring ? 1.7 : 0.8) * speed,
      phase,
      minOpacity: ring ? 0.08 : 0.35,
      maxOpacity: 1
    };
  }
}
