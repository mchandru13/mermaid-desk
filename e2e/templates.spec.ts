import { expect, test } from "@playwright/test";

/**
 * Every built-in template must render centred and inside the preview.
 *
 * Mermaid varies the root SVG between diagram types (`width="100%"`,
 * `max-width` styles, viewBoxes with negative or offset origins), and each
 * variation previously broke centring in a different way. This walks the
 * gallery so the whole set stays covered.
 */
const TEMPLATES = [
  "Flowchart",
  "Sequence diagram",
  "Class diagram",
  "State diagram",
  "Entity relationship",
  "Gantt chart",
  "Mind map",
  "Timeline",
  "Pie chart",
  "User journey",
  "Git graph",
  "C4 context",
  "XY chart",
  "Block diagram",
  "Sankey",
  "Treemap",
  "Packet diagram",
  "Architecture",
  "Kanban board",
];

interface TemplateGeometry {
  label: string;
  dx: number;
  dy: number;
  fits: boolean;
  widthAttr: string | null;
  style: string | null;
  painted: number;
  contentWidth: number;
  labels: string[];
  /** Mermaid's own type for the rendered drawing. */
  role: string | null;
}

test("centres and fits every built-in template", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="preview-canvas"] svg').waitFor({ timeout: 30_000 });

  const results: TemplateGeometry[] = [];

  for (const title of TEMPLATES) {
    const canvasSvg = page.locator('[data-testid="preview-canvas"] > svg');
    // `data-render-id` is stamped with a fresh nonce on every render, so waiting
    // for it to change is a real "this template has painted" signal. A fixed
    // sleep here measured the previous template whenever a lazy Mermaid chunk
    // was still arriving on a cold first load.
    const before = await canvasSvg.getAttribute("data-render-id");

    await page.locator('[data-testid="templates-button"]').click();
    // Match the title element, not the whole button: "Architecture" also
    // appears inside Block diagram's description, so hasText picked the wrong
    // template and the geometry assertions silently measured the previous one.
    await page
      .locator(".template-item", { has: page.locator("strong", { hasText: title }) })
      .first()
      .click();
    await page.locator('[data-testid="insert-template"]').click();
    await expect(canvasSvg).toBeVisible();
    await expect(canvasSvg).not.toHaveAttribute("data-render-id", before ?? "");
    await expect(page.locator('[data-testid="diagnostic"]')).toBeHidden();
    // The identifier changes when the SVG is replaced; give the layout one frame
    // to settle so the transform applied by the preview is included.
    await page.evaluate(() => new Promise(requestAnimationFrame));

    results.push(
      await page.evaluate((label) => {
        const viewport = document
          .querySelector('[data-testid="preview-viewport"]')!
          .getBoundingClientRect();
        const svg = document.querySelector(
          '[data-testid="preview-canvas"] svg',
        ) as SVGSVGElement;

        // Union of whatever Mermaid painted, ignoring defs/markers.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const element of svg.querySelectorAll("*")) {
          if (element.closest("defs") || element.closest("marker") || element.closest("style")) {
            continue;
          }
          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          minX = Math.min(minX, rect.x);
          minY = Math.min(minY, rect.y);
          maxX = Math.max(maxX, rect.right);
          maxY = Math.max(maxY, rect.bottom);
        }

        return {
          label,
          dx: (minX + maxX) / 2 - (viewport.x + viewport.width / 2),
          dy: (minY + maxY) / 2 - (viewport.y + viewport.height / 2),
          fits:
            maxX - minX <= viewport.width + 1 && maxY - minY <= viewport.height + 1,
          widthAttr: svg.getAttribute("width"),
          style: svg.getAttribute("style"),
          painted: svg.querySelectorAll("rect, path, circle, polygon, text").length,
          contentWidth: maxX - minX,
          labels: [...svg.querySelectorAll("g.node text, text")]
            .map((element) => element.textContent?.trim() ?? "")
            .filter(Boolean),
          role: svg.getAttribute("aria-roledescription"),
        };
      }, title),
    );
  }

  // Report every failure at once so a regression names the affected templates.
  const offCentre = results.filter(
    (entry) => Math.abs(entry.dx) > 2 || Math.abs(entry.dy) > 2,
  );
  const overflowing = results.filter((entry) => !entry.fits);
  expect(
    offCentre.map((entry) => `${entry.label} (dx=${entry.dx.toFixed(1)}, dy=${entry.dy.toFixed(1)})`),
    "templates must be centred on the drawn artwork",
  ).toEqual([]);
  expect(
    overflowing.map((entry) => entry.label),
    "templates must fit inside the preview",
  ).toEqual([]);

  // The root SVG must never keep Mermaid's percentage sizing, which decouples
  // the element's box from the drawing's aspect ratio.
  const percentage = results.filter((entry) => entry.widthAttr?.includes("%"));
  expect(percentage.map((entry) => entry.label)).toEqual([]);
  const capped = results.filter((entry) => /max-width/i.test(entry.style ?? ""));
  expect(capped.map((entry) => entry.label)).toEqual([]);

  // A template that silently half-renders (an unsupported block construct, for
  // example) still looks "centred"; require real artwork in each one.
  const empty = results.filter((entry) => entry.painted < 5);
  expect(empty.map((entry) => entry.label), "templates must draw their content").toEqual([]);

  // A live "today" marker used to stretch a Gantt chart to ~8,500 units.
  const gantt = results.find((entry) => entry.label === "Gantt chart")!;
  expect(gantt.contentWidth).toBeLessThan(2500);

  // The block template regression: all eight boxes must be labelled.
  const block = results.find((entry) => entry.label === "Block diagram")!;
  expect(block.labels.join(" ")).toContain("Rust file service");
  expect(block.labels.join(" ")).toContain("Settings store");

  // These templates would still paint *something* if their syntax broke, so
  // assert the Mermaid type actually rendered. A broken template falls back to
  // the default flowchart, which changes this attribute — labels alone do not
  // prove it, because the reference diagram shares some of them.
  const roleOf = (label: string) => results.find((entry) => entry.label === label)?.role ?? null;
  expect(roleOf("Architecture")).toBe("architecture");
  expect(roleOf("Kanban board")).toBe("kanban");
  expect(roleOf("Packet diagram")).toBe("packet");
  expect(roleOf("Treemap")).toBe("treemap");

  // Content that only these templates can produce.
  const labelOf = (label: string) =>
    (results.find((entry) => entry.label === label)?.labels.join(" ") ?? "").replace(/\s+/g, " ");
  expect(labelOf("Architecture")).toContain("Rust core");
  expect(labelOf("Kanban board")).toContain("Harden the export path");
  expect(labelOf("Packet diagram")).toContain("Acknowledgment Number");
  expect(labelOf("Treemap")).toContain("Recents");
});
