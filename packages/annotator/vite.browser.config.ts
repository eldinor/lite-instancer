import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@litools/annotator/html", replacement: resolve(packageRoot, "src/html.ts") },
      { find: "@litools/annotator/instancer", replacement: resolve(packageRoot, "src/instancer.ts") },
      { find: "@litools/annotator", replacement: resolve(packageRoot, "src/index.ts") },
      { find: "@litools/instancer", replacement: resolve(packageRoot, "../../src/index.ts") }
    ]
  },
  server: {
    port: 4179,
    strictPort: true
  }
});
