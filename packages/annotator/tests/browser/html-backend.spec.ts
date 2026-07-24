import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixture/");
});

test("aligns the overlay to a CSS-scaled canvas and applies semantics", async ({ page }) => {
  const root = page.locator(".litools-annotator-root");
  await expect(root).toHaveCSS("left", "20px");
  await expect(root).toHaveCSS("top", "10px");
  await expect(root).toHaveCSS("width", "200px");
  await expect(root).toHaveCSS("height", "100px");

  const label = page.locator('[data-annotation-type="label"]');
  await expect(label).toHaveText("Pump A-12");
  await expect(label).toHaveAttribute("aria-label", "Pump A-12 status");
  await expect(label).toHaveAttribute("role", "note");
  await expect(label).toHaveClass(/fixture-label/);
  const center = await label.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(center).toEqual({ x: 160, y: 90 });
});

test("renders dot/ring geometry and cleans up every owned node", async ({ page }) => {
  const ring = page.locator('[data-marker-shape="ring"]');
  await expect(ring).toHaveCSS("width", "18px");
  await expect(ring).toHaveCSS("height", "18px");
  await expect(ring).toHaveCSS("border-top-width", "2px");
  await page.evaluate(() => window.annotatorFixture.dispose());
  await expect(page.locator(".litools-annotator-root")).toHaveCount(0);
});

test("realigns after canvas CSS resize without using backing-store pixels", async ({ page }) => {
  await page.locator("#canvas").evaluate((canvas) => {
    canvas.style.width = "240px";
    canvas.style.height = "120px";
  });
  await page.evaluate(() => window.annotatorFixture.align());
  const root = page.locator(".litools-annotator-root");
  await expect(root).toHaveCSS("width", "240px");
  await expect(root).toHaveCSS("height", "120px");
});

test("matches the label and marker visual baseline", async ({ page }) => {
  await expect(page.locator("#container")).toHaveScreenshot("label-marker-overlay.png");
});
