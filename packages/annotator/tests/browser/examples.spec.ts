import { expect, test } from "@playwright/test";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-high-dpi", "Example smoke tests run once at DPR 1.");
});

test("example index presents all five runnable demos", async ({ page }) => {
  await page.goto("/examples/");
  await expect(page.locator("h1")).toContainText("Annotator");
  await expect(page.locator(".example-card")).toHaveCount(5);
  await expect(page.locator(".example-grid")).toHaveScreenshot("annotator-example-index.png");
});

for (const example of ["labels", "markers", "dynamic", "instancer", "lifecycle"] as const) {
  test(`${example} example starts and renders annotations`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/examples/${example}/`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", /^(true|unsupported)$/, { timeout: 10_000 });
    const state = await page.locator("body").getAttribute("data-ready");
    if (state === "true") {
      await expect(page.locator(".litools-annotator-root")).toHaveCount(1);
      await expect(page.locator('[data-annotation-type="label"], [data-annotation-type="marker"]').first()).toBeVisible({
        timeout: 10_000
      });
    } else {
      await expect(page.locator(".status")).toHaveText("WebGPU unavailable");
      await expect(page.locator("body")).toHaveAttribute("data-error", /WebGPU adapter not available/);
    }
    expect(errors).toEqual([]);
  });
}
