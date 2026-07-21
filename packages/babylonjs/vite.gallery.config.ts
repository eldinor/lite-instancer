import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "examples",
  publicDir: "../../../public",
  resolve: {
    alias: {
      "@litools/instancer-babylonjs": resolve(__dirname, "src/index.ts")
    }
  }
});
