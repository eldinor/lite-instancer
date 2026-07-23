import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("./examples", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
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
        lifecycle: resolve(root, "lifecycle/index.html")
      }
    }
  }
});
