import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

const htmlInputs = {
  index: "index.html",
  "basic-thin-instances": "examples/basic-thin-instances/index.html",
  "primitive-box-field": "examples/primitive-box-field/index.html",
  "primitive-sphere-cloud": "examples/primitive-sphere-cloud/index.html",
  "primitive-mixed-playground": "examples/primitive-mixed-playground/index.html",
  "visibility-layers": "examples/visibility-layers/index.html",
  "raw-batch-streaming": "examples/raw-batch-streaming/index.html",
  "boombox-grid": "examples/boombox-grid/index.html",
  "boombox-picker": "examples/boombox-picker/index.html",
  "boombox-rebuild-growth": "examples/boombox-rebuild-growth/index.html",
  "shark-school-shared-animation": "examples/shark-school-shared-animation/index.html",
  "shark-phase-buckets": "examples/shark-phase-buckets/index.html",
  "shark-clip-mixer": "examples/shark-clip-mixer/index.html",
  "dist-vat-acrobatic-plane": "examples/dist-vat-acrobatic-plane/index.html"
};

export default defineConfig({
  build: {
    outDir: "examples-dist",
    rollupOptions: {
      input: Object.fromEntries(
        Object.entries(htmlInputs).map(([name, file]) => [name, resolve(rootDir, file)])
      )
    }
  }
});
