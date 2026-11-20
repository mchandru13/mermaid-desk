import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the renderer, using the production bundle in
 * Chromium. The Tauri IPC layer is replaced by the in-memory development
 * backend that ships in `src/lib/platform.ts`; the real Rust commands are
 * covered by `cargo test` and the desktop smoke test.
 *
 * Application shortcuts are dispatched as synthetic window events because
 * Chromium reserves some combinations (Ctrl+N, Ctrl+W) for its own browser UI.
 * The desktop build receives them from the operating system instead.
 */

async function waitForPreview(page: Page) {
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toBeVisible({
    timeout: 20_000,
  });
}

async function appShortcut(
  page: Page,
  key: string,
  options: { ctrl?: boolean; shift?: boolean } = {},
) {
  await page.evaluate(
    ({ key, ctrl, shift }) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
          ctrlKey: Boolean(ctrl),
          shiftKey: Boolean(shift),
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { key, ctrl: options.ctrl ?? true, shift: options.shift ?? false },
  );
}

async function replaceSource(page: Page, source: string) {
  const editor = page.locator(".monaco-editor");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await waitForPreview(page);
});

test("renders the welcome diagram and reports the diagram type", async ({ page }) => {
  await expect(page.locator(".brand-text")).toHaveText("MermaidDesk");
  const svg = page.locator('[data-testid="preview-canvas"] svg');
  await expect(svg).toContainText("Start");
  await expect(svg).toContainText("Done");
  await expect(page.locator(".status-bar")).toContainText("Flowchart");
  await expect(page.locator(".status-bar")).toContainText("Offline");
});

test("live preview follows edits and recovers from syntax errors", async ({ page }) => {
  await replaceSource(page, "flowchart TD\n    Start[Hello] --> Finish[World]\n");
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText("Hello");

  await replaceSource(page, "flowchart TD\n    A[Broken --> \n");
  await expect(page.locator('[data-testid="diagnostic"]')).toBeVisible();
  await expect(page.locator('[data-testid="diagnostic"]')).toContainText("Diagram error");
  await expect(page.locator(".status-bar")).toContainText("Error");

  await replaceSource(page, "flowchart LR\n    A[Fixed] --> B[Again]\n");
  await expect(page.locator('[data-testid="diagnostic"]')).toBeHidden();
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText("Fixed");
});

test("saves a new diagram through the native save flow", async ({ page }) => {
  await expect(page.locator('[data-testid="save-state"]')).toContainText("Not saved yet");

  await replaceSource(page, "flowchart TD\n    Draft[Unsaved] --> Saved[On disk]\n");
  await expect(page.locator('[data-testid="save-state"]')).toContainText("Unsaved changes");

  await page.locator('[data-testid="save-button"]').click();
  await expect(page.locator('[data-testid="save-state"]')).toContainText("Saved");
  await expect(page.locator(".status-bar")).toContainText("C:\\mock\\");
  await expect(page.locator('[data-testid="status-message"]')).toContainText("Saved");
});

test("creates a diagram from a template in a new tab", async ({ page }) => {
  await page.locator('[data-testid="templates-button"]').click();
  await expect(page.locator(".modal-panel")).toContainText("Diagram templates");
  await page.locator(".template-item", { hasText: "Sequence diagram" }).click();
  await page.locator('[data-testid="insert-template"]').click();

  await expect(page.locator('[role="tab"]')).toHaveCount(2);
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText(
    "Sequence diagram",
  );
  await expect(page.locator(".status-bar")).toContainText("Sequence diagram");
  await waitForPreview(page);
});

test("guards unsaved changes when closing a tab", async ({ page }) => {
  await replaceSource(page, "flowchart TD\n    A[Do not lose me] --> B[Second]\n");
  await appShortcut(page, "w");

  const dialog = page.locator(".modal-panel");
  await expect(dialog).toContainText("Save changes");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[role="tab"]')).toHaveCount(1);

  await appShortcut(page, "w");
  await expect(page.locator(".modal-panel")).toContainText("Save changes");
  await page.locator('[data-testid="unsaved-discard"]').click();
  await expect(page.locator(".empty-workspace")).toBeVisible();

  await page.locator(".empty-actions").getByRole("button", { name: "New diagram" }).click();
  await expect(page.locator('[role="tab"]')).toHaveCount(1);
});

test("exports SVG and PNG locally", async ({ page }) => {
  await page.locator('[data-testid="export-menu"]').click();
  await page.getByRole("menuitem", { name: /Export SVG…/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".svg");

  await page.locator('[data-testid="export-menu"]').click();
  await page.getByRole("menuitem", { name: /Export PNG…/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".png", {
    timeout: 20_000,
  });

  // "Beside diagram" is enabled only for saved documents.
  await page.locator('[data-testid="save-button"]').click();
  await page.locator('[data-testid="export-menu"]').click();
  await expect(
    page.getByRole("menuitem", { name: /Export SVG beside diagram/ }),
  ).toBeEnabled();
  await page.getByRole("menuitem", { name: /Export SVG beside diagram/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".svg");
});

test("zooms, fits, and toggles the theme", async ({ page }) => {
  const zoomValue = page.locator('[data-testid="zoom-value"]');
  const initial = await zoomValue.innerText();
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await zoomValue.innerText()).not.toBe(initial);

  await appShortcut(page, "9");
  await expect(zoomValue).toHaveText(initial);

  const shell = page.locator(".workspace");
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.locator('[data-testid="theme-toggle"]').click();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await waitForPreview(page);
});

test("shows keyboard shortcuts and settings", async ({ page }) => {
  await appShortcut(page, "F1", { ctrl: false });
  await expect(page.locator(".modal-panel")).toContainText("Keyboard shortcuts");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-panel")).toBeHidden();

  await page.locator('[data-testid="settings-menu"]').click();
  await page.getByRole("menuitemcheckbox", { name: /Word wrap/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("mermaiddesk.mock.settings");
        return raw ? (JSON.parse(raw) as { wordWrap: boolean }).wordWrap : null;
      }),
    )
    .toBe(true);
});

test("supports multiple documents and tab switching", async ({ page }) => {
  await appShortcut(page, "n");
  await expect(page.locator('[role="tab"]')).toHaveCount(2);
  await replaceSource(page, "sequenceDiagram\n    Alice->>Bob: Second tab\n");
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText("Alice");

  await appShortcut(page, "Tab");
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText("Start");
});

test("opens diagrams dropped onto the window", async ({ page }) => {
  await page.evaluate(() => {
    window.__MERMAIDDESK_TEST__?.seedFile(
      "C:\\mock\\dropped-flow.mmd",
      "flowchart LR\n    Dropped[DRAGGEDMARKER] --> Opened[By drop]\n",
    );
    window.__MERMAIDDESK_TEST__?.emitDragDrop([
      "C:\\mock\\dropped-flow.mmd",
      "C:\\mock\\not-a-diagram.png",
      "relative\\ignored.mmd",
    ]);
  });

  await expect(page.locator('[role="tab"]')).toHaveCount(2);
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText(
    "dropped-flow.mmd",
  );
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText(
    "DRAGGEDMARKER",
  );
  // The unsupported drop entry is reported rather than silently ignored.
  await expect(page.locator('[data-testid="status-message"]')).toContainText("ignored 2");
});

test("ignores a drop with no diagrams", async ({ page }) => {
  await page.evaluate(() => {
    window.__MERMAIDDESK_TEST__?.emitDragDrop(["C:\\mock\\photo.jpg"]);
  });
  await expect(page.locator('[role="tab"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="status-message"]')).toContainText(
    "No .mmd or .mermaid diagram",
  );
});

test("restores tabs and unsaved work after a reload", async ({ page }) => {
  await appShortcut(page, "n");
  await expect(page.locator('[role="tab"]')).toHaveCount(2);

  await replaceSource(
    page,
    "flowchart LR\n    Draft[RESTOREMARKER] --> Kept[After reload]\n",
  );
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText(
    "RESTOREMARKER",
  );

  // The session is written on an 800 ms debounce.
  await page.waitForTimeout(1400);
  await page.reload();

  await expect(page.locator('[role="tab"]')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText(
    "RESTOREMARKER",
  );
  await expect(page.locator('[data-testid="save-state"]')).toContainText(
    "Unsaved changes",
  );
});

test("runs native-menu file actions", async ({ page }) => {
  await appShortcut(page, "n");
  const before = await page.locator('[role="tab"]').count();

  await page.evaluate(() => window.__MERMAIDDESK_TEST__?.emitMenuAction("new"));
  await expect(page.locator('[role="tab"]')).toHaveCount(before + 1);

  await replaceSource(page, "flowchart LR\n    Menu[MENUPATHMARKER] --> Saved[By menu]\n");
  await page.evaluate(() => window.__MERMAIDDESK_TEST__?.emitMenuAction("save"));
  await expect(page.locator('[data-testid="status-message"]')).toContainText("Saved");
  await expect(page.locator('[data-testid="save-state"]')).toContainText("Saved");

  await page.evaluate(() => window.__MERMAIDDESK_TEST__?.emitMenuAction("close-tab"));
  await expect(page.locator('[role="tab"]')).toHaveCount(before);
});

test("opens files handed over by the OS after startup", async ({ page }) => {
  await page.evaluate(() => {
    window.__MERMAIDDESK_TEST__?.seedFile(
      "C:\\mock\\handed-over.mmd",
      "flowchart TD\n    Handed[HANDOFFMARKER] --> Open[Now]\n",
    );
    // Rust keeps handed-over paths in a queue until the UI asks for them.
    window.__MERMAIDDESK_TEST__?.queuePending([
      "C:\\mock\\handed-over.mmd",
      "C:\\mock\\ignored.txt.zzz",
    ]);
    window.__MERMAIDDESK_TEST__?.emitPendingDocuments();
  });

  await expect(page.locator('[role="tab"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText(
    "HANDOFFMARKER",
  );
});

test("gives the editor and preview an even split", async ({ page }) => {
  const editor = await page.locator(".editor-pane").boundingBox();
  const preview = await page.locator('[data-testid="preview"]').boundingBox();
  expect(editor).not.toBeNull();
  expect(preview).not.toBeNull();
  // The 5px handle makes the exact difference; anything larger means one side
  // is growing into the other's space.
  expect(Math.abs(editor!.width - preview!.width)).toBeLessThan(12);

  const handle = await page.locator(".split-handle").boundingBox();
  expect(handle).not.toBeNull();
  const viewportWidth = page.viewportSize()!.width;
  expect(Math.abs(handle!.x + handle!.width / 2 - viewportWidth / 2)).toBeLessThan(12);
});

test("centres the diagram in the preview", async ({ page }) => {
  const viewport = await page.locator('[data-testid="preview-viewport"]').boundingBox();
  const svg = await page.locator('[data-testid="preview-canvas"] svg').boundingBox();
  expect(viewport).not.toBeNull();
  expect(svg).not.toBeNull();

  const offsetX = svg!.x + svg!.width / 2 - (viewport!.x + viewport!.width / 2);
  const offsetY = svg!.y + svg!.height / 2 - (viewport!.y + viewport!.height / 2);
  expect(Math.abs(offsetX)).toBeLessThan(2);
  expect(Math.abs(offsetY)).toBeLessThan(2);

  // Keyboard zoom must keep the same visual centre, not grow from the corner.
  await appShortcut(page, "=");
  const zoomed = await page.locator('[data-testid="preview-canvas"] svg').boundingBox();
  const zoomedX = zoomed!.x + zoomed!.width / 2 - (viewport!.x + viewport!.width / 2);
  const zoomedY = zoomed!.y + zoomed!.height / 2 - (viewport!.y + viewport!.height / 2);
  expect(Math.abs(zoomedX)).toBeLessThan(2);
  expect(Math.abs(zoomedY)).toBeLessThan(2);
  expect(zoomed!.width).toBeGreaterThan(svg!.width);
});

test("remembers the split position", async ({ page }) => {
  const handle = page.locator(".split-handle");
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + 200);
  await page.mouse.down();
  await page.mouse.move(box!.x - 220, box!.y + 200, { steps: 8 });
  await page.mouse.up();

  const editor = await page.locator(".editor-pane").boundingBox();
  const preview = await page.locator('[data-testid="preview"]').boundingBox();
  expect(editor!.width).toBeLessThan(preview!.width);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("mermaiddesk.mock.settings");
          if (!raw) return null;
          const value = (JSON.parse(raw) as { editorSplit?: number }).editorSplit;
          return typeof value === "number" ? value : null;
        }),
      { timeout: 10_000 },
    )
    .toBeLessThan(45);

  // The new position survives a reload.
  await page.reload();
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toBeVisible();
  const restored = await page.locator(".editor-pane").boundingBox();
  expect(Math.abs(restored!.width - editor!.width)).toBeLessThan(8);
});

test("pans the preview by dragging", async ({ page }) => {
  const canvas = page.locator('[data-testid="preview-canvas"]');
  const before = await canvas.evaluate((element) => (element as HTMLElement).style.transform);
  const box = await page.locator('[data-testid="preview-viewport"]').boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 300, box!.y + 200);
  await page.mouse.down();
  await page.mouse.move(box!.x + 380, box!.y + 250, { steps: 6 });
  await page.mouse.up();

  const after = await canvas.evaluate((element) => (element as HTMLElement).style.transform);
  expect(after).not.toBe(before);
});

test("renders and exports with every remote request blocked", async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4173")) return route.continue();
    return route.abort();
  });

  await page.reload();
  await waitForPreview(page);
  await expect(page.locator('[data-testid="preview-canvas"] svg')).toContainText("Start");
  await expect(page.locator('[data-testid="diagnostic"]')).toBeHidden();

  await page.locator('[data-testid="export-menu"]').click();
  await page.getByRole("menuitem", { name: /Export PNG…/ }).click();
  await expect(page.locator('[data-testid="status-message"]')).toContainText(".png", {
    timeout: 20_000,
  });
});
