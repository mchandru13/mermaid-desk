import { expect, test } from "@playwright/test";

/** Collects the diagnostic line the app shows for a source. */
async function diagnosticFor(page: import("@playwright/test").Page, source: string) {
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await page.waitForTimeout(900);
  const text = await page.locator('[data-testid="diagnostic"]').innerText();
  const match = /Go to line (\d+)/.exec(text);
  return { line: match ? Number(match[1]) : null, text };
}

test("diagnostics point at the failing line", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="preview-canvas"] svg').waitFor({ timeout: 30_000 });

  // Mermaid's parser reports a line offset relative to the statement it starts
  // with, plus a fixed lead-in. The app must translate it to the editor line.
  const cases = [
    { source: "flowchart TD\n    A[Broken -->\n", expected: 2 },
    { source: "flowchart TD\n\n\n\n    A[Broken -->\n", expected: 5 },
    { source: "---\ntitle: T\n---\nflowchart TD\n    A[Broken -->\n", expected: 5 },
    { source: "%% note\nflowchart TD\n    A[Broken -->\n", expected: 3 },
  ];

  for (const entry of cases) {
    const { line } = await diagnosticFor(page, entry.source);
    console.log(`source lines=${entry.source.split("\n").length - 1} -> reported ${line}`);
    expect(line, `diagnostic for ${JSON.stringify(entry.source)}`).toBe(entry.expected);
  }
});
