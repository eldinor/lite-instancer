import { expect, test } from "@playwright/test";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-high-dpi", "Example smoke tests run once at DPR 1.");
});

test("example index presents all eight runnable demos", async ({ page }) => {
  await page.goto("/examples/");
  await expect(page.locator("h1")).toContainText("Annotator");
  await expect(page.locator(".example-card")).toHaveCount(8);
  await expect(page.locator(".example-grid")).toHaveScreenshot("annotator-example-index.png");
});

for (const example of [
  "labels",
  "markers",
  "dynamic",
  "instancer",
  "lifecycle",
  "collisions",
  "collision-stress",
  "occlusion"
] as const) {
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

test("depth occlusion switches between fade, hide, and off modes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/examples/occlusion/");
  await expect(page.locator("body")).toHaveAttribute("data-ready", /^(true|unsupported)$/, { timeout: 10_000 });
  if (await page.locator("body").getAttribute("data-ready") === "unsupported") {
    test.skip(true, "WebGPU is unavailable in this browser environment.");
  }
  await expect(page.locator(".status")).toHaveText(/\d clear · [1-4] occluded/, { timeout: 10_000 });
  const mode = page.getByRole("button", { name: "Mode: fade" });
  await mode.click();
  await expect(mode).toHaveText("Mode: hide");
  await mode.click();
  await expect(mode).toHaveText("Mode: off");
  await expect(page.locator(".status")).toContainText("4 clear · 0 occluded", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("collision example exposes every placement mode", async ({ page }) => {
  await page.goto("/examples/collisions/");
  await expect(page.locator("body")).toHaveAttribute("data-ready", /^(true|unsupported)$/, {
    timeout: 10_000
  });
  if (await page.locator("body").getAttribute("data-ready") === "unsupported") {
    test.skip(true, "WebGPU is unavailable in this browser environment.");
  }
  for (const name of ["Off", "Hide", "Shift", "Shift X", "Shift Y", "Radial", "Cluster", "Repel"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Shift Y", exact: true }).click();
  await expect(page.locator(".status")).toContainText("shift-y");
  await page.getByRole("button", { name: "Radial", exact: true }).click();
  await expect(page.locator(".status")).toContainText("radial");
});
