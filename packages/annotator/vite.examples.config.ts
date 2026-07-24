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
      { find: "@litools/annotator/instancer", replacement: resolve(packageRoot, "src/instancer.ts") },
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
        lifecycle: resolve(examplesRoot, "lifecycle/index.html")
      }
    }
  }
});
