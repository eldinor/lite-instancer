import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const examplesRoot = resolve(packageRoot, "examples");

export default defineConfig({
  root: examplesRoot,
  publicDir: false,
  resolve: {
    alias: [
      { find: "@litools/annotator/html", replacement: resolve(packageRoot, "src/html.ts") },
      { find: "@litools/annotator/textrender", replacement: resolve(packageRoot, "src/textrender.ts") },
      { find: "@litools/annotator/interaction", replacement: resolve(packageRoot, "src/interaction.ts") },
      { find: "@litools/annotator/instancer", replacement: resolve(packageRoot, "src/instancer.ts") },
      {
        find: "@litools/annotator/babylon-occlusion",
        replacement: resolve(packageRoot, "src/babylon-occlusion.ts")
      },
      { find: "@litools/annotator", replacement: resolve(packageRoot, "src/index.ts") },
      { find: "@litools/instancer", replacement: resolve(packageRoot, "../../src/index.ts") }
    ]
  },
  build: {
    outDir: resolve(packageRoot, "examples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(examplesRoot, "index.html"),
        labels: resolve(examplesRoot, "labels/index.html"),
        markers: resolve(examplesRoot, "markers/index.html"),
        dynamic: resolve(examplesRoot, "dynamic/index.html"),
        instancer: resolve(examplesRoot, "instancer/index.html"),
        lifecycle: resolve(examplesRoot, "lifecycle/index.html"),
        collisions: resolve(examplesRoot, "collisions/index.html"),
        collisionStress: resolve(examplesRoot, "collision-stress/index.html"),
        occlusion: resolve(examplesRoot, "occlusion/index.html"),
        textRenderer: resolve(examplesRoot, "textrender/index.html"),
        textRendererBasic: resolve(examplesRoot, "textrender/basic/index.html"),
        textRendererBackgrounds: resolve(examplesRoot, "textrender/backgrounds/index.html"),
        textRendererCallouts: resolve(examplesRoot, "textrender/callouts/index.html"),
        textRendererAnimatedMarkers: resolve(examplesRoot, "textrender/animated-markers/index.html"),
        textRendererMarkerShapes: resolve(examplesRoot, "textrender/marker-shapes/index.html"),
        textRendererMarkerBenchmark: resolve(examplesRoot, "textrender/marker-benchmark/index.html"),
        textRendererInteraction: resolve(examplesRoot, "textrender/interaction/index.html"),
        textRendererDynamic: resolve(examplesRoot, "textrender/dynamic/index.html"),
        textRendererCollisions: resolve(examplesRoot, "textrender/collisions/index.html"),
        textRendererStress: resolve(examplesRoot, "textrender/stress/index.html")
      }
    }
  }
});
