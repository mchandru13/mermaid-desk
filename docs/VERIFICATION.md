?# Verification report

Date: 2026-11-20
Host: Windows 11 x64 (WebView2 157.0.4341.60), Node 24.13.0, Rust 1.100.0 (MSVC),
Visual Studio 2022 Build Tools, tauri-driver 2.1.0, Edge WebDriver 157.0.4341.60.

This report records what was actually executed. Anything not executed is listed under
"Known limitations" rather than claimed as verified.

## 1. Automated suites

| Suite | Command | Result |
| --- | --- | --- |
| Rust unit/integration | `cargo test` (in `src-tauri`) | **30 passed, 0 failed** |
| Frontend unit/integration | `npm run test` (Vitest) | **49 passed, 0 failed** across 6 files |
| Production UI E2E | `npm run build && npm run test:e2e` (Playwright, Chromium 159) | **22 passed, 0 failed** |
| Desktop E2E | `npm run test:desktop` (tauri-driver + WebView2 + real Rust binary) | **35 checks passed** |
| Type check | `npx tsc --noEmit` | clean |

Rust coverage: path canonicalisation, verbatim-path display, extension allowlists,
atomic replace, missing-directory creation, 8 MiB limit (read and write), invalid UTF-8,
**UTF-8 BOM stripping and CRLF round-tripping**, startup argument filtering,
authorisation refusal, recreating a deleted authorised file,
**Save As write logic (extension defaulting, oversized content, missing folder)**,
**export encode/write (SVG, base64 PNG, bad payload, unknown format)**,
**beside-export authorisation/overwrite**, **drag-and-drop filtering and 32-file cap**,
settings round-trip and split clamping, corrupt-file fallback, backup creation,
recent-file cap.

Frontend coverage: tab model and dirty baselines, path comparison (Windows/macOS),
recents, diagram-type detection, shortcut mapping, SVG sanitisation/hardening, parse
-error line extraction, export naming/backgrounds/base64 lengths, workspace controller
(open, edit, save-as, reopen, close guards, cycling, **dropped paths**, **menu actions**).

Playwright scenarios: welcome render, live edits + error recovery, save flow, template
tab, unsaved-change guard (Cancel/Discard), SVG+PNG+beside export, zoom/fit/pan/theme,
shortcuts+settings, multi-tab switching, drag-and-drop (mixed valid/invalid paths),
empty drop, native-menu actions (new/save/close), OS hand-off after startup, split
persistence, and a run with **every non-localhost request aborted**.

New in this pass: a template-geometry test walks **all 15 built-in templates** and
asserts each is centred on its painted artwork (not the viewBox), fits the pane, has no
percentage width or `max-width` cap on the root SVG, draws real content, keeps the Gantt
chart's width sane, and renders every Block-diagram box. A diagnostics test asserts the
reported line matches the edited file through front matter and `%%` comments. An export
test asserts SVG files carry a background aligned to the viewBox, tight/centred bounds,
theme text colours, and no script.

## 1a. Export quality

`docs/VERIFICATION.md` records the review that produced these fixes. The exported SVG
previously inherited dark-theme text colours with **no background**, so opening it on a
white page gave a contrast ratio of **1.18:1** (title 1.5:1) — effectively invisible.
It also kept Mermaid's padded viewBox (content ~5 px left and ~20 px high of centre,
clipping ~2 px at the top) and a session-scoped `id` that restarted at 1 on every
launch.

Current export behaviour:

- SVG export adds an opaque background matching the diagram theme
  (`#0d1117` dark / `#ffffff` light), aligned to the viewBox origin. A separate
  "Export SVG (transparent)…" item omits it for embedding in themed documents.
  It keeps the current theme's text colour (the menu labels it "light text" or
  "dark text"), so a dark-theme transparent export is intended for a dark
  background. There is deliberately no colour override: the file matches the
  preview (WYSIWYG), and switching palettes silently would make exports differ
  from what the user reviewed.
- The viewBox is recomputed from the live element's `getBBox()` plus 16 px padding, and
  `width`/`height` match it, so the file is tightly cropped and centred.
- Render ids use a random suffix, so several exported SVGs can share one HTML page.
- Pie charts now use theme variables for outlines and text instead of Mermaid's
  hardcoded black outline / light-grey labels.

Desktop checks in detail (35): launch + render; native Open dialog; type detection; **even
editor/preview split, diagram centred and fitted**; real typing; Save to disk; save
toast; relaunch + reopen; clean state after reopen; window close guard appears and can
be cancelled; **native File > Save menu** reaches the same handler and writes;
**Save As dialog filled and confirmed, file written, app switches to it**;
**Export… dialog filled and confirmed, clean SVG written**; SVG and PNG export beside
the diagram (markup, no scripts, no remote references, valid PNG signature and size);
OS file hand-off; **a direct launch with a file argument opens it clean (BOM), renders,
and centres/fits at the real window size**, inspected over WebView2's debugging
endpoint. A screenshot of the running desktop app is written to `docs/screenshot.png`
(captured over that endpoint, so it is exactly what the window shows).

## 2. Desktop end-to-end (real Windows build)

Command: `npm run test:desktop` → `scripts/desktop-e2e.mjs`.
The script drives the release binary through WebDriver (tauri-driver + msedgedriver),
uses the real native dialogs, and inspects files on disk. The final section launches
the executable directly (as Explorer would) and inspects it over WebView2's debugging
endpoint, which is the only way to see the real window size.

Verified on the shipped binary:

1. Application launches; Mermaid preview renders in WebView2.
2. **Open** through the native Windows dialog loads a `.mmd` file.
3. Diagram type detection shows "Flowchart" in the status bar.
4. Real key events replace the source in Monaco (Ctrl+A + typing).
5. **Save** writes the edited source through the Rust command; the file on disk
   contains the new marker; the toast confirms the save.
6. A fresh process **open + reopen** shows the persisted content and reports no unsaved
   changes.
7. **Save As** fills the native save dialog (file-name field written through
   `EM_REPLACESEL`, since the DirectUI field ignores `WM_SETTEXT` and exposes no UI
   Automation ValuePattern) and confirms it; the file appears on disk with the edited
   source, and the app switches to that new path.
8. **Export…** fills the native dialog the same way and writes a clean SVG.
9. **Export SVG beside diagram** writes a real `.svg` next to the source (contains
   `<svg`, no `<script>`, no remote references).
10. **Export PNG beside diagram** writes a real `.png` with a valid PNG signature and a
    non-trivial size (canvas rasterisation inside WebView2).
11. Launching the executable with a file argument (file association / second instance)
    opens that file; the native window title becomes `desktop-test.mmd - MermaidDesk`.
12. A screenshot of the running desktop app is written to `docs/screenshot.png`
    (captured by WebDriver from the real window).
13. The native **File > Save** menu item is invoked by posting its `WM_COMMAND`
    (`scripts/desktop/menu-invoke.ps1`) and writes through the same Rust command.

A separate single-instance check was run against the **installed** application: a second
launch with another file exited and the existing window switched to the new document
(exactly one window remained).

## 3. Installer

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `bundle/nsis/MermaidDesk_1.0.0_x64-setup.exe` | 6,507,936 B | `2B075A8EFE3B6571814AB79240E6E890BD27A330A1E77EB99C83A045F52DF254` |
| `bundle/msi/MermaidDesk_1.0.0_x64_en-US.msi` | 7,671,808 B | `BB5101F1454A12B4BFB66A1DA9F89D9F725776117B65F6D28EC9D41E6582B717` |
| `target/release/mermaid-desk.exe` | 14,476,800 B | `B86FBC6544567603FD1552C04B1E287AAEA8F491C949AF1BAF4A35D5C320639C` |

Silent NSIS installation (`MermaidDesk_1.0.0_x64-setup.exe /S`) verified on the final
build: installed at `%LOCALAPPDATA%\MermaidDesk\mermaid-desk.exe` (per-user, no
elevation), Add/Remove Programs entry `MermaidDesk 1.0.0` with uninstaller, version
metadata `1.0.0`, and launching the installed executable with a diagram opens it
(window title `installed-verify.mmd - MermaidDesk`).

File associations registered under `HKCU\Software\Classes`:
`.mmd` → `Mermaid Diagram`, `.mermaid` → `Mermaid Diagram`, plus the `Mermaid Diagram`
ProgID. (Checked with `Get-ItemProperty HKCU:\Software\Classes\.mmd`.)

## 4. Offline behaviour

- All renderer assets (Mermaid 12.3.0, Monaco 0.55.1, React, fonts from the OS) are
  bundled by Vite and embedded in the executable; nothing is fetched from a CDN.
- Production CSP forbids remote scripts, styles, fonts, images, frames and connections.
- The Playwright scenario "renders and exports with every remote request blocked"
  aborts every request outside `http://127.0.0.1:4173` before reloading the app, then
  renders the diagram, opens the export menu and completes a PNG rasterisation.
- No hosted renderer is used: there is no mermaid.ink/Kroki code path, and exports are
  written by Rust after a local canvas conversion.

## 5. Continuous integration

Both workflows were executed on GitHub, not just written:

| Workflow | Run | Result |
| --- | --- | --- |
| `ci.yml` (push) | [44706084267](https://github.com/mchandru13/mermaid-desk/actions/runs/44706084267) | **all 5 jobs green** — frontend, browser E2E, Rust on Windows, macOS and Ubuntu |
| `build.yml` (manual) | [44703728464](https://github.com/mchandru13/mermaid-desk/actions/runs/44703728464) | **all 3 bundle jobs green**; artifacts `mermaid-desk-windows`, `mermaid-desk-macos`, `mermaid-desk-linux` |
| `build.yml` (tag `v1.0.0`) | [44707864055](https://github.com/mchandru13/mermaid-desk/actions/runs/44707864055) | **all 3 bundle jobs green**; draft release created with 6 assets |

The Windows artifact was downloaded and inspected: `MermaidDesk_1.0.0_x64-setup.exe`
(6.21 MB) and `MermaidDesk_1.0.0_x64_en-US.msi` (7.24 MB).

### Release path

Tagging `v1.0.0` exercised the release branch end to end:

- Draft release `MermaidDesk v1.0.0` created automatically, then published manually.
- Six assets attached: Windows `.exe` + `.msi`, macOS `.dmg` + `.app.tar.gz`,
  Linux `.deb` + `.AppImage`.
- The released Windows installer was downloaded from GitHub, installed silently, and
  launched. It opened the test diagram cleanly (no spurious dirty flag), rendered,
  fitted and centred correctly (dx −0.005 px, dy −0.010 px).
- Released Windows asset hashes differ from the local build (independent toolchain and
  build timestamps), so the *downloaded* artifacts were verified rather than assumed.

| Released asset | Size | SHA-256 |
| --- | --- | --- |
| `MermaidDesk_1.0.0_x64-setup.exe` | 6,512,108 B | `3983301FF62D1C0AC7B4A40BF19A2A27FEFF6265B11C1C5B4EAB6177F23C1719` |
| `MermaidDesk_1.0.0_x64_en-US.msi` | 7,589,888 B | `40997E940085DF24767BE93627E9F04BAE8D7A5F024C02B84415C8FF63D71771` |

The desktop E2E suite remains a local script because it needs a real Tauri window,
native dialogs and WebView2.

CI exposed two real portability problems, both fixed:

- Three settings tests assumed `C:\...` is an absolute path; it is not on macOS/Linux,
  so the recent-file filter (correctly) dropped them. Tests now use the host temp
  directory.
- `upload-artifact@v7` renamed the `if-no-files-found` value `warning` to `warn`.

The desktop E2E suite remains a local script because it needs a real Tauri window,
native dialogs and WebView2.

## 6. REA evidence for the shipped build

| Item | Evidence |
| --- | --- |
| Target | `mermaid-desk.exe`, PE32+ / amd64, 14,489,600 bytes (intermediate build) |
| Identity | SHA-256 `13a800a5d988c5c7bce8261b6a826a1e5346b5659a092d9a77eadd1132a6d05b`, Evidence `ev_c31d6470bfd1c757f517d93576919565669516dd197ccbe55591e75aa8bb9980` |
| Compiler | `rustc` commit `0ef1bc386059596dada8fb65b50425aab2ea637a` inferred from the embedded `/rustc/` path |
| PE resources | Icon/version resource tree parsed successfully, Evidence `ev_da7924be29d65d97f5d0db5ed354df4f34397a79b2b435b99455903d53343ccc` |
| Rust dependencies | Not enumerable: the build does not enable `cargo-auditable`, so `.dep-v0` is absent (`auditable_metadata: null`) — this is missing metadata, not proof of zero dependencies |

The REA inspection was performed on an intermediate release build of this same source
tree (SHA-256 `13a8...`). Later changes (removing an unused menu item and a dead
shortcut branch, splitting the save/export/drop commands into testable helpers, and
adding an event bus for the browser test backend) rebuilt the artefacts, so the final
files above have their own hashes; no dependency or build-setting changes were made.

Limitations encountered:

- The third-party `MermaidUI` MSI is an OLE compound document that REA rejects as an
  unsupported format; it was assessed from its published release metadata and the
  matching v1.3.1 source.
- A REA `search_strings` call over the 14 MB PE terminated the MCP server (exit 134,
  V8 crash). The call was not repeated. Frontend assets inside a Tauri binary are
  compressed, so a plain string scan was treated as bounded negative evidence only;
  offline behaviour is instead established by the aborted-request test above.

## 7. Known limitations of this verification

- **Drag-and-drop gesture:** the OS-level drag from Explorer into the window is not
  automated (it needs real OLE drag input, which this session blocks). The pieces it
  feeds are covered: Rust `open_dropped_impl` filtering (absolute paths, extension
  allowlist, missing files, 32-file cap) and the frontend wiring through the same
  `drag-drop` event path Tauri delivers, driven in Playwright with mixed valid/invalid
  paths and an empty drop.
- **Keyboard shortcuts in the packaged app:** the desktop script uses real key events
  for Ctrl+A and text entry, and the native File > Save menu. The complete shortcut map
  is verified in Chromium (Playwright); the desktop build shares that handler code.
- **MSI:** built by WiX and present, but only the NSIS installer was silently
  installed, because both share one product identifier and testing both would require
  an uninstall cycle.
- **Signing:** the installer is unsigned; Windows SmartScreen will warn until a
  code-signing certificate is configured.
- **Dialog mechanics:** the native file-name field is DirectUI-hosted and ignores
  `WM_SETTEXT`/UI Automation `ValuePattern`; the harness writes it with
  `EM_REPLACESEL` + `BM_CLICK` and then verifies the resulting file, which is what the
  user-visible flow produces.


