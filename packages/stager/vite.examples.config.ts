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
      { find: "@litools/stager/babylon", replacement: resolve(packageRoot, "src/babylon.ts") },
      { find: "@litools/stager/dom", replacement: resolve(packageRoot, "src/dom.ts") },
      { find: "@litools/stager", replacement: resolve(packageRoot, "src/index.ts") }
    ]
  },
  build: {
    outDir: resolve(packageRoot, "examples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(examplesRoot, "index.html"),
        navigation: resolve(examplesRoot, "navigation/index.html"),
        preloadProgress: resolve(examplesRoot, "preload-progress/index.html"),
        cancellationFailure: resolve(examplesRoot, "cancellation-failure/index.html"),
        resourceOwnership: resolve(examplesRoot, "resource-ownership/index.html"),
        domFade: resolve(examplesRoot, "dom-fade/index.html"),
        freeCamera: resolve(examplesRoot, "free-camera/index.html"),
        geospatialCamera: resolve(examplesRoot, "geospatial-camera/index.html"),
        activationRollback: resolve(examplesRoot, "activation-rollback/index.html")
      }
    }
  }
});
