import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // `public/` contains example-only GLBs. Serve them during local development
  // so example URLs such as `/fantasy_sword.glb` resolve to binary assets, but
  // exclude them from the published library build.
  publicDir: command === "serve" ? "public" : false,
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        core: "src/core.ts",
        vat: "src/vat.ts",
        animation: "src/animation.ts",
        "vat-sockets": "src/vat-sockets.ts",
        outline: "src/outline.ts"
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: ["@babylonjs/lite"]
    },
    sourcemap: true
  }
}));
