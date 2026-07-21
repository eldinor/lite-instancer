import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "examples/basic",
  resolve: {
    alias: {
      "@litools/instancer-babylonjs": resolve(__dirname, "src/index.ts")
    }
  },
  build: {
    outDir: "../../examples-dist",
    emptyOutDir: true
  }
});
