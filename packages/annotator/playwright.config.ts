import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 1280, height: 720 }
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        deviceScaleFactor: 1,
        launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"] }
      }
    },
    {
      name: "chromium-high-dpi",
      use: {
        browserName: "chromium",
        deviceScaleFactor: 2,
        launchOptions: { args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"] }
      }
    }
  ]
});
