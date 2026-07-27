import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { EXAMPLES } from "./examples/shared/catalog.js";

const rootDir = dirname(fileURLToPath(import.meta.url));

const htmlInputs = {
  index: "index.html",
  ...Object.fromEntries(
    EXAMPLES.map((entry) => [entry.id, `examples/${entry.id}/index.html`])
  )
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
