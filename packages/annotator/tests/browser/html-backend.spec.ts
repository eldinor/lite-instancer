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
  await expect(label).toHaveCSS("transition-property", "opacity");
  await expect(label).toHaveCSS("transition-duration", "0.18s");
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

test("activates labels by pointer and keyboard without enabling markers", async ({ page }) => {
  const label = page.locator('[data-annotation-type="label"]');
  const marker = page.locator('[data-annotation-type="marker"]');
  await expect(label).toHaveCSS("pointer-events", "auto");
  await expect(label).toHaveAttribute("tabindex", "0");
  await expect(marker).toHaveCSS("pointer-events", "none");

  await label.click();
  await label.press("Enter");
  await label.press("Space");
  await expect.poll(() => page.evaluate(() => window.annotatorFixture.activations())).toEqual([
    { id: 1, eventType: "click" },
    { id: 1, eventType: "keydown" },
    { id: 1, eventType: "keydown" }
  ]);
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

test("reuses measured geometry for position-only updates", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.annotatorFixture.measureLabel();
    const element = document.querySelector<HTMLElement>('[data-annotation-type="label"]')!;
    const original = element.getBoundingClientRect.bind(element);
    let elementMeasurements = 0;
    element.getBoundingClientRect = () => {
      elementMeasurements++;
      return original();
    };
    const bounds = window.annotatorFixture.moveLabel(120, 60);
    return {
      elementMeasurements,
      bounds
    };
  });

  expect(result.elementMeasurements).toBe(0);
  const box = await page.locator('[data-annotation-type="label"]').boundingBox();
  expect(box).not.toBeNull();
  expect(result.bounds).toEqual(expect.objectContaining({
    x: box!.x - 60,
    y: box!.y - 40,
    width: box!.width,
    height: box!.height
  }));
});

test("remeasures after label content changes", async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = window.annotatorFixture.measureLabel();
    const element = document.querySelector<HTMLElement>('[data-annotation-type="label"]')!;
    const original = element.getBoundingClientRect.bind(element);
    let elementMeasurements = 0;
    element.getBoundingClientRect = () => {
      elementMeasurements++;
      return original();
    };
    const after = window.annotatorFixture.changeLabelText("Pump A-12 with a much longer live value");
    return { before, after, elementMeasurements };
  });

  expect(result.elementMeasurements).toBe(1);
  expect(result.after!.width).toBeGreaterThan(result.before!.width);
});

test("matches the label and marker visual baseline", async ({ page }) => {
  await expect(page.locator("#container")).toHaveScreenshot("label-marker-overlay.png");
});
