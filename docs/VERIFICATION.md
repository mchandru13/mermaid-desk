# Verification report

Date: 2026-11-20
Host: Windows 11 x64 (WebView2 157.0.4341.60), Node 24.13.0, Rust 1.100.0 (MSVC),
Visual Studio 2022 Build Tools, tauri-driver 2.1.0, Edge WebDriver 157.0.4341.60.

This report records what was actually executed. Anything not executed is listed under
"Known limitations" rather than claimed as verified.

## 1. Automated suites

| Suite | Command | Result |
| --- | --- | --- |
| Rust unit/integration | `cargo test` (in `src-tauri`) | **69 passed, 0 failed** |
| Frontend unit/integration | `npm run test` (Vitest) | **70 passed, 0 failed** across 6 files |
| Production UI E2E | `npm run build && npm run test:e2e` (Playwright, Chromium 159) | **26 passed, 0 failed** |
| Desktop E2E | `npm run test:desktop` (tauri-driver + WebView2 + real Rust binary) | **54 checks passed** |
| Release tooling | `npm run test:scripts` (node --test) | **31 passed, 0 failed** |
| Type check | `npx tsc --noEmit` | clean |

Rust coverage: path canonicalisation, verbatim-path display, extension allowlists,
atomic replace, missing-directory creation, 8 MiB limit (read and write), invalid UTF-8,
**UTF-8 BOM stripping and CRLF round-tripping**, startup argument filtering,
authorisation refusal, recreating a deleted authorised file,
**Save As write logic (extension defaulting, oversized content, missing folder)**,
**export encode/write (SVG, base64 PNG, bad payload, unknown format)**,
**clipboard PNG decoding (signature, base64, zero/oversized dimensions, RGBA output,
and rejection before the clipboard is touched)**,
**reveal authorisation (refuses paths that were not opened, relative paths and missing
files)**, **recent-file trust (reads require authorisation or a persisted diagram
recent; forged and legacy non-diagram recents are dropped)**, **native drop filtering
(extension, absolute path, existence, 32-file cap, and queuing is not authorisation)**,
**beside-export authorisation (a renderer flag cannot authorise a replacement; the
decision lives in `export_target`, which is unit-tested without a dialog and keeps the
destination confined to the document's own stem), and PNG export signature rejection**,
settings round-trip and split clamping, corrupt-file fallback, backup creation,
recent-file cap.

Frontend coverage: tab model and dirty baselines, path comparison (Windows/macOS),
recents, diagram-type detection, shortcut mapping, SVG sanitisation/hardening
(**remote `url()` schemes dropped while `url(#id)` survives**, in a style block and in a
style attribute), parse
-error line extraction, export naming/backgrounds/base64 lengths, **clipboard PNG
headers and the copy flow**, workspace controller
(open, edit, save-as, reopen, close guards, cycling, **dropped paths**, **menu actions**).

Playwright scenarios: welcome render, live edits + error recovery, save flow, template
tab, unsaved-change guard (Cancel/Discard), SVG+PNG+beside export, zoom/fit/pan/theme,
shortcuts+settings, multi-tab switching, drag-and-drop (mixed valid/invalid paths),
empty drop, native-menu actions (new/save/close), OS hand-off after startup, split
persistence, **copying the diagram as an opaque and a transparent PNG (decoded in
Chromium and checked pixel by pixel)**, and a run with **every non-localhost request
aborted**.

New in this pass: a template-geometry test walks **all 19 built-in templates** and
asserts each is centred on its painted artwork (not the viewBox), fits the pane, has no
percentage width or `max-width` cap on the root SVG, draws real content, keeps the Gantt
chart's width sane, and renders every Block-diagram box. It also asserts Mermaid's own
`aria-roledescription` for the Architecture, Packet, Kanban and Treemap templates, so a
template whose syntax stops parsing — and therefore falls back to the default flowchart —
fails instead of passing as "centred". A diagnostics test asserts the
reported line matches the edited file through front matter and `%%` comments. An export
test asserts SVG files carry a background aligned to the viewBox, tight/centred bounds,
theme text colours, and no script. Clipboard tests decode the copied PNG and assert the
background alpha, and the desktop run reads the image back from the real clipboard.

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

Desktop checks in detail (45): launch + render; native Open dialog; type detection; **even
editor/preview split, diagram centred and fitted**; real typing; Save to disk; save
toast; relaunch + reopen; clean state after reopen; window close guard appears and can
be cancelled; **native File > Save menu** reaches the same handler and writes;
**Save As dialog filled and confirmed, file written, app switches to it**;
**Export… dialog filled and confirmed, clean SVG written**; SVG and PNG export beside
the diagram (markup, no scripts, no remote references, valid PNG signature and size);
**native File > Copy PNG, then the image read back from the Windows clipboard
(dimensions, opacity, theme background), and still present 2.5 s later**;
**quit, relaunch, and reopen this run's saved file from the Recent menu (saved
content, active tab)**, **quit with an unsaved edit and find it restored after
relaunch**;
OS file hand-off; **a direct launch with a file argument opens it clean (BOM), renders,
and centres/fits at the real window size**, inspected over WebView2's debugging
endpoint. A screenshot of the running desktop app is written to `docs/screenshot.png`
(captured over that endpoint, so it is exactly what the window shows).

## 1b. Clipboard

`Ctrl+Shift+C` (or File ▸ Copy PNG) rasterises the live preview, sends the PNG to Rust
and writes it to the OS clipboard. The image never touches disk.

- **Chromium (Playwright):** both variants are decoded back and inspected. The opaque
  copy is 255-alpha with `rgb(255,255,255)` padding; the transparent copy is 0-alpha
  there. The payload starts with the PNG signature and matches the reported dimensions.
  The opaque case is triggered by the real `Ctrl+Shift+C` key event.
- **Windows desktop:** the native File ▸ Copy PNG item was invoked through
  `WM_COMMAND`, then `System.Windows.Forms.Clipboard.GetImage()` returned
  `752x190 a=255 rgb=13,17,23` — a real image at the dark theme's background, read back
  from the OS clipboard rather than from the app.
- **Rust:** non-base64, non-PNG, zero-sized and oversized payloads (over 10,000 px,
  9,000 × 9,000 by pixel count, or over 32 MiB of base64) are rejected before
  `arboard` is constructed, so the guards run on headless CI. The frontend scales its
  raster to the same 32 MP budget (`pngPixelSize`), so a large diagram is resized
  rather than refused.
- **Clipboard ownership:** the `arboard::Clipboard` is held by the application, not
  created per call, because X11/Wayland serve clipboard data from the owning process.
  The desktop check re-reads the clipboard after 2.5 s to prove the content persists.

## 1c. Security hardening

Checked on 2026-11-20 against the lockfiles after the security overrides:

| Check | Before | After |
| --- | --- | --- |
| `npm audit --omit=dev` | 2 moderate (`dompurify@3.2.7` bundled by Monaco, plus Monaco itself) | **0 vulnerabilities** |
| OSV against `Cargo.lock` | 7 matches | 7 matches, all unmaintained/transitive |

The production fix is an npm override pinning `dompurify` to 3.4.18 for every
consumer, so Monaco's private copy is deduped to the patched version (`npm ls
dompurify` shows one entry). The app never feeds Monaco's markdown renderer untrusted
content, so the old copy was not reachable — but it was in the shipped bundle.

Dev-only advisories remain and are accepted: `vitest` / `tinypool` / `@vitest/mocker`
(critical, test-time RCE and path traversal) and `happy-dom` (high). None is shipped;
clearing them is a `vitest` major upgrade.

Rust findings are transitive and none is a known exploitable issue:

- `chrono`, `zvariant`, `zbus_names`, `proc-macro-error`: unmaintained (RUSTSEC).
  `chrono` and `zbus` are not in the Windows build.
- `glib 0.18.5`: unsoundness fixed in 0.20, pinned by the GTK stack and not upgradable
  independently of Tauri.

Other changes, covered by the suites above:

- `reveal_document` requires authorisation (two new Rust tests).
- CSP `frame-src 'none'`; the desktop run proves Monaco and Mermaid still render.
- CI fails on a moderate-or-higher production advisory.
- Release checksums: a `checksums` job hashes the attached assets, uploads
  `SHA256SUMS.txt` and appends a marked block to the draft body. It was exercised
  against the published 1.1.0 assets (the `.exe` hash matches the table below), and
  the 1.1.0 notes now carry the block.

### Read and drop boundary

`read_document` used to accept any absolute `.mmd`/`.mermaid`/`.md`/`.txt` path, and
`open_dropped_documents` accepted a path list from the renderer, which let a script
authorise — and then read or overwrite — any diagram-extension file. Both are closed:

- Reads require authorisation or membership in the persisted recent list
  (`read_target`), and only diagram extensions qualify.
- `save_app_settings` refuses recents that are neither authorised nor already
  persisted (`merged_for_write` → `keep_trusted_recents`), and `sanitized` drops
  non-diagram entries, so a legacy poisoned settings file cannot grant a read.
- Drop paths now come from Tauri's window event; `queue_dropped` validates and queues
  them, and the `documents-dropped` event carries only accepted/ignored counts. The
  renderer has no command that takes a path list.
- Six new Rust tests cover refusal, the recents path, removal, forged entries, legacy
  pruning, and drop filtering/capping.

## 1d. Session recovery

`session.json` in the config directory journals the open tabs, so a crash or a plain
restart no longer loses an untitled diagram. Verified at three levels:

- **Rust (17 tests):** saving refuses an unauthorised path; clean documents store no
  content; a file deleted mid-session keeps its unsaved buffer as an untitled document;
  an oversized buffer is rejected; restore re-reads clean files from disk; a dirty
  buffer keeps its baseline *and* its recorded mtime, so an offline edit still triggers
  the overwrite prompt; deleted clean documents are skipped; unreadable, non-diagram and
  non-canonical persisted paths are refused **and left unauthorised**; a corrupt or
  oversized file is moved to `session.corrupt.json` instead of being overwritten.
- **Vitest (4 cases):** the snapshot keeps dirty tabs when it hits the 20-document cap,
  restores the previous session in the hook, keeps an intentionally empty workspace
  empty, and a discard flush leaves the dirty buffer out.
- **Playwright:** typing into a second tab, reloading, and finding both tabs with the
  edit intact and still marked unsaved.
- **Desktop (real build):** type an unsaved edit, quit, relaunch, and the edit is back
  and marked unsaved.

Closing costs were checked too: the window close path flushes the session *after* the
unsaved guard, and File ▸ Exit (now a real command rather than the OS default) runs the
same guard and flush instead of terminating the process.

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
| `build.yml` (tag `v1.1.0`) | [44739900217](https://github.com/mchandru13/mermaid-desk/actions/runs/44739900217) | **all 3 bundle jobs green**; draft release body generated from the changelog, 6 assets |
| `ci.yml` (with release tooling) | [44717716665](https://github.com/mchandru13/mermaid-desk/actions/runs/44717716665) | **all 5 jobs green**, including the new `test:scripts` step (15 cases) and the version consistency check |

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

### Release 1.1.0

`v1.1.0` was cut with the automated path, so the notes were never retyped:

- Run [44739900217](https://github.com/mchandru13/mermaid-desk/actions/runs/44739900217):
  the version guard and changelog extraction passed on all three jobs, all three
  bundles built, and the draft gained six assets.
- The draft body matched `node scripts/release-notes.mjs v1.1.0` **byte for byte**
  (1,179 characters) before the release was published. The checksums job now appends a
  marked block afterwards; the changelog text itself is unchanged.
- `ci.yml` on the same commit ([44739896255](https://github.com/mchandru13/mermaid-desk/actions/runs/44739896255))
  was green on all five jobs.

The **released** Windows installer was then downloaded, silent-installed and driven
with the native menu, rather than trusting the local build:

| Check | Result |
| --- | --- |
| Downloaded `MermaidDesk_1.1.0_x64-setup.exe` | 6,645,085 B, `FF9412007684A23E3A8CCE0CF7C2A2F694F97C7386EB03AB25E787BDF7C29AF4` |
| Installed binary reports | `FileVersion 1.1.0`, `ProductName MermaidDesk` |
| Launch with a `.mmd` argument | window title `release-110.mmd - MermaidDesk` |
| Native File ▸ Copy PNG | invoked through `WM_COMMAND` |
| Clipboard read back | `368x325 a=255 rgb=13,17,23` — a real opaque image on the dark theme background |
| Re-read after 2.5 s | unchanged, so the clipboard handle outlives the command |

The desktop E2E suite remains a local script because it needs a real Tauri window,
native dialogs and WebView2.

CI exposed two real portability problems, both fixed:

- Three settings tests assumed `C:\...` is an absolute path; it is not on macOS/Linux,
  so the recent-file filter (correctly) dropped them. Tests now use the host temp
  directory.
- `upload-artifact@v7` renamed the `if-no-files-found` value `warning` to `warn`.

### Release notes pipeline

`CHANGELOG.md` is now the single source of truth for release notes, and
`build.yml` guards the tag before building. Both paths were exercised on GitHub with
temporary tags, which were deleted afterwards:

| Run | Scenario | Result |
| --- | --- | --- |
| [44718723065](https://github.com/mchandru13/mermaid-desk/actions/runs/44718723065) | tag `v1.0.1-1`, changelog section present | **3/3 bundles green**; draft release body matched `node scripts/release-notes.mjs v1.0.1-1` **byte for byte** (195 characters); 6 assets attached |
| [44719665846](https://github.com/mchandru13/mermaid-desk/actions/runs/44719665846) | tag `v1.0.1-2`, changelog section removed | **3/3 jobs failed in ~30 s at "Extract release notes"**, before any bundle was built, with `CHANGELOG.md has no "## [1.0.1-2]" section`; no release was created |

The version guard was also exercised locally: `set-version.mjs --check --tag v1.0.1`
exits 1 and names each file that disagrees with the tag.

That smoke test surfaced a Tauri constraint now documented in `docs/RELEASING.md`:
the MSI target rejects alphabetic prerelease identifiers (`1.0.0-rc.1`), so only
numeric prereleases or plain `x.y.z` versions can ship an `.msi`.

The desktop E2E suite remains a local script because it needs a real Tauri window,
native dialogs and WebView2.

### Release 1.1.1

The first release that used the checksums job, and the first whose installer was
verified by the full desktop suite:

- Tag run [44757619252](https://github.com/mchandru13/mermaid-desk/actions/runs/44757619252):
  all three bundles and the **Checksums** job succeeded; the draft carried seven
  assets (six installers plus `SHA256SUMS.txt`).
- The generated block matched the attached files: `sha256sum -c SHA256SUMS.txt`
  returned **OK for all six**.
- The changelog prefix of the release body matched
  `node scripts/release-notes.mjs v1.1.1` **exactly** (1,985 characters); the
  checksums block follows it.
- The downloaded Windows installer was installed (`FileVersion 1.1.1`) and the whole
  desktop suite was run **against the installed binary**
  (`MERMAIDDESK_APP=…`): **43/43 checks**, including reopening this run's saved file
  from the Recent menu after a restart — the native read path added in this release.

| Released asset | Size | SHA-256 |
| --- | --- | --- |
| `MermaidDesk_1.1.1_x64-setup.exe` | 6,646,901 B | `8946A6FBF42B331AABBE970880FCE065256EB7409B240F9181CF4657191AEC52` |

### Release 1.2.0

Session recovery, verified on the *released* installer rather than a local build:

- Tag run [44773630638](https://github.com/mchandru13/mermaid-desk/actions/runs/44773630638):
  three bundles plus the **Checksums** job green; seven assets in the draft.
- `sha256sum -c SHA256SUMS.txt` → **OK for all six** installers.
- The changelog prefix matched `node scripts/release-notes.mjs v1.2.0` exactly
  (984 characters) before publishing.
- The downloaded `MermaidDesk_1.2.0_x64-setup.exe` was installed
  (`FileVersion 1.2.0`) and the whole desktop suite was run against it
  (`MERMAIDDESK_APP=…`): **45/45 checks**, including typing an unsaved edit, quitting,
  relaunching and finding the edit restored and still marked unsaved.

| Released asset | Size | SHA-256 |
| --- | --- | --- |
| `MermaidDesk_1.2.0_x64-setup.exe` | 6,658,321 B | `7266EEEF8F2EA6F8B0733A8BD907B7F882BE347B4AE814736A34398A2D4E8FF6` |

### Release 1.2.1

The beside-export authorisation fix, verified on the *released* installer rather than a
local build:

- Tag run [44878771286](https://github.com/mchandru13/mermaid-desk/actions/runs/44878771286):
  three bundles plus the **Checksums** job green; seven assets in the draft.
- `sha256sum` of the downloaded `MermaidDesk_1.2.1_x64-setup.exe` matched
  `SHA256SUMS.txt` (`5b3e8e6b…`).
- The downloaded installer was installed silently and reported
  `FileVersion 1.2.1` / `ProductVersion 1.2.1`.
- The whole desktop suite was run against that installed binary
  (`MERMAIDDESK_APP=…`): **54/54 checks**, including declining and then approving the
  new beside-export replace prompt, with the planted sentinel proving the file is
  untouched after the decline and genuinely rewritten after the approval.

| Released asset | Size | SHA-256 |
| --- | --- | --- |
| `MermaidDesk_1.2.1_x64-setup.exe` | 6,669,444 B | `5B3E8E6B47AB444734958DB0FC74DC544030BB6CB7DF6A9BE8CCD19572F747A4` |

### Release 1.3.0

Four new templates plus the hardening work, verified on the *released* installer:

- The first tag run failed on Windows only, at the tag guard:
  `--tag needs a tag name`. The `$TAG` env indirection added for L2 works in bash but
  not in pwsh, which is the Windows default. Both guard steps now declare
  `shell: bash`; the draft and tag were deleted while nothing was published, and the
  retry succeeded. A CI rule now catches this class (see §2).
- Tag run [44910370364](https://github.com/mchandru13/mermaid-desk/actions/runs/44910370364):
  three bundles plus the **Checksums** job green; seven assets in the draft.
- `sha256sum` of the downloaded `MermaidDesk_1.3.0_x64-setup.exe` matched
  `SHA256SUMS.txt` (`ad389be5…`).
- The downloaded installer was installed silently and reported
  `DisplayVersion 1.3.0`.
- The whole desktop suite was run against that installed binary
  (`MERMAIDDESK_APP=…`): **54/54 checks**.

| Released asset | Size | SHA-256 |
| --- | --- | --- |
| `MermaidDesk_1.3.0_x64-setup.exe` | 6,676,952 B | `AD389BE5944239669EB44C1944E8A4E7E704AF624472DF9F76BB7BEC0D99B83` |

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
  feeds are covered: Rust `queue_dropped` (absolute paths, extension allowlist, missing
  files, 32-file cap) and the frontend wiring through the `documents-dropped` event,
  driven in Playwright with mixed valid/invalid paths and an empty drop. The native
  `WindowEvent::DragDrop` path itself still needs a manual Explorer/Finder check.
- **Keyboard shortcuts in the packaged app:** the desktop script uses real key events
  for Ctrl+A and text entry, and the native File > Save menu. The complete shortcut map
  is verified in Chromium (Playwright); the desktop build shares that handler code.
- **MSI:** built by WiX and present, but only the NSIS installer was silently
  installed, because both share one product identifier and testing both would require
  an uninstall cycle.
- **Signing:** the installer is unsigned; Windows SmartScreen will warn until a
  code-signing certificate is configured.
- **Clipboard on macOS/Linux:** the Rust command uses `arboard` and is built for all
  three platforms (the Linux build enables `wayland-data-control`), but only the
  Windows clipboard was read back. On Linux the image is served by this process, which
  is why the handle is app-owned and the desktop check re-reads after a delay; a
  Wayland compositor without the data-control protocol still needs XWayland. Those
  platforms are otherwise covered by unit tests and CI compilation.
- **Dialog mechanics:** the native file-name field is DirectUI-hosted and ignores
  `WM_SETTEXT`/UI Automation `ValuePattern`; the harness writes it with
  `EM_REPLACESEL` + `BM_CLICK` and then verifies the resulting file, which is what the
  user-visible flow produces.
- **Message-box buttons:** the beside-export replace prompt is a TaskDialog whose
  buttons are DirectUI panes with no window class, no control id, and no UI Automation
  action pattern. `scripts/desktop/dialog-answer.ps1` therefore locates the button by
  its accessible name and clicks its centre. The window is matched by title *and* by
  owning process, so a stale instance or a leftover dialog cannot be clicked by mistake;
  when no app process is found the script refuses rather than falling back to title
  alone. The suite plants a sentinel line in the export and asserts it survives "No" and
  is gone after "Yes", so a mis-click or a no-op write fails the run instead of passing
  silently. The click assumes an interactive desktop session with a real cursor
  position, like the rest of the native-dialog automation.
- **Desktop suite is not in `ci.yml`:** it needs an interactive Windows desktop
  session for WebView2, which a hosted runner does not provide. This was measured, not
  assumed — dispatch run 44893033642 on `windows-latest` started the browser and failed
  with `SessionNotCreatedError: session not created: DevToolsActivePort file doesn't
  exist`. `.github/workflows/desktop.yml` keeps the complete recipe for a self-hosted
  Windows runner, and stays dispatch-only until one exists. Running it locally for a
  release remains the gate in `docs/RELEASING.md`.
- **The security decision does not depend on that gap:** `export_target` decides
  authorisation and whether a replacement needs consent, and it is covered by
  `cargo test` on all three operating systems. The desktop suite additionally proves the
  dialog collects the answer, but a regression in the decision itself fails CI.


