import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Keep `public/` available to `npm run dev` for the examples, but do not
    // copy its example-only GLBs into the library package's `dist/` output.
    copyPublicDir: false,
    lib: {
      entry: {
        index: "src/index.ts",
        core: "src/core.ts",
        vat: "src/vat.ts",
        animation: "src/animation.ts",
        "vat-sockets": "src/vat-sockets.ts"
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
