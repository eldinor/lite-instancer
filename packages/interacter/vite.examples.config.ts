import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("./examples", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^@litools\/instancer\/interacter$/,
        replacement: resolve(root, "../../../src/interacter.ts")
      },
      {
        find: /^@litools\/instancer$/,
        replacement: resolve(root, "../../../src/index.ts")
      }
    ]
  },
  build: {
    outDir: resolve(root, "../examples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        click: resolve(root, "click/index.html"),
        hover: resolve(root, "hover/index.html"),
        pointer: resolve(root, "pointer/index.html"),
        dispatch: resolve(root, "dispatch/index.html"),
        "drag-playground": resolve(root, "drag-playground/index.html"),
        lifecycle: resolve(root, "lifecycle/index.html"),
        "dist-consumer": resolve(root, "dist-consumer/index.html"),
        "static-glb-pick": resolve(root, "static-glb-pick/index.html"),
        "animated-glb-pick": resolve(root, "animated-glb-pick/index.html"),
        "ready-player-animated-pick": resolve(root, "ready-player-animated-pick/index.html"),
        "vat-detailed-pick": resolve(root, "vat-detailed-pick/index.html"),
        "instancer-adapter": resolve(root, "instancer-adapter/index.html"),
        stress: resolve(root, "stress/index.html"),
        "performance-diagnostics": resolve(root, "performance-diagnostics/index.html")
      }
    }
  }
});
