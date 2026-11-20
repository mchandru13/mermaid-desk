import { expect, test } from "@playwright/test";

/**
 * Export quality checks.
 *
 * A dark-theme diagram used to export as light text on a transparent
 * background (1.18:1 contrast on white), and Mermaid's padded viewBox left the
 * artwork slightly off-centre and clipped at the top.
 */

async function exportSvg(page: import("@playwright/test").Page) {
  await page.locator('[data-testid="export-menu"]').click();
  await page.getByRole("menuitem", { name: /Export SVG…/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".svg");
  return page.evaluate(() => window.__MERMAIDDESK_TEST__?.getLastExport() ?? null);
}

test("SVG export carries a readable background and tight bounds", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="preview-canvas"] svg').waitFor({ timeout: 30_000 });

  // Force dark theme: light text on a transparent background was the bug.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== "dark") {
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(500);
  }

  // Use the pie template: its dark theme text is light, and its Mermaid viewBox
  // includes padded/asymmetric bounds.
  await page.locator('[data-testid="templates-button"]').click();
  await page.locator(".template-item", { hasText: "Pie chart" }).first().click();
  await page.locator('[data-testid="insert-template"]').click();
  await page.locator('[data-testid="preview-canvas"] svg').waitFor();
  await page.waitForTimeout(500);

  const payload = await exportSvg(page);
  expect(payload, "the export reached the platform layer").not.toBeNull();
  expect(payload!.kind).toBe("svg");

  const parsed = await page.evaluate((data) => {
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.innerHTML = data;
    document.body.appendChild(host);

    const svg = host.querySelector("svg")!;
    // Measure the artwork, excluding the export background rect.
    const background = svg.querySelector("rect[data-export-background]")!;
    const measure = svg.cloneNode(true) as SVGSVGElement;
    measure.querySelector("rect[data-export-background]")?.remove();
    measure.setAttribute("width", svg.getAttribute("width") ?? "");
    measure.setAttribute("height", svg.getAttribute("height") ?? "");
    host.appendChild(measure);
    const box = measure.getBBox();
    measure.remove();

    const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
    const width = Number.parseFloat(svg.getAttribute("width") ?? "");
    const height = Number.parseFloat(svg.getAttribute("height") ?? "");

    const backgroundBox = background
      ? {
          x: Number(background.getAttribute("x")),
          y: Number(background.getAttribute("y")),
          width: Number(background.getAttribute("width")),
          height: Number(background.getAttribute("height")),
          fill: getComputedStyle(background).fill,
        }
      : null;

    const slice = svg.querySelector(".slice, text");
    const textFill = slice ? getComputedStyle(slice).fill : null;

    const result = {
      viewBox,
      width,
      height,
      bbox: { x: box.x, y: box.y, w: box.width, h: box.height },
      backgroundBox,
      textFill,
      hasScript: /<script/i.test(data),
      id: svg.getAttribute("id"),
    };
    host.remove();
    return result;
  }, payload!.data);

  // 16px padding around the ink on every side.
  const PADDING = 16;
  expect(parsed.viewBox[0]).toBeCloseTo(parsed.bbox.x - PADDING, 0);
  expect(parsed.viewBox[1]).toBeCloseTo(parsed.bbox.y - PADDING, 0);
  expect(parsed.viewBox[2]).toBeCloseTo(parsed.bbox.w + PADDING * 2, 0);
  expect(parsed.viewBox[3]).toBeCloseTo(parsed.bbox.h + PADDING * 2, 0);

  // The file must render at its intrinsic size, not stretch.
  expect(parsed.width).toBeCloseTo(parsed.viewBox[2], 0);
  expect(parsed.height).toBeCloseTo(parsed.viewBox[3], 0);

  // Opaque background aligned to the viewBox (not the old 0,0 origin).
  expect(parsed.backgroundBox).not.toBeNull();
  expect(parsed.backgroundBox!.x).toBeCloseTo(parsed.viewBox[0], 0);
  expect(parsed.backgroundBox!.y).toBeCloseTo(parsed.viewBox[1], 0);
  expect(parsed.backgroundBox!.width).toBeCloseTo(parsed.viewBox[2], 0);
  expect(parsed.backgroundBox!.height).toBeCloseTo(parsed.viewBox[3], 0);
  expect(parsed.backgroundBox!.fill).toBe("rgb(13, 17, 23)");

  // Light text on that dark background, never transparent-only.
  expect(parsed.textFill).toBe("rgb(230, 237, 243)");
  expect(parsed.hasScript).toBe(false);
  expect(parsed.id).toMatch(/^mermaid-desk-[a-z0-9]+$/);
});

test("transparent SVG export omits the background but keeps tight bounds", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="preview-canvas"] svg').waitFor({ timeout: 30_000 });

  await page.locator('[data-testid="templates-button"]').click();
  await page.locator(".template-item", { hasText: "Pie chart" }).first().click();
  await page.locator('[data-testid="insert-template"]').click();
  await page.locator('[data-testid="preview-canvas"] svg').waitFor();
  await page.waitForTimeout(400);

  await page.locator('[data-testid="export-menu"]').click();
  await page.getByRole("menuitem", { name: /Export SVG \(transparent\)/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".svg");
  const payload = await page.evaluate(() => window.__MERMAIDDESK_TEST__?.getLastExport() ?? null);

  expect(payload).not.toBeNull();
  expect(payload!.data).not.toContain("data-export-background");
  expect(payload!.data).toContain("<svg");
  // Still cropped to the artwork (16px padding), not Mermaid's padded viewBox.
  const viewBox = /viewBox="([^"]+)"/.exec(payload!.data)![1].split(/\s+/).map(Number);
  expect(viewBox[2]).toBeGreaterThan(0);
  expect(viewBox[2]).toBeLessThan(700);
});
