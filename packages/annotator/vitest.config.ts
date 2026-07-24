import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@litools/instancer": fileURLToPath(new URL("../../src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts"]
  }
});
