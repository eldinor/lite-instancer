import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      external: ["@babylonjs/lite"]
    },
    sourcemap: true
  }
});
