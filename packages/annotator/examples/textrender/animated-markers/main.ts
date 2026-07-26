import {
  createLabel,
  createMarker,
  setAnnotationVisible,
  updateMarker,
  type MarkerHandle
} from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

const palette = ["#5bf0bd", "#72e6ff", "#ffc766"] as const;

export function configureAnimatedGpuMarkers(context: TextDemoContext): void {
  context.panel.describe("Pulse, beacon, and blink effects update stable one-sprite marker slots without changing draw-call count.");
  const pulsing: Array<{ marker: MarkerHandle; phase: number; color: string }> = [];
  const blinking: MarkerHandle[] = [];
  for (let index = 0; index < 15; index++) {
    const angle = index / 15 * Math.PI * 2;
    const position = [Math.cos(angle) * 4.8, Math.sin(angle * 2) * 0.7 + 0.35, Math.sin(angle) * 4.8] as const;
    const color = palette[index % palette.length]!;
    const marker = createMarker(context.layer, {
      anchor: { kind: "world", position },
      shape: index % 5 === 0 ? "ring" : "dot",
      size: index % 5 === 0 ? 30 : 18,
      style: index % 5 === 0 ? { color, borderWidth: 3 } : { color }
    });
    if (index % 5 === 0) blinking.push(marker);
    else pulsing.push({ marker, phase: index * 0.72, color });
  }
  createLabel(context.layer, {
    anchor: { kind: "world", position: [0, 2.8, 0] },
    text: "Live GPU marker signals",
    style: { color: "#ffffff", fontSize: 22 }
  });

  let elapsed = 0;
  let speed = 1;
  let running = true;
  let previousBlink = true;
  context.panel.button("Pause / resume", () => { running = !running; });
  const speedButton = context.panel.button("Speed ×1", () => {
    speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
    speedButton.textContent = `Speed ×${speed}`;
  });
  context.frame((deltaMs) => {
    if (running) elapsed += deltaMs * 0.001 * speed;
    for (const entry of pulsing) {
      const wave = 0.5 + Math.sin(elapsed * 3 + entry.phase) * 0.5;
      updateMarker(entry.marker, {
        size: 14 + wave * 12,
        style: { color: entry.color, opacity: 0.45 + wave * 0.55 }
      });
    }
    const blink = Math.floor(elapsed * 2) % 2 === 0;
    if (blink !== previousBlink) {
      for (const marker of blinking) setAnnotationVisible(marker, blink);
      previousBlink = blink;
    }
    const stats = context.backend.getStats();
    context.panel.status(`${running ? "running" : "paused"} · ${stats.liveMarkers} markers · ${stats.markerDrawCalls} draw call`);
  });
}
