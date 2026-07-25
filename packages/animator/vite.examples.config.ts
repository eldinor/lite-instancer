import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const examplesRoot = resolve(packageRoot, "examples");

export default defineConfig({
  root: examplesRoot,
  publicDir: resolve(packageRoot, "../../public"),
  resolve: {
    alias: [
      { find: "@litools/animator", replacement: resolve(packageRoot, "src/index.ts") }
    ]
  },
  build: {
    outDir: resolve(packageRoot, "examples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(examplesRoot, "index.html"),
        playback: resolve(examplesRoot, "playback-lab/index.html"),
        crossfade: resolve(examplesRoot, "crossfade-lab/index.html"),
        markers: resolve(examplesRoot, "marker-lab/index.html")
      }
    }
  }
});
