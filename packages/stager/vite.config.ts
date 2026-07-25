import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        dom: "src/dom.ts",
        babylon: "src/babylon.ts"
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: ["@babylonjs/lite"]
    },
    sourcemap: true
  }
});
