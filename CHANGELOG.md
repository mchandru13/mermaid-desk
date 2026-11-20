# Changelog

All notable changes to MermaidDesk are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The section for a version is what the GitHub release publishes verbatim, so write
it for people deciding whether to upgrade (see `docs/RELEASING.md`).

## [Unreleased]

Nothing yet. Add entries here as changes land; move them into a dated version
section when you cut a release.

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
