import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        html: "src/html.ts",
        instancer: "src/instancer.ts",
        "babylon-occlusion": "src/babylon-occlusion.ts"
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: ["@babylonjs/lite", "@litools/instancer"]
    },
    sourcemap: true
  }
});
