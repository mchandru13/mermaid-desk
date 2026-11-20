# Changelog

All notable changes to MermaidDesk are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The section for a version is what the GitHub release publishes verbatim, so write
it for people deciding whether to upgrade (see `docs/RELEASING.md`).

## [Unreleased]

### Security

- Pin the `dompurify` copy that `monaco-editor` bundles to the current 3.4.18 via an
  npm override. The bundled 3.2.7 matched 22 advisories; this app never feeds Monaco
  untrusted markdown, so it was not exploitable here, but it shipped.
- `reveal_document` now refuses any path that was not opened or saved in this session,
  matching the read/write authorisation model instead of opening Explorer for
  arbitrary paths.
- Tighten the Content Security Policy to `frame-src 'none'`; nothing in the app uses
  frames.
- CI fails when a production dependency has a moderate-or-higher advisory, and every
  release now publishes SHA-256 checksums in the notes and as `SHA256SUMS.txt`.

- `read_document` now requires authorisation or membership in the persisted recent
  list, closing the gap where any absolute `.mmd`/`.mermaid`/`.md`/`.txt` path could
  be read. `save_app_settings` only accepts recents that are authorised this session
  or already persisted, and persisted recents must now use a diagram extension, so a
  settings file poisoned by an older build cannot act as a capability. The Open dialog
  offers only those extensions, so every opened file can be a valid recent.
- Drag-and-drop paths are captured by Rust from the window event. The webview no
  longer supplies them: the removed `open_dropped_documents` command could previously
  authorise, read and then overwrite any `.mmd`/`.md`/`.txt` file on disk.

### Verification

49 Rust tests, 56 Vitest tests, 24 Playwright scenarios and 40 checks against the
installed Windows build, including reading the copied image back from the real
clipboard and confirming it survives after the command returns.

## [1.1.0] - 2026-11-20

### Added

- Copy the current diagram to the clipboard as a PNG with `Ctrl+Shift+C`, or from the
  Export menu. An opaque variant uses the theme background so it stays readable
  wherever it is pasted; a transparent variant is available for matching backgrounds.
  The image is rasterised locally and written by Rust, so nothing touches disk and the
  webview still has no clipboard or filesystem access.

### Changed

- Release notes are now generated from this changelog, so the release page and the
  repository cannot drift apart. The installer workflow refuses to build when a tag
  disagrees with the app version or when the changelog has no section for that version.

### Verification

40 Rust tests, 56 Vitest tests, 24 Playwright scenarios and 40 checks against the
installed Windows build, including reading the copied image back from the real
clipboard and confirming it survives after the command returns.

The clipboard feature was reviewed before release; the review found and fixed four
cross-platform defects: the X11/Wayland ownership lifetime, a missing Wayland backend,
a blocking decode on the UI thread, and a raster budget that disagreed with the
validator.

## [1.0.0] - 2026-11-20

First public release. Windows, macOS (Apple silicon) and Linux installers are
attached to the GitHub release. The application is offline-first: no account, no
telemetry, no network requests for rendering or export.

### Added

- Split-pane editor: Monaco on the left, live Mermaid preview on the right, with a
  draggable split that starts at 50/50 and is remembered between sessions.
- Multi-document tabs with per-tab unsaved-change guards and a confirmation before
  the window closes.
- Native file handling in Rust: open, save, save as and reopen local `.mmd` and
  `.mermaid` files, with atomic writes, modification-time conflict detection, an
  8 MiB size cap and UTF-8 validation.
- Export to SVG (opaque or transparent background) and 2x PNG, rasterised locally
  from the current render, plus "save beside the diagram" for quick iteration.
- Zoom in/out, 100%, fit-to-window and drag-to-pan on the preview.
- Light, dark and system themes, applied to the application shell and the diagram.
- 15 diagram templates: flowchart, sequence, class, state, entity relationship,
  Gantt, mindmap, timeline, pie, user journey, git graph, C4, XY chart, block and
  Sankey.
- Inline diagnostics with the parser message and the correct editor line, including
  front-matter and comment offsets, in a panel docked below the preview.
- Recent files, file associations for `.mmd` and `.mermaid`, drag-and-drop opening,
  and single-instance hand-off so a second launch reuses the running window.
- Native application menu and keyboard shortcuts for every document action.

### Security

- Mermaid runs with `securityLevel: "strict"` and `htmlLabels: false`, and rendered
  output passes through DOMPurify plus a hardening pass before it reaches the DOM.
- Strict Content Security Policy. The webview has no filesystem, dialog or shell
  capability: every file operation goes through Rust and is limited to paths the
  user chose through a native dialog, the command line or a drop.

### Fixed

- The editor and preview keep an exact 50/50 split instead of drifting with content.
- Diagrams are centred on their painted bounds, including when the viewBox origin is
  not at 0,0.
- Opening a UTF-8 BOM file no longer marks the document as modified.
- Render errors dock below the preview instead of covering the diagram.
- The Gantt "today" marker no longer stretches the viewport to roughly 8,500 px.
- The block and pie templates render correctly in both themes.
- Exports use a tight viewBox and the active theme background, with unique element
  ids so repeated exports never collide.

### Verification

30 Rust tests, 49 Vitest tests, 22 Playwright scenarios and 35 checks against the
installed Windows build. CI runs the frontend, browser E2E and Rust suites on
Windows, macOS and Ubuntu. Run IDs and evidence are in `docs/VERIFICATION.md`.
