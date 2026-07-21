import { expect, test } from "playwright/test";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;

test.beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL("../../vite.examples.config.ts", import.meta.url)),
    server: { host: "127.0.0.1", port: 4174, strictPort: true }
  });
  await server.listen();
});

test.afterAll(async () => {
  await server.close();
});

async function expectRendered(page: import("playwright/test").Page, path: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await expect(page.locator("body")).toHaveAttribute("data-rendered", "true", { timeout: 20_000 });
  if (!path.includes("webgpu")) {
    const hasVisibleGeometry = await page.locator("#renderCanvas").evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) return false;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      const first = pixels.slice(0, 4);
      for (let offset = 4; offset < pixels.length; offset += 4) {
        if (pixels[offset] !== first[0] || pixels[offset + 1] !== first[1] || pixels[offset + 2] !== first[2]) return true;
      }
      return false;
    });
    expect(hasVisibleGeometry).toBe(true);

    const bounds = await page.locator("#renderCanvas").boundingBox();
    expect(bounds).not.toBeNull();
    const pickedLabels = new Set<string>();
    for (const xFactor of [0.413, 0.471, 0.529, 0.587]) {
      for (const yFactor of [0.411, 0.5, 0.582]) {
        await page.mouse.click(bounds!.x + bounds!.width * xFactor, bounds!.y + bounds!.height * yFactor);
        const match = (await page.locator("#status").textContent())?.match(/Selected (box-\d+)/);
        if (match?.[1]) pickedLabels.add(match[1]);
      }
    }
    expect(pickedLabels.size).toBe(12);

    const foregroundPixels = async () => page.locator("#renderCanvas").evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) return 0;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if ((pixels[offset] ?? 0) > 20 || (pixels[offset + 1] ?? 0) > 25 || (pixels[offset + 2] ?? 0) > 35) count++;
      }
      return count;
    });
    const beforeHide = await foregroundPixels();
    await page.locator("#toggle").click();
    await page.waitForTimeout(50);
    const whileHidden = await foregroundPixels();
    await page.locator("#toggle").click();
    await page.waitForTimeout(50);
    const afterShow = await foregroundPixels();
    expect(whileHidden).toBeLessThan(beforeHide);
    expect(afterShow).toBe(beforeHide);
  }
  await page.locator("#add").click();
  await expect(page.locator("#status")).toContainText("Added ID");
  expect(errors).toEqual([]);
}

test("renders and updates the example with WebGL", async ({ page }) => {
  await expectRendered(page, "/");
});

test("renders and updates the example with WebGPU when available", async ({ page }) => {
  const supported = await page.evaluate(() => "gpu" in navigator);
  if (!supported) test.skip(true, "WebGPU is unavailable in this Chromium environment");
  await expectRendered(page, "/?webgpu=1");
});
