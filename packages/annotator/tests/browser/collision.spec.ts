import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/collision-fixture/");
});

test("hides the lower-priority overlapping label and restores it after separation", async ({ page }) => {
  const lower = page.locator('[data-annotation-id="1"]');
  const higher = page.locator('[data-annotation-id="2"]');
  await expect(higher).toBeVisible();
  await expect(lower).toBeHidden();
  expect(await page.evaluate(() => window.collisionFixture.snapshots().map((snapshot) => ({
    rendered: snapshot.rendered,
    hiddenReason: snapshot.hiddenReason
  })))).toEqual([
    { rendered: false, hiddenReason: "collision" },
    { rendered: true, hiddenReason: "none" }
  ]);

  await page.evaluate(() => window.collisionFixture.separate());
  const separatedSnapshots = await page.evaluate(() => window.collisionFixture.snapshots().map((snapshot) => ({
    rendered: snapshot.rendered,
    hiddenReason: snapshot.hiddenReason,
    screenPosition: snapshot.screenPosition,
    bounds: snapshot.bounds?.toJSON()
  })));
  expect(separatedSnapshots).toEqual([
    expect.objectContaining({ rendered: true, hiddenReason: "none" }),
    expect.objectContaining({ rendered: true, hiddenReason: "none" })
  ]);
  await expect(lower).toBeVisible();
  await expect(higher).toBeVisible();
});

test("shifts an overlapping label and reports its final DOM placement", async ({ page }) => {
  await page.evaluate(() => window.collisionFixture.showShiftScenario());
  const obstacle = page.locator('[data-annotation-id="3"]');
  const shifted = page.locator('[data-annotation-id="4"]');
  await expect(obstacle).toBeVisible();
  await expect(shifted).toBeVisible();

  const snapshots = await page.evaluate(() => window.collisionFixture.shiftSnapshots().map((snapshot) => ({
    rendered: snapshot.rendered,
    layoutOffset: snapshot.layoutOffset,
    bounds: snapshot.bounds?.toJSON()
  })));
  expect(snapshots[1]).toEqual(expect.objectContaining({
    rendered: true,
    layoutOffset: expect.not.objectContaining({ x: 0, y: 0 })
  }));
  const boxes = await Promise.all([obstacle, shifted].map((locator) => locator.boundingBox()));
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  expect(rectanglesOverlap(boxes[0]!, boxes[1]!)).toBe(false);
  expect(snapshots[1]?.bounds).toEqual(expect.objectContaining({
    x: boxes[1]!.x,
    y: boxes[1]!.y,
    width: boxes[1]!.width,
    height: boxes[1]!.height
  }));

  const line = page.locator('[data-annotation-leader-line="4"]');
  await expect(line).toHaveAttribute("stroke", "#58e6bd");
  await expect(line).toHaveAttribute("stroke-width", "2");
  await expect(line).toHaveAttribute("opacity", "0.8");
  expect(await line.evaluate((element) => {
    const svgElement = element as SVGElement;
    const owner = svgElement.ownerSVGElement;
    return {
      display: getComputedStyle(element).display,
      x1: Number(element.getAttribute("x1")),
      y1: Number(element.getAttribute("y1")),
      x2: Number(element.getAttribute("x2")),
      y2: Number(element.getAttribute("y2")),
      layerBeforeLabel: owner ? Boolean(
        owner.compareDocumentPosition(
          document.querySelector('[data-annotation-id="4"]')!
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ) : false
    };
  })).toEqual(expect.objectContaining({
    display: "inline",
    x1: 200,
    y1: 100,
    layerBeforeLabel: true
  }));
});

test("removes leader lines with their annotation layer", async ({ page }) => {
  await page.evaluate(() => window.collisionFixture.showShiftScenario());
  await expect(page.locator('[data-annotation-leader-line="4"]')).toHaveCount(1);
  await page.evaluate(() => window.collisionFixture.dispose());
  await expect(page.locator('[data-annotation-leader-line]')).toHaveCount(0);
  await expect(page.locator(".litools-annotator-root")).toHaveCount(0);
});

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
