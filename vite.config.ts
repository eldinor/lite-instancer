import { defineConfig } from "vite";

export default defineConfig({
  // `public/` contains example-only GLBs. The separate examples build copies
  // them to `examples-dist`; publishing them with the library would make every
  // npm consumer download demo assets they never import.
  publicDir: false,
  build: {
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
