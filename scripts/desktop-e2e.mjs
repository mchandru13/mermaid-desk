#!/usr/bin/env node
/**
 * Desktop end-to-end verification against the real Tauri binary.
 *
 * Requirements:
 *   - `tauri-driver` on PATH (cargo install tauri-driver --locked)
 *   - Microsoft Edge WebDriver matching the installed WebView2 runtime, in
 *     ./tools/edgedriver/msedgedriver.exe (override with TAURI_EDGEDRIVER)
 *
 * Verifies on the shipped WebView2 + Rust core:
 *   1. Launch and Mermaid rendering.
 *   2. Open a .mmd file through the native Open dialog.
 *   3. Edit and Save write the file through the Rust command.
 *   4. Relaunch + reopening shows the persisted content.
 *   5. The window-close guard appears for unsaved changes and can be cancelled.
 *   6. The native File > Save menu reaches the same handler as the shortcut.
 *   7. Save As fills the native dialog and creates the file on disk.
 *   8. Export fills the native dialog and writes real SVG.
 *   9. "Export beside diagram" produces real SVG and PNG files on disk.
 *  10. "Copy PNG" puts a real image (dimensions, opaque background) on the
 *      Windows clipboard, read back with System.Windows.Forms.
 *  11. An unsaved edit survives quitting and relaunching (session recovery).
 *  12. Launching the executable with a file argument (file association /
 *      OS hand-off) opens that document, verified by the native window title.
 */
import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Builder, By, Key, until } from "selenium-webdriver";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath =
  process.env.MERMAIDDESK_APP ??
  path.join(root, "src-tauri", "target", "release", "mermaid-desk.exe");
const driverPath =
  process.env.TAURI_EDGEDRIVER ?? path.join(root, "tools", "edgedriver", "msedgedriver.exe");
const driverBinary = process.env.TAURI_DRIVER ?? "tauri-driver";
const port = 4444;
const serverUrl = `http://127.0.0.1:${port}`;

const workDir = path.join(os.tmpdir(), `mermaiddesk-desktop-${Date.now()}`);
const samplePath = path.join(workDir, "desktop-test.mmd");
const configSessionPath = path.join(
  process.env.APPDATA ?? "",
  "dev.mermaiddesk.app",
  "session.json",
);
let sessionBackup = null;
let failures = 0;

function log(message) {
  console.log(`[desktop] ${message}`);
}

function check(condition, message) {
  if (condition) {
    log(`PASS ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await readFile(file, "utf8");
      if (predicate(value)) return value;
    } catch {
      // not written yet
    }
    await sleep(250);
  }
  return null;
}

async function waitForPath(file, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await stat(file);
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

function startDriver() {
  const child = spawn(driverBinary, ["--port", String(port), "--native-driver", driverPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (data) => process.stdout.write(`[tauri-driver] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[tauri-driver] ${data}`));
  return child;
}

async function waitForPort(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(250);
  }
  throw new Error("tauri-driver did not start listening");
}

async function createSession() {
  return new Builder()
    .usingServer(serverUrl)
    .withCapabilities({ browserName: "wry", "tauri:options": { application: appPath } })
    .build();
}

async function replaceSource(driver, source, verify) {
  const compact = (value) => value.replace(/\s+/g, "");
  const expected = verify ?? source;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const editor = await driver.wait(until.elementLocated(By.css(".monaco-editor")), 20_000);
    await editor.click();
    await sleep(200);
    // Chords with modifiers must be sent as keyDown/keyUp; `Key.chord` is
    // interpreted literally by WebView2's native edit context.
    await driver.actions().keyDown(Key.CONTROL).sendKeys("a").keyUp(Key.CONTROL).perform();
    await sleep(150);
    for (const character of source) {
      await driver.actions().sendKeys(character === "\n" ? Key.ENTER : character).perform();
      await sleep(18);
    }
    await sleep(500);

    const text = await driver.findElement(By.css(".monaco-editor .view-lines")).getText();
    if (compact(text).includes(compact(expected))) return;
  }
  throw new Error("Could not replace the editor source reliably");
}

async function previewText(driver) {
  return driver.executeScript(
    "return document.querySelector('[data-testid=\"preview-canvas\"] svg')?.textContent ?? ''",
  );
}

async function waitForPreview(driver, needle, timeoutMs = 25_000) {
  await driver.wait(async () => (await previewText(driver)).includes(needle), timeoutMs);
}

async function clickMenuItem(driver, label) {
  await driver.findElement(By.css('[data-testid="export-menu"]')).click();
  const item = await driver.wait(
    until.elementLocated(By.xpath(`//*[@role='menuitem' and contains(., '${label}')]`)),
    5_000,
  );
  await item.click();
}

async function bodyText(driver) {
  return driver.findElement(By.css("body")).getText();
}

async function waitForBodyText(driver, needle, timeoutMs = 20_000) {
  await driver.wait(async () => (await bodyText(driver)).includes(needle), timeoutMs);
}

function runPowerShell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Sta", "-Command", script]).toString().trim();
}

/** Read the clipboard image as `WxH a=alpha rgb=r,g,b`, or `empty`. */
function readClipboardImage() {
  try {
    return runPowerShell(
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$img = [System.Windows.Forms.Clipboard]::GetImage()",
        "if ($img -eq $null) { 'empty' } else { $p = $img.GetPixel(0,0); \"$($img.Width)x$($img.Height) a=$($p.A) rgb=$($p.R),$($p.G),$($p.B)\" }",
      ].join("; "),
    );
  } catch {
    return "error";
  }
}

async function waitForClipboardImage(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let value = "empty";
  while (Date.now() < deadline) {
    value = readClipboardImage();
    if (/^\d+x\d+/.test(value)) return value;
    await sleep(300);
  }
  return value;
}


/**
 * Fill the native Windows file dialog and confirm it. Uses Win32 messages
 * (WM_SETTEXT + BM_CLICK) because the dialog runs in a different process and
 * cannot rely on foreground activation in an automated session.
 */
async function fillNativeDialog(dialogTitle, targetPath) {
  const script = path.join(root, "scripts", "desktop", "dialog-fill.ps1");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-File", script, "-Title", dialogTitle, "-TargetPath", targetPath],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`dialog automation failed: ${stderr || stdout}`)),
    );
  });
}

/** Open a file through the app's native Open dialog (toolbar button). */
async function openThroughDialog(driver, file) {
  await driver.findElement(By.xpath("//button[contains(., 'Open')]")).click();
  await fillNativeDialog("Open Mermaid diagram", file);
}

async function quitQuietly(driver) {
  if (!driver) return;
  try {
    await driver.quit();
  } catch {
    // session may already be gone
  }
}

/**
 * Evaluate an expression inside a directly-launched app through its WebView2
 * remote-debugging endpoint. This is the only way to inspect a process that
 * WebDriver did not start (and the real window size).
 */
async function evaluateOverCdp(port, expression) {
  let page = null;
  for (let attempt = 0; attempt < 40 && !page; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((target) => target.type === "page");
    } catch {
      // endpoint not ready yet
    }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("the app did not expose a debuggable page");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let counter = 0;
  const pending = new Map();
  const send = (method, params = {}) => {
    const id = ++counter;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });

  try {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result?.value ?? {};
  } finally {
    socket.close();
  }
}

async function main() {
  // A leftover instance from a previous run would receive the OS hand-off and
  // make the single-instance check ambiguous.
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Stop-Process -Name mermaid-desk,MermaidDesk -Force -ErrorAction SilentlyContinue; exit 0",
    ]);
  } catch {
    // no running instance
  }
  await sleep(500);

  await mkdir(workDir, { recursive: true });

  // The app persists its open tabs for crash recovery. Start from a clean slate
  // and put the developer's own session back when the suite ends.
  try {
    sessionBackup = await readFile(configSessionPath);
  } catch {
    sessionBackup = null;
  }
  await rm(configSessionPath, { force: true });
  const original = "flowchart TD\n    Desktop[Desktop round trip] --> Done[Saved on disk]\n";
  await writeFile(samplePath, original, "utf8");

  const driverProcess = startDriver();
  let driver;
  try {
    await waitForPort();

    /* ---------- 1. launch + native Open dialog ---------- */
    driver = await createSession();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60_000 });
    const editor = await driver.wait(until.elementLocated(By.css(".monaco-editor")), 30_000);
    await driver.wait(until.elementIsVisible(editor), 30_000);
    await driver.wait(until.elementLocated(By.css('[data-testid="preview-canvas"] svg')), 30_000);
    log("application launched and preview rendered");

    await openThroughDialog(driver, samplePath);
    await waitForBodyText(driver, "desktop-test.mmd");
    await waitForPreview(driver, "Desktop");
    const opened = await previewText(driver);
    check(opened.includes("Desktop"), "native Open dialog loads the diagram");
    check((await bodyText(driver)).includes("Flowchart"), "diagram type detected");

    const layout = await driver.executeScript(`
      const editor = document.querySelector('.editor-pane').getBoundingClientRect();
      const preview = document.querySelector('[data-testid="preview"]').getBoundingClientRect();
      const viewport = document.querySelector('[data-testid="preview-viewport"]').getBoundingClientRect();
      const svgBox = document.querySelector('[data-testid="preview-canvas"] svg').getBoundingClientRect();
      return {
        editorWidth: editor.width,
        previewWidth: preview.width,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        svgWidth: svgBox.width,
        svgHeight: svgBox.height,
        offsetX: (svgBox.x + svgBox.width / 2) - (viewport.x + viewport.width / 2),
        offsetY: (svgBox.y + svgBox.height / 2) - (viewport.y + viewport.height / 2),
        zoom: document.querySelector('[data-testid="zoom-value"]').textContent
      };
    `);
    check(Math.abs(layout.editorWidth - layout.previewWidth) < 12, "editor and preview split evenly");
    check(
      Math.abs(layout.offsetX) < 3 && Math.abs(layout.offsetY) < 3,
      `diagram centred in the preview (dx=${layout.offsetX.toFixed(1)}, dy=${layout.offsetY.toFixed(1)})`,
    );
    check(
      layout.svgWidth <= layout.viewportWidth && layout.svgHeight <= layout.viewportHeight,
      `diagram fitted inside the preview (${layout.zoom}, ${Math.round(layout.svgWidth)}x${Math.round(layout.svgHeight)} in ${Math.round(layout.viewportWidth)}x${Math.round(layout.viewportHeight)})`,
    );

    const shot = await driver.takeScreenshot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "screenshot.png"), shot, "base64");
    log("screenshot written to docs/screenshot.png");

    /* ---------- 2. edit + Save ---------- */
    const edited =
      "flowchart LR; Edited[DESKTOPMARKER] --> Saved[WrittenByRust];";
    await replaceSource(driver, edited, "DESKTOPMARKER");
    await waitForPreview(driver, "DESKTOPMARKER", 15_000);

    let savedOnDisk = null;
    for (let attempt = 0; attempt < 3 && !savedOnDisk; attempt += 1) {
      await driver.findElement(By.css('[data-testid="save-button"]')).click();
      savedOnDisk = await waitForFile(
        samplePath,
        (value) => value.includes("DESKTOPMARKER"),
        8_000,
      );
    }
    check(savedOnDisk !== null, "Save wrote the new source through the Rust command");
    const savedToast = await driver.wait(async () => {
      const elements = await driver.findElements(By.css('[data-testid="status-message"]'));
      if (elements.length === 0) return false;
      return (await elements[0].getText()).includes("Saved") ? elements[0] : false;
    }, 10_000);
    check(Boolean(savedToast), "status bar confirms the save");
    await driver.quit();
    driver = null;

    /* ---------- 3. relaunch + reopen ---------- */
    driver = await createSession();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60_000 });
    await driver.wait(until.elementLocated(By.css(".monaco-editor")), 30_000);
    await openThroughDialog(driver, samplePath);
    await waitForBodyText(driver, "desktop-test.mmd");
    await waitForPreview(driver, "DESKTOPMARKER");
    const reopened = await previewText(driver);
    check(reopened.includes("DESKTOPMARKER"), "relaunch reopens the saved content");
    check(!(await bodyText(driver)).includes("Unsaved changes"), "reopened document is clean");

    /* ---------- 4. Window close guard ---------- */
    await replaceSource(driver, "flowchart TD; Guard[UNSAVEDGUARD] --> Cancel[KeepOpen];", "UNSAVEDGUARD");
    await waitForPreview(driver, "UNSAVEDGUARD", 15_000);
    const closeResult = execFileSync("powershell.exe", [
      "-NoProfile",
      "-File",
      path.join(root, "scripts", "desktop", "window-close.ps1"),
    ]).toString();
    check(closeResult.includes("close requested"), "window close was requested");
    const guard = await driver.wait(
      until.elementLocated(
        By.xpath("//*[contains(@class,'modal-panel') and contains(., 'unsaved changes')]"),
      ),
      10_000,
    );
    check(Boolean(guard), "closing with unsaved changes shows the guard");
    const cancelButton = await guard.findElement(By.xpath(".//button[normalize-space()='Cancel']"));
    await cancelButton.click();
    await sleep(500);
    const stillOpen = await driver.findElements(By.css(".monaco-editor"));
    check(stillOpen.length > 0, "cancelling the close guard keeps the window open");

    /* ---------- 5. Native menu reaches the same handlers ---------- */
    await replaceSource(
      driver,
      "flowchart LR; ViaMenu[NATIVEMENUMARKER] --> Saved[By menu];",
      "NATIVEMENUMARKER",
    );
    await waitForPreview(driver, "NATIVEMENUMARKER", 15_000);
    const menuResult = execFileSync("powershell.exe", [
      "-NoProfile",
      "-File",
      path.join(root, "scripts", "desktop", "menu-invoke.ps1"),
      "-ItemText",
      "Save",
    ]).toString();
    check(menuResult.includes("invoked"), `native File > Save invoked (${menuResult.trim()})`);
    const menuSaved = await waitForFile(
      samplePath,
      (value) => value.includes("NATIVEMENUMARKER"),
      15_000,
    );
    check(menuSaved !== null, "native menu Save wrote through the Rust command");

    /* ---------- 6. Save As through the native dialog ---------- */
    const saveAsPath = path.join(workDir, "saved-as.mmd");
    await clickMenuItem(driver, "Save As");
    const saveAsResult = execFileSync("powershell.exe", [
      "-NoProfile",
      "-File",
      path.join(root, "scripts", "desktop", "dialog-fill.ps1"),
      "-Title",
      "Save Mermaid diagram",
      "-TargetPath",
      saveAsPath,
    ]).toString();
    check(saveAsResult.includes("confirmed"), "Save As dialog was filled and confirmed");
    check(await waitForPath(saveAsPath), "Save As wrote the file through the Rust command");
    if (await waitForPath(saveAsPath)) {
      const written = await readFile(saveAsPath, "utf8");
      check(written.includes("NATIVEMENUMARKER"), "Save As persisted the edited source");
    }
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(@class,'status-bar') and contains(., 'saved-as.mmd')]")),
      10_000,
    );
    check((await bodyText(driver)).includes("saved-as.mmd"), "the app switched to the new file");

    /* ---------- 6b. Recent files survive a restart ---------- */
    // Closing and reopening exercises the persisted recent list, which is a
    // separate authorisation path in Rust from the Open dialog. Settings are
    // written on a short debounce, so let that land before quitting.
    await sleep(1200);
    await driver.quit();
    driver = null;
    await sleep(1500);
    driver = await createSession();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60_000 });
    await driver.wait(until.elementLocated(By.css(".monaco-editor")), 30_000);

    await driver.findElement(By.css('[data-testid="recent-menu"]')).click();
    await driver.wait(until.elementLocated(By.css('[role="menu"] [role="menuitem"]')), 5_000);
    const recentItems = await driver.findElements(
      By.xpath("//*[@role='menuitem' and contains(., 'saved-as.mmd')]"),
    );
    let recentItem = null;
    for (const item of recentItems) {
      // getText() drops the hint line in this WebView; innerText keeps it.
      const text = await driver.executeScript(
        "return arguments[0].innerText || arguments[0].textContent || '';",
        item,
      );
      if (String(text).includes(path.basename(workDir))) {
        recentItem = item;
        break;
      }
    }
    check(Boolean(recentItem), "the Recent menu lists this session's saved document");
    if (recentItem) {
      await recentItem.click();
    }
    // The preview marker is proof the document opened; menu text cannot satisfy it.
    await waitForPreview(driver, "NATIVEMENUMARKER", 20_000);
    check(
      (await previewText(driver)).includes("NATIVEMENUMARKER"),
      "reopening a recent after a restart shows its saved content",
    );
    check(
      (await bodyText(driver)).includes("saved-as.mmd"),
      "the reopened recent is the active tab",
    );

    /* ---------- 7. Export… through the native dialog ---------- */
    const exportedSvg = path.join(workDir, "dialog-export.svg");
    await clickMenuItem(driver, "Export SVG…");
    await sleep(500);
    const exportResult = execFileSync("powershell.exe", [
      "-NoProfile",
      "-File",
      path.join(root, "scripts", "desktop", "dialog-fill.ps1"),
      "-Title",
      "Export SVG image",
      "-TargetPath",
      exportedSvg,
    ]).toString();
    check(exportResult.includes("confirmed"), "Export dialog was filled and confirmed");
    check(await waitForPath(exportedSvg), "SVG export dialog wrote a file");
    if (await waitForPath(exportedSvg)) {
      const svg = await readFile(exportedSvg, "utf8");
      check(svg.includes("<svg") && !/<script/i.test(svg), "dialog-exported SVG is clean markup");
    }

    /* ---------- 8. Quick exports beside the open diagram ---------- */
    // The document is now saved-as.mmd, so beside exports land next to it.
    const svgPath = path.join(workDir, "saved-as.svg");
    await clickMenuItem(driver, "Export SVG beside");
    check(await waitForPath(svgPath), "SVG export beside the diagram produced a file");
    if (await waitForPath(svgPath)) {
      const svg = await readFile(svgPath, "utf8");
      check(svg.includes("<svg"), "SVG export contains SVG markup");
      check(!/<script/i.test(svg), "SVG export contains no script elements");
      check(!/https?:\/\//i.test(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")), "SVG export has no remote references");
    }

    const pngPath = path.join(workDir, "saved-as.png");
    await clickMenuItem(driver, "Export PNG beside");
    const pngReady = await waitForPath(pngPath, 25_000);
    check(pngReady, "PNG export beside the diagram produced a file");
    if (pngReady) {
      const png = await readFile(pngPath);
      check(
        png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        "PNG export has a valid PNG signature",
      );
      check(png.length > 2000, "PNG export is a non-trivial image");
    }

    /* ---------- 8b. Replacing an existing export asks Rust-owned consent ---------- */
    // The files above now exist, so the next beside-export must prompt. The
    // prompt lives in Rust (`export_beside_confirmed`), not the webview, so this
    // is what proves a renderer-supplied flag can no longer authorise a replace.
    const replaceTitle = "Replace existing export?";
    const answerPrompt = (button) =>
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-File",
        path.join(root, "scripts", "desktop", "dialog-answer.ps1"),
        "-Title",
        replaceTitle,
        "-Button",
        button,
      ]).toString();

    const svgBefore = await readFile(svgPath, "utf8");
    // Prove the approval writes rather than merely re-reading cached markup:
    // plant a sentinel in the existing file first.
    const SENTINEL = "planted-by-the-desktop-suite";
    await writeFile(svgPath, `${svgBefore}\n${SENTINEL}\n`);
    // A thrown click must be reported as a failed check, not abort main().
    const clickBeside = async () => {
      try {
        await clickMenuItem(driver, "Export SVG beside");
        return "";
      } catch (error) {
        return `click failed: ${error.message}`;
      }
    };

    const declineClick = await clickBeside();
    let declined = declineClick;
    if (!declined) {
      try {
        declined = answerPrompt("No");
      } catch (error) {
        declined = `failed: ${error.message}`;
      }
    }
    check(!declineClick, `the beside export was triggered (${declineClick || "clicked"})`);
    check(declined.includes("Replace it?"), `the replace prompt describes the file (${declined.trim()})`);
    check(declined.includes("answered No"), "declining the replace prompt was accepted");
    check(
      (await readFile(svgPath, "utf8")).includes(SENTINEL),
      "declining the prompt left the existing export untouched",
    );

    const acceptClick = await clickBeside();
    let accepted = acceptClick;
    if (!accepted) {
      try {
        accepted = answerPrompt("Yes");
      } catch (error) {
        accepted = `failed: ${error.message}`;
      }
    }
    check(!acceptClick, `the beside export was triggered again (${acceptClick || "clicked"})`);
    check(accepted.includes("answered Yes"), "approving the replace prompt was accepted");
    const replaced = await readFile(svgPath, "utf8");
    check(replaced.includes("<svg"), "approving the prompt rewrote the export");
    check(!replaced.includes(SENTINEL), "the replacement overwrote the planted file");
    check(!/<script/i.test(replaced), "the rewritten export is still clean markup");

    /* ---------- 9. Copy PNG to the real Windows clipboard ---------- */
    // Clear first so an image left by another app cannot make this pass.
    try {
      runPowerShell(
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()",
      );
    } catch {
      // A locked clipboard is fine; the wait below still has to see our image.
    }

    const copyResult = execFileSync("powershell.exe", [
      "-NoProfile",
      "-File",
      path.join(root, "scripts", "desktop", "menu-invoke.ps1"),
      "-ItemText",
      "Copy PNG",
    ]).toString();
    check(copyResult.includes("invoked"), `native File > Copy PNG invoked (${copyResult.trim()})`);

    const clipboard = await waitForClipboardImage();
    const clipboardMatch = /^(\d+)x(\d+) a=(\d+) rgb=(\d+),(\d+),(\d+)$/.exec(clipboard);
    check(Boolean(clipboardMatch), `the clipboard holds the copied image (${clipboard})`);
    if (clipboardMatch) {
      const width = Number(clipboardMatch[1]);
      const height = Number(clipboardMatch[2]);
      check(
        width > 100 && height > 50,
        `clipboard image has diagram dimensions (${width}x${height})`,
      );
      check(clipboardMatch[3] === "255", "clipboard image is opaque");
      const [r, g, b] = [
        Number(clipboardMatch[4]),
        Number(clipboardMatch[5]),
        Number(clipboardMatch[6]),
      ];
      const light = r === 255 && g === 255 && b === 255;
      const dark = r === 13 && g === 17 && b === 23;
      check(light || dark, `clipboard background follows the app theme (rgb ${r},${g},${b})`);
    }

    // The image must still be there a moment later. On X11/Wayland the clipboard
    // is served by the owning process, so a handle created and dropped per call
    // loses the image; Windows is more forgiving, but the re-read proves the
    // handle outlives the command everywhere the check runs.
    await sleep(2500);
    const reRead = readClipboardImage();
    check(
      reRead === clipboard,
      `the copied image survives after the command returns (${reRead})`,
    );

    /* ---------- 10. An unsaved edit survives a restart ---------- */
    await replaceSource(
      driver,
      "flowchart LR; Session[SESSIONMARKER] --> Kept[Recovered];",
      "SESSIONMARKER",
    );
    await waitForPreview(driver, "SESSIONMARKER", 15_000);
    await sleep(1500); // let the session debounce write

    await quitQuietly(driver);
    driver = null;
    await sleep(1500);

    driver = await createSession();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60_000 });
    await driver.wait(until.elementLocated(By.css(".monaco-editor")), 30_000);
    await waitForPreview(driver, "SESSIONMARKER", 20_000);
    check(
      (await previewText(driver)).includes("SESSIONMARKER"),
      "an unsaved edit survives quitting and relaunching",
    );

    let restoredDirty = true;
    try {
      await waitForBodyText(driver, "Unsaved changes", 10_000);
    } catch {
      restoredDirty = false;
    }
    check(restoredDirty, "the recovered document is still marked unsaved");

    // Discard the recovered draft so later checks start from a clean session.
    await driver.findElement(By.css(".tab.active .tab-close")).click();
    await driver.wait(
      until.elementLocated(By.css('[data-testid="unsaved-discard"]')),
      10_000,
    );
    await driver.findElement(By.css('[data-testid="unsaved-discard"]')).click();
    await sleep(1200);

    await quitQuietly(driver);
    driver = null;
    driverProcess.kill();
    await sleep(1000);

    /* ---------- 6. OS hand-off (file association) ---------- */
    const handoff = spawn(appPath, [samplePath], { detached: true, stdio: "ignore" });
    handoff.unref();
    let title = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(500);
      const { execFileSync: execSync } = await import("node:child_process");
      try {
        title = execSync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `(Get-Process mermaid-desk -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle`,
        ])
          .toString()
          .trim();
      } catch {
        title = "";
      }
      if (title.includes("desktop-test.mmd")) break;
    }
    check(title.includes("desktop-test.mmd"), `OS hand-off opened the file in a window (${title})`);

    /* ---------- 7. Direct launch: clean document, rendered and centred ---------- */
    // A BOM-prefixed file used to open as immediately "modified", and this is
    // also the only path that exercises the real window size.
    const bomPath = path.join(workDir, "bom-diagram.mmd");
    await writeFile(
      bomPath,
      "\uFEFFflowchart TD\n    Bom[BomFile] --> Clean[OpenedClean]\n",
      "utf8",
    );
    const { execFileSync: execSync2 } = await import("node:child_process");
    execSync2("powershell.exe", ["-NoProfile", "-Command", "Stop-Process -Name mermaid-desk,MermaidDesk -Force -ErrorAction SilentlyContinue; exit 0"]);
    await sleep(800);

    const direct = spawn(appPath, [bomPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9333" },
    });
    direct.unref();
    await sleep(7000);

    const probe = await readFile(
      path.join(root, "scripts", "desktop", "probe-window.js"),
      "utf8",
    );
    const evaluated = await evaluateOverCdp(9333, probe);
    check(evaluated.clean, `a BOM file opens without unsaved changes (${evaluated.saveState})`);
    check(evaluated.hasSvg, "direct launch renders the diagram");
    check(
      Math.abs(evaluated.offsetX) < 3 && Math.abs(evaluated.offsetY) < 3,
      `direct launch centres the diagram (dx=${evaluated.offsetX.toFixed(1)}, dy=${evaluated.offsetY.toFixed(1)})`,
    );
    check(
      Math.abs(evaluated.editorWidth - evaluated.previewWidth) < 14,
      `direct launch splits evenly (${Math.round(evaluated.editorWidth)}/${Math.round(evaluated.previewWidth)})`,
    );
    check(evaluated.svgFits, `direct launch fits the diagram (${evaluated.zoom})`);

    execSync2("powershell.exe", ["-NoProfile", "-Command", "Stop-Process -Name mermaid-desk,MermaidDesk -Force -ErrorAction SilentlyContinue; exit 0"]);

    log(`artifacts kept in ${workDir}`);
  } finally {
    await quitQuietly(driver);
    driverProcess.kill();
    try {
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Stop-Process -Name mermaid-desk,MermaidDesk -Force -ErrorAction SilentlyContinue; exit 0",
      ]);
    } catch {
      // already gone
    }
    await sleep(500);
    if (sessionBackup) {
      await writeFile(configSessionPath, sessionBackup).catch(() => undefined);
    } else {
      await rm(configSessionPath, { force: true }).catch(() => undefined);
    }
    if (failures > 0) {
      console.error(`\n${failures} desktop check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("\nAll desktop checks passed");
    }
  }
}

main().catch(async (error) => {
  console.error("Desktop verification failed:", error);
  process.exitCode = 1;
});







