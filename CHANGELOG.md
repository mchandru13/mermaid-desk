# Changelog

All notable changes to MermaidDesk are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The section for a version is what the GitHub release publishes verbatim, so write
it for people deciding whether to upgrade (see `docs/RELEASING.md`).

## [Unreleased]

### Fixed

- The **Help** menu items did nothing. The native menu sent `shortcuts`, `about` and
  `templates`, but the frontend only understood `toggle-shortcuts` and had no handler
  for the other two, so every Help item fell through to a no-op. The menu now sends the
  same action names the frontend uses (`toggle-shortcuts`, `open-about`,
  `open-templates`), and a Playwright test asserts that each one opens its dialog. The
  toolbar buttons were unaffected, which is why the problem was easy to miss.

### Verification

70 Vitest, 69 Rust and 31 release-tooling tests, 26 Playwright scenarios and 54 checks
against the installed Windows build.

## [1.3.0] - 2026-11-21

Four more diagram types, and a hardening pass on exported files.

### Added

- **Architecture**, **Packet diagram**, **Kanban board** and **Treemap** are now in
  the template gallery. Mermaid already supported them and the editor already
  recognised their keywords, but there was no template to start from. They use the
  same preview, sanitisation and export path as every other diagram, so there is
  nothing new to learn or configure.

### Security

- A diagram can no longer carry a remote fetch into an exported `.svg`. The hardening
  pass removed `@import`, `expression(` and `javascript:` from a style block but kept
  `url(https://…)` inside it. The app's own CSP blocked the request while the diagram
  was on screen, but an exported file carries no CSP, so the rule came alive when you
  opened it in a browser. Remote schemes and protocol-relative URLs are now dropped.
  `url(#id)` references are kept, because Mermaid draws its arrowheads and gradients
  with them.
- The release workflow no longer interpolates the tag name into shell commands, and no
  longer leaves a write-scoped token in the working tree where a dependency's install
  script could read it. This changes nothing you can see in the app; it protects the
  installers you download.

### Fixed

- The editor no longer claims two diagram types Mermaid cannot draw. `zenuml` needs a
  plugin that is not bundled, and `usecase` is not a Mermaid diagram at all; a document
  starting with either showed a "No diagram type detected" error instead of a drawing.
  They now report as unrecognised, like any other unknown syntax.

### Verification

70 Vitest, 69 Rust, 25 release-tooling tests, 25 Playwright scenarios and 54 checks
against the installed Windows build. The template-geometry test now covers all 19
built-in templates and asserts that the four new ones actually render as their own
Mermaid type rather than falling back to a flowchart.

## [1.2.1] - 2026-11-21

A security fix for the beside-export; no new features.

### Security

- "Export beside diagram" no longer lets the webview authorise a file replacement.
  Previously the command wrote `<name>.svg`/`<name>.png` beside an open document and
  treated a renderer-supplied `overwrite` flag as permission to replace an existing
  file, so a compromised renderer could silently clobber or plant a same-named file the
  app had never opened. Replacing an existing export now goes through a native dialog
  owned by Rust. PNG exports must also begin with the PNG signature, so the export path
  can no longer be used to write arbitrary bytes.

### Verification

67 Rust tests, 64 Vitest tests, 25 Playwright scenarios and 54 checks against the
installed Windows build. The desktop suite declines and then approves the replace
prompt and asserts the exported file is untouched after the first and rewritten after
the second.

## [1.2.0] - 2026-11-20

Open tabs and unsaved edits now survive a restart or a crash.

### Added

- Session recovery: open tabs and unsaved buffers are restored after a restart or a
  crash, so an untitled diagram is no longer lost. Clean files are re-read from disk;
  a dirty buffer keeps the modification time it was based on, so an external edit still
  triggers the overwrite prompt. A confirmed "close without saving" leaves those
  buffers out of the recovery file instead of bringing them back. With more than 20
  open tabs, unsaved ones are kept in preference to clean ones.

### Fixed

- The Exit menu item and `Ctrl+Q` now run the unsaved-changes guard and flush the
  recovery session, instead of terminating the process immediately.

### Verification

66 Rust tests, 64 Vitest tests, 25 Playwright scenarios and 45 checks against the
installed Windows build, including quitting with an unsaved edit and relaunching to
find it restored. Checksums for the installers are published in these notes.

## [1.1.1] - 2026-11-20

A security patch. Upgrading is recommended for anyone running 1.1.0.

### Security

- Pin the `dompurify` copy that `monaco-editor` bundles to the current 3.4.18 via an
  npm override. The bundled 3.2.7 matched 22 advisories; this app never feeds Monaco
  untrusted markdown, so it was not exploitable here, but it shipped.
- `read_document` now requires authorisation or membership in the persisted recent
  list, closing the gap where any absolute `.mmd`/`.mermaid`/`.md`/`.txt` path could
  be read. `save_app_settings` only accepts recents that are authorised this session
  or already persisted, and persisted recents must now use a diagram extension, so a
  settings file poisoned by an older build cannot act as a capability. The Open dialog
  offers only those extensions, so every opened file can be a valid recent.
- Drag-and-drop paths are captured by Rust from the window event. The webview no
  longer supplies them: the removed `open_dropped_documents` command could previously
  authorise, read and then overwrite any `.mmd`/`.md`/`.txt` file on disk.
- `reveal_document` now refuses any path that was not opened or saved in this session,
  matching the read/write authorisation model instead of opening Explorer for
  arbitrary paths.
- Tighten the Content Security Policy to `frame-src 'none'`; nothing in the app uses
  frames.
- CI fails when a production dependency has a moderate-or-higher advisory, and every
  release now publishes SHA-256 checksums in the notes and as `SHA256SUMS.txt`.

### Changed

- Open dialog: only the diagram filters are offered, so a file opened from the app can
  always appear in Recent files.
- Settings schema is version 2; recent entries without a diagram extension are pruned
  on load.

### Verification

49 Rust tests, 56 Vitest tests, 24 Playwright scenarios and 43 checks against the
installed Windows build, including reading the copied image back from the real
clipboard and reopening a recent document after a restart.

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
