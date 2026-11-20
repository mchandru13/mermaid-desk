# AGENTS.md

Instructions for coding agents working in this repository. Read this before changing
code. It is project-specific: the behavioural principles at the top are adapted from
[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT),
the rest describes how MermaidDesk is actually built.

## Working principles

### 1. Think before coding

Do not silently pick an interpretation.

- State assumptions when the request is ambiguous.
- If two designs are plausible, present both with the tradeoff.
- If a simpler approach exists, say so before implementing the complex one.
- If you are confused, stop and name what is unclear.

### 2. Simplicity first

Minimum code that solves the stated problem.

- No speculative features, configuration, or abstractions with one caller.
- No error handling for states the type system already rules out.
- If a helper would only ever be called once, inline it.
- Test: would a senior engineer call this overcomplicated? Then simplify.

### 3. Surgical changes

Every changed line should trace to the request.

- Do not reformat, rename, or "improve" adjacent code.
- Match the surrounding style, even where you would do it differently.
- Remove imports/variables your change orphaned; leave pre-existing dead code alone and
  mention it instead.
- Do not rewrite a file to change one concept.

### 4. Goal-driven execution

Turn the task into a verifiable goal, then loop until it is verified.

| Instead of | Define success as |
| --- | --- |
| "add validation" | a Rust test for each rejected input, plus the error code |
| "fix the bug" | a test that fails before, passes after |
| "add export" | bytes written, format checked, UI path exercised |
| "refactor" | same test results before and after |

For multi-step work, state the plan and the check for each step. If you cannot name how
a change will be verified, you are not ready to write it.

## The project

MermaidDesk is an offline-first desktop editor for Mermaid diagrams: Tauri 2 (Rust)
shell, React + TypeScript UI, Monaco editor, Mermaid renderer. It writes ordinary
`.mmd` / `.mermaid` files and has no account, telemetry, network dependency, or hosted
renderer. The repository is private; `main` is the only branch that matters.

```
src/                 React UI, state, rendering, export
  lib/platform.ts    the only IPC surface (Tauri invoke + browser mock)
  lib/render.ts      Mermaid config, sanitisation, diagnostics
  lib/export.ts      SVG tightening, PNG rasterisation, clipboard raster budget
  state/workspace.ts tabs, save/close, export and copy flows
src-tauri/src/       Rust commands, menu, settings, clipboard
e2e/                 Playwright against the production bundle (mock IPC)
scripts/             desktop E2E, release-notes/version tooling, tests
docs/                ARCHITECTURE, VERIFICATION, ASSESSMENT, RELEASING
```

`ARCHITECTURE.md` is the design reference. `VERIFICATION.md` records what was actually
executed. `RELEASING.md` is the release procedure. Update them when behaviour changes.

## Commands

Run from the repository root unless noted.

| Command | Purpose |
| --- | --- |
| `npm ci` | reproducible install (prefer over `npm install` in CI-like checks) |
| `npm run tauri:dev` | full app with hot reload |
| `npm run dev` | frontend only, browser mock backend |
| `npm run typecheck` | `tsc --noEmit`; strict, no unused locals/params |
| `npm test` | Vitest unit/integration |
| `npm run test:scripts` | `node --test` for release tooling |
| `npm run build` | typecheck + production bundle |
| `npm run test:e2e` | Playwright; requires `npm run build` first |
| `npm run test:desktop` | real Tauri window; needs a release build, `tauri-driver` and `tools/edgedriver/msedgedriver.exe` |
| `cd src-tauri && cargo test` | Rust unit/integration |
| `cd src-tauri && cargo fmt --check` | formatting gate |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | lint gate |
| `npm run tauri:build` | installers + embedded frontend |

Current suite counts live in `docs/VERIFICATION.md`; do not quote stale numbers.
`npm run test:desktop` also rewrites `docs/screenshot.png` — revert it if the UI did not
change.

## Security invariants

The webview is untrusted. These are load-bearing; do not weaken them for convenience.

- The capability file grants only core window/event permissions. The webview has no
  `fs`, `dialog`, `shell`, `http`, updater, or clipboard capability. Filesystem and
  clipboard access exist only as Rust commands.
- **Writes** require a path authorised earlier in the session (dialog, native drop, OS
  hand-off, or a successful save).
- **Reads** require that authorisation *or* membership in the persisted recent list, and
  only for `.mmd` / `.mermaid` / `.md` / `.txt`. Recent files are untrusted input:
  filter incoming lists to authorised/persisted entries and re-check the extension.
- **Never accept a path list from the renderer and authorise it.** Drag-and-drop paths
  come from the Rust `WindowEvent::DragDrop` handler; the window receives counts only.
  This is why `open_dropped_documents` was removed — do not reintroduce the pattern.
- `reveal_document` and export-beside require authorisation like any other path use.
- Clipboard: PNG only, base64 capped, pixel dimensions checked before decode, decode off
  the main thread, and one long-lived `arboard` handle (X11/Wayland ownership).
- Session recovery: `save_session` must refuse any path that is not authorised in the
  current session; `load_session` may authorise only paths found in the validated file.
  Never let the renderer seed `session.json` — that would turn it into a capability.
- Mermaid renders with `securityLevel: "strict"` and `htmlLabels: false`, passes through
  DOMPurify and a hardening pass, and lands in the DOM via `dangerouslySetInnerHTML`
  only after both. Do not relax any of that.
- CSP forbids remote scripts, styles, images and connections; `frame-src 'none'`.
  `style-src 'unsafe-inline'` is required by Mermaid's scoped `<style>` and is the one
  documented exception.
- No network calls, telemetry, update pings, or CDN loading. The app must work with the
  network unplugged.

## Cross-platform rules

- Paths are canonicalised and absolute; Windows verbatim prefixes must keep working.
- Writes are atomic: temp file in the destination directory, sync, replace.
- Documents are capped at 8 MiB and must be valid UTF-8.
- Opening strips a UTF-8 BOM but must not mark the document dirty; CRLF and mixed line
  endings are preserved byte-for-byte on save.
- Tests must be host-neutral: use `std::env::temp_dir()` / `absolute_path()`, never
  assume `C:\...` is absolute. CI runs Windows, macOS and Ubuntu.
- The macOS asset is Apple silicon (`macos-latest`); Intel macOS is not built.

## Where changes belong

| Task | Touch | Prove with |
| --- | --- | --- |
| New Rust command | module + `lib.rs` handler list, `platform.ts` + browser mock, `ARCHITECTURE.md` | Rust tests, Vitest, Playwright if user-visible |
| New UI control | component, `App.tsx`/`workspace.ts`, `styles.css` | Vitest + Playwright |
| Mermaid config / sanitisation | `lib/render.ts` | `render.test.ts` |
| Export or clipboard | `lib/export.ts`, `workspace.ts`, `clipboard.rs` | unit tests + pixel-level Playwright + desktop read-back |
| Shortcut or menu item | `lib/shortcuts.ts`, `src-tauri/src/menu.rs`, `App.tsx`, README table | shortcut unit test, Playwright, native menu check |
| User-visible behaviour | plus `CHANGELOG.md` under `[Unreleased]` | — |
| Release | `docs/RELEASING.md` | the tag run and a downloaded artifact |

When a command's signature changes, update `docs/ARCHITECTURE.md` in the same commit.
The browser mock in `platform.ts` is not the product: keep it behaviourally close, but
remember the desktop suite is the only proof of the real path.

## Testing expectations

- A new behaviour needs a test at the lowest layer that can catch it breaking.
- A security or filesystem rule needs a Rust test that tries to violate it.
- A user flow needs Playwright; a native-integration flow needs the desktop suite.
- Do not weaken or delete a failing test to get green. Fix the code, or explain why the
  test was wrong in the commit message.
- Never claim something works because the code compiles. State which suites you ran, and
  say plainly when a path could not be exercised here.
- If you change `src/`, rebuild before running Playwright; it serves `dist`.
- Kill stale `mermaid-desk` processes before desktop runs; a hidden instance holds the
  single-instance lock and new launches exit 0.

## Release rules

Follow `docs/RELEASING.md` exactly.

- Bump all four version files with `node scripts/set-version.mjs X.Y.Z` (and the
  `package-lock.json` root version, which the script does not touch).
- Move `[Unreleased]` entries into `## [X.Y.Z] - YYYY-MM-DD`. The workflow refuses to
  build a tag whose version or changelog section is missing.
- Push `main` first, then the annotated tag; review the draft's notes, assets and the
  generated checksums block; publish manually.
- Never move or reuse a published tag. Ship a patch release instead.
- MSI builds require numeric versions only (`1.2.3` or `1.2.3-4`); alphabetic
  prereleases fail WiX.

## Do not

- Add `fs`, `http`, `shell`, updater, or clipboard plugins to the webview without an
  explicit decision and a security note.
- Loosen the CSP, Mermaid security settings, path authorisation, or size caps.
- Introduce a command that takes a filesystem path from the renderer and authorises it.
- Commit `node_modules`, `dist`, `src-tauri/target`, `release/`, `tools/`, or
  `research/` — all gitignored; keep it that way. The local `release/` folder is a
  scratch copy of the last verified download, never a version reference; the GitHub
  release for the tag is authoritative.
- Commit a version bump without a changelog section.
- Reformulate the whole file to make a small change.
- Force-push `main`, rewrite published history, or delete tags/releases.
- Add a dependency for something the standard library or an existing dependency does.

## Stop and ask

Ask before:

- changing the security model, capability set, CSP, or trust rules for recents;
- adding a native dependency or a new plugin;
- destructive git or GitHub operations (force-push, tag/release deletion, repo
  visibility);
- cutting or publishing a release, unless that was the task;
- interpreting a requirement that could reasonably mean two different things.

## Definition of done

A change is done when:

1. The behaviour exists and its success criterion is verified by a test (or the reason it
   cannot be is stated).
2. `npm run typecheck`, `npm test`, `cargo test`, `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings` pass for the affected area.
3. Playwright and the desktop suite are run when the layer they cover changed —
   including rebuilding first.
4. Docs, `ARCHITECTURE.md`, and `[Unreleased]` are updated when behaviour is
   user-visible.
5. `git status` is clean and the commit message says what was verified.

---

Adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT), with project rules derived from this codebase's security and release model.
