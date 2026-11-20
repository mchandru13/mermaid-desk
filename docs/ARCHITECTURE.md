# MermaidDesk architecture

## 1. Process and trust boundaries

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri window (WebView2 / WKWebView / WebKitGTK)              │
│                                                              │
│  React UI ── Monaco (bundled worker)                         │
│      │                                                       │
│      ├── Mermaid.js (bundled) ── DOMPurify + SVG hardening   │
│      └── Canvas rasteriser (PNG)                             │
│      │                                                       │
│      │  invoke() — typed commands only                       │
└──────┼───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ Rust core (Tauri 2)                                          │
│  documents: read / open / save / save-as / export / drop     │
│  settings:  atomic JSON in the app config dir                │
│  dialogs:   native open/save (rfd via tauri-plugin-dialog)    │
│  OS:        file association argv, single instance, menu     │
└──────┬───────────────────────────────────────────────────────┘
       │
   Local disk (user-chosen .mmd files, settings.json)
```

The webview is untrusted. It cannot read or write files directly: the capability file
grants no `fs`, `dialog` or `shell` permissions. Every disk operation is a Rust command
that validates the request.

## 2. Security controls

| Risk | Control | Where |
| --- | --- | --- |
| Renderer reads arbitrary files | A path is readable if the user authorised it, or if it carries a diagram extension (`.mmd`, `.mermaid`, `.md`, `.txt`) so recent files survive a restart. This is the one place the boundary is weaker than the write path; closing it needs native-owned recents | `src-tauri/src/documents.rs` (`read_document`) |
| Renderer writes arbitrary files | `save_document` requires a path already authorised this session; Save As and every export always show a native dialog owned by Rust | `documents.rs`, `export_document` |
| Renderer opens Explorer at arbitrary paths | `reveal_document` requires authorisation, like writes and reads-with-dialog | `reveal_target` |
| Path traversal / symlinks | Paths are canonicalised before authorisation and comparison; new files resolve against a canonical parent | `canonical_existing`, `canonical_target` |
| Oversized / binary input | 8 MiB document cap, UTF-8 validation, 64 MiB export cap | `MAX_DOCUMENT_BYTES`, `MAX_EXPORT_BYTES` |
| Clipboard abuse | Only PNG is accepted; the payload is capped at 32 MiB base64, 10,000 px per side and 32 MP, and the header is checked before decoding. The frontend scales its raster to that budget, decoding runs off the main thread, and one long-lived `arboard` handle is owned by the app (X11/Wayland serve clipboard data from the owning process). Nothing is written to disk and no webview clipboard capability is granted | `src-tauri/src/clipboard.rs` |
| Partial writes / corruption | Writes go to a temp file in the destination directory, `sync_all`, then atomic replacement rename; settings keep one backup | `write_atomic`, `settings.rs` |
| Concurrent modification | mtime conflict detection; the UI asks before overwriting | `save_document` + `App` confirm dialog |
| Script execution through a diagram | Mermaid `securityLevel: "strict"`, `htmlLabels: false`, DOMPurify SVG profile, then a hardening pass that strips scripts, `on*` handlers, `foreignObject`, remote `href`/`src`, and CSS `@import`/`expression` | `src/lib/render.ts` |
| Remote code or data | CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (Mermaid injects scoped styles), `img-src 'self' data: blob:`, `connect-src 'self' ipc: http://ipc.localhost`, `frame-src 'none'`, `object-src 'none'`; no `<iframe>`, no remote fonts | `src-tauri/tauri.conf.json` |
| Privilege escalation through settings | `Settings::sanitized` clamps sizes/scales, validates theme names, filters non-absolute and duplicate recent paths, caps the list at 15 | `settings.rs` |
| IPC abuse | Only the thirteen commands in `lib.rs` are exposed; each has a narrow input shape | `lib.rs` |
| Untrusted window content | Single window, no external navigation, no `window.open` usage, no shell open of web content | `tauri.conf.json` |

Trade-off: `style-src 'unsafe-inline'` is required because Mermaid renders a scoped
`<style>` block inside the diagram. Inline *scripts* remain blocked, and the hardening
pass removes style rules that would fetch remote resources, so this does not create a
network path.

## 3. Document model

```ts
interface OpenDocument {
  id: string;          // stable client identity (Monaco model URI, tab key)
  path: string | null; // null until the first Save As
  name: string;        // display name, from the file name
  content: string;     // current source
  baseline: string;    // content at last read/write — drives dirty state
  modified: number | null; // mtime ms recorded from Rust
}
```

* `isDirty(doc) = doc.content !== doc.baseline`.
* Tabs are independent documents; closing a dirty tab prompts Save / Discard / Cancel.
* Window close is intercepted (`onCloseRequested`) and lists the number of unsaved
  documents before allowing the window to be destroyed.
* Opening a path that is already open focuses the existing tab (case-insensitive on
  Windows, case-sensitive elsewhere).
* New documents have `path = null` and are saved through the native Save As dialog,
  which appends `.mmd` when no extension is typed.
* Optional auto-save applies only to documents that already have a path.

## 4. Rendering pipeline

1. Debounce the source by 200 ms.
2. `mermaid.parse(source)` — produces precise syntax errors before any DOM work.
3. `mermaid.render()` with `securityLevel: "strict"`, `htmlLabels: false`,
   `useMaxWidth: false`, themes and theme variables matched to the app theme.
4. DOMPurify (SVG profile) sanitisation.
5. XML hardening pass (scripts, event handlers, foreign objects, remote references,
   dangerous CSS) via `DOMParser` + `TreeWalker`.
6. Root `<svg>` gets `xmlns`, a derived `viewBox`, and is inserted into the preview.
7. On error, the last good SVG stays visible and a diagnostic panel shows the message
   with a line number and a "Go to line" action.

Using SVG `<text>` labels rather than `<foreignObject>` keeps SVG exports portable and
makes PNG rasterisation reliable in every WebView.

## 5. Preview interaction

Zoom and pan are CSS transforms over the sanitized SVG (`translate(...) scale(...)`),
so no re-render happens while navigating. Fit-to-window measures the container with a
`ResizeObserver` and the SVG viewBox. Ctrl/Cmd + wheel zooms at the pointer; dragging
pans. The same numbers are used by the toolbar, the status bar, and keyboard shortcuts.

## 6. Export

* **SVG:** serialise the sanitized, namespaced SVG produced by the renderer; write via a
  native Save dialog (`export_document`, kind `svg`).
* **PNG:** inline the SVG with an opaque theme background, load it through a `Blob`
  URL into an `Image`, draw it on a canvas at 2× (clamped to 8192 px), then send the
  base64 payload to Rust for a native write.
* **Beside diagram:** for saved documents, "Export beside diagram" skips the dialog and
  writes `<name>.svg`/`<name>.png` into the document's own folder
  (`export_beside_document`). That folder was already authorised by the Open/Save
  dialog, and an existing file produces a confirmation prompt instead of a silent
  overwrite. This is also the path used by the automated desktop verification.
* **Clipboard:** the same PNG the exporter produces is sent to Rust as base64;
  `copy_image_to_clipboard` validates it, decodes it to RGBA and writes it with
  `arboard`. The frontend never gets clipboard access and the image is never written to
  disk. `Ctrl+Shift+C` copies; the transparent variant is in the Export menu.
  Two platform details matter and are handled: the frontend caps the raster at the same
  32 MP budget Rust enforces, and the `arboard::Clipboard` is application-owned rather
  than created per call, because on X11/Wayland the clipboard content is served by the
  owning process and disappears when the handle is dropped. The Linux build enables
  `wayland-data-control` so a pure Wayland session works.
* No mermaid.ink, Kroki, or any hosted renderer is used.

## 7. Settings and recents

`settings.json` lives in the platform config directory
(`%APPDATA%\dev.mermaiddesk.app` on Windows) and stores theme, editor preferences,
auto-save, preview scale, and up to 15 recent absolute paths. It is written atomically
with a single backup, and a corrupt file falls back to defaults without being rewritten.

## 8. OS integration

* **File associations:** `bundle.fileAssociations` registers `.mmd`/`.mermaid`
  (`text/vnd.mermaid`) in the installer; the first instance reads them from `argv`.
* **Single instance:** `tauri-plugin-single-instance` forwards paths from a second
  launch to the running window and focuses it.
* **Drag and drop:** Tauri's window drag-drop event sends absolute paths to
  `open_dropped_documents`, which applies the extension allowlist.
* **Native menu:** File / Edit / View / Help items emit command ids to the React layer,
  so menus and shortcuts share one implementation.
* **Window state:** size/position persisted by `tauri-plugin-window-state`.

## 9. Cross-platform readiness

* Rust, React, Monaco and Mermaid are platform neutral; no Windows-specific APIs are
  used outside `cfg_attr(windows_subsystem)`.
* Paths are handled with `PathBuf` and normalised only for UI comparison.
* Native dialogs, atomic rename, file associations and single-instance are provided by
  cross-platform Tauri plugins/APIs.
* Icons for macOS (`.icns`) and Linux (`png`) are generated and committed.
* Adding macOS/Linux installers is a matter of building on those hosts (see README);
  the `bundle.targets` list already covers `app`, `dmg`, `deb`, `rpm`, `appimage` when
  built on the matching platform.

## 10. Testing strategy

| Level | Tool | Coverage |
| --- | --- | --- |
| Rust unit/integration | `cargo test` | path validation, authorisation helpers, **reveal authorisation**, Save As and export write logic, drag-and-drop filtering, atomic writes, size/UTF-8 limits, startup argument filtering, settings round-trip/sanitisation/backup/corruption, verbatim path display |
| Frontend unit | Vitest + Testing Library | tab model, dirty tracking, recents, diagram type detection, shortcuts, sanitisation/hardening, export helpers, clipboard PNG headers, workspace hook (mock IPC) |
| Browser E2E | Playwright (production bundle) | render, live edit, diagnostics, save flow, templates, unsaved guard, SVG/PNG/beside export, clipboard copy (opaque and transparent, pixels decoded), zoom/pan/theme, dialogs, multi-tab, drag-and-drop, native-menu actions, OS hand-off, all remote requests blocked |
| Desktop E2E | tauri-driver + Edge WebDriver + Win32 dialog/menu automation + CDP | launch, native Open, real typing, Save, relaunch/reopen, window-close guard, native menu Save, Save As written and switched, Export dialog, real SVG/PNG files, **Copy PNG read back from the Windows clipboard**, OS hand-off, direct launch at real size (BOM-clean, centred, fitted) |
| Release tooling | `node --test` (`npm run test:scripts`) | changelog section extraction (tag/ref normalisation, similar versions, CRLF, missing section), version bump/check across all four files, real-tree consistency |
| Dependencies | `npm audit --omit=dev`, OSV against both lockfiles | no production advisories; dev-only and transitive findings are listed in `docs/VERIFICATION.md` |
| Continuous integration | GitHub Actions (`.github/workflows/`) | typecheck, Vitest, release tooling tests, version consistency, build, Playwright E2E; Rust fmt/clippy/tests on Windows/macOS/Ubuntu; installer bundles and changelog-derived release notes on all three platforms |
| Installer | Silent NSIS install + registry/window inspection | per-user install, uninstall entry, file associations, installed launch, single-instance hand-off |

The Playwright suite runs the same UI bundle with an in-memory IPC backend because
Chromium cannot host native dialogs. Native commands are covered by Rust tests and the
desktop run, so the two halves meet at the documented IPC contract. Exact results and
gaps are recorded in `docs/VERIFICATION.md`.

## 11. Known limitations

* One window; documents live in tabs inside it.
* No collaborative editing or cloud sync (out of scope by design).
* Markdown files can be opened but the editor does not extract fenced Mermaid blocks.
* Auto-save excludes never-saved documents (they still need one Save As).
* The installer is unsigned; Windows SmartScreen will warn until a code-signing
  certificate is configured.
