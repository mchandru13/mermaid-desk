?# Phase 1 — repository assessment

Date: 2026-11-20
Scope: decide whether MermaidDesk should fork MermaidUI or DiagramForge Desktop, or start
from a new Tauri 2 skeleton.

## 1. Method and evidence

| Source | How it was inspected | What it establishes |
| --- | --- | --- |
| `mermaid-js/mermaid-live-editor` (develop, 2026-11-18) | Full source clone; `package.json`, SvelteKit layout, README, deployment configs | Reference feature set, rendering approach, and its hosted-service dependencies |
| `buchenberg/MermaidUI` v1.3.1 | Full source clone; `package.json`, `tauri.conf.json`, `Cargo.toml`, `src/api.ts`, `DiagramPreview.tsx`, `database.rs`; released **MSI + NSIS installer** downloaded | Concrete security posture, architecture, licence status, missing features |
| `MalloyTheDev/diagramforge-desktop` (2026-07-06) | Full source clone; all Rust commands, React state modules, tests, docs, `tauri.conf.json`, capability file | Architecture quality, completeness, release status |
| `m8524769/mermaid-code` v0.9.6 | Source clone; `package.json`, `tauri.conf.json`; release list from GitHub API | What a mature Tauri 2 Mermaid app looks like, and its footprint |
| Shipped binary | REA `open_binary` on `MermaidUI_1.3.1_x64-setup.exe` (PE, SHA-256 `b9e930c1e67cbd653dc11c53d5f186e427f93d680dc60632cfd73b8061a45282`) | Confirms the public release is a real Tauri/Windows PE installer |
| GitHub REST API | repository + release endpoints | Stars, last push, release artefacts, licence metadata |

Evidence limits: the MermaidUI `.msi` is an OLE compound document that REA does not
parse (`unsupported binary format`), so the MSI was verified only by its published
release metadata; conclusions about its behaviour come from the matching v1.3.1
source tree and the NSIS executable. No dynamic execution of third-party installers
was performed.

## 2. Reference: Mermaid Live Editor

- **Licence:** MIT. **Maturity:** ~6.9k stars, active (last push 2026-11-18), 3.5k commits.
- **Architecture:** SvelteKit + Vite, `adapter`-driven web deployment, Monaco editor,
  Mermaid.js rendering in the browser. Diagram state is encoded in URLs.
- **Features:** live preview, SVG download, share/view links, Kroki and mermaid.ink
  render links, Mermaid Chart promotion, Plausible analytics hooks.
- **Gaps for this project:** no local file open/save, no recent files, no native
  dialogs, no installer, and PNG/SVG export links depend on hosted renderers
  (`MERMAID_RENDERER_URL` defaults to `https://mermaid.ink`). It is a web app by
  design; wrapping it would retain SvelteKit routing/SSR assumptions and network
  features that conflict with the offline requirement.

**Use it as:** behavioural reference for editing/rendering/zoom/export, and as a
source of UX conventions. Do not reuse its application shell.

## 3. Candidate A — MermaidUI (buchenberg)

**Version 1.3.1**, released 2026-01-09, `.exe` (NSIS) and `.msi` installers published.
Repository: 1 star, last push 2026-01-12.

| Area | Finding |
| --- | --- |
| Licence | **Contradictory**: `LICENSE` is Apache-2.0, `README.md` says MIT, `Cargo.toml` has an empty `license` field. Not safe to fork without clarification. |
| Framework | Tauri **1.5** (the v1 line is superseded by Tauri 2 and requires migration), React 18, Vite 5 |
| Rendering | `mermaid@^10.6.1`, imported from npm (offline-capable) |
| Editor | Both `@monaco-editor/react` and CodeMirror are installed; Monaco is the one used |
| Storage | SQLite (`rusqlite`, bundled) holding collections and diagrams in `%APPDATA%\com.mermaidui.app\mermaid-ui.db`; `.mmd` import/export only, no direct file editing |
| Features | Collections browser, split pane, zoom controls, theme toggle, optional autosave |
| Missing | Tabs, PNG export, file associations, drag-and-drop, recent files, diagnostics panel, tests |
| Security | **Weak**: `"csp": null`; filesystem allowlist covers `$HOME/**`, `$DOCUMENT/**`, `$DESKTOP/**`; `shell.open` enabled; `mermaid.initialize({ securityLevel: "loose" })` followed by `previewRef.current.innerHTML = svg` with no sanitisation; render errors are interpolated into `innerHTML`. |
| Build | `npm install && npm run build` (Tauri 1 CLI). Windows build succeeds with VS Build Tools; no tests or CI verification of behaviour. |

**Verdict:** cannot be forked responsibly. The Tauri 1 → 2 migration plus a security
rewrite (CSP, rendering, file scope) plus adding tabs/PNG/associations/tests is more
work than building on a clean Tauri 2 base, and the licence is ambiguous.

## 4. Candidate B — DiagramForge Desktop (MalloyTheDev)

**Version 0.1.0**, last push 2026-07-06, **no GitHub releases and no installer**.
Repository: 0 stars.

| Area | Finding |
| --- | --- |
| Licence | MIT, unambiguous |
| Framework | Tauri 2, React 19, TypeScript, Vite 7, Monaco 0.55, Mermaid 11 |
| Rust surface | Three commands: `read_diagram_file`, `save_diagram_file`, `list_workspace`; `tauri-plugin-dialog` |
| Quality | Notably good: atomic temp-file + rename writes, 10 MiB size cap, UTF-8 validation, save-conflict detection via mtime, extension whitelist, unit tests with Vitest, documented ADRs and security model |
| Features | Tabs with persisted session, recent files, dirty-state prompts, command palette, folder workspace, SVG export, type-aware completions |
| Missing | **PNG export is explicitly deferred to "v0.4"**, no drag-and-drop, no file associations, no single-instance hand-off, no E2E tests, no installer artefact |
| Security | Strict CSP, minimal capability file. However the webview passes arbitrary absolute paths to `read/write` commands, so the authorisation boundary is the renderer rather than the native side. |

**Verdict:** the best architectural match and a useful source of patterns, but it is a
skeleton. Forking would inherit a 0-star, single-maintainer, unreleased base and still
require implementing PNG export, drag-and-drop, file associations, single-instance
handling, a hardened authorisation model, and desktop E2E coverage.

## 5. Additional reference — mermaid-code (m8524769)

Tauri 2 + Svelte 5 + Monaco, MIT, v0.9.6 with Windows/macOS/Linux installers
(≈57 MB setup). It proves the stack works at scale but brings an AI/MCP sidecar,
i18n (Paraglide), an auto-updater, a marketing site, and requires pnpm 12 / Node
≥ 24.16. Its CSP permits `'unsafe-eval'`, inline scripts, and cdnjs font styles.
It is a good product to study, not a lean base for this deliverable.

## 6. Side-by-side comparison

| Criterion | Mermaid Live Editor | MermaidUI | DiagramForge Desktop | MermaidDesk (built) |
| --- | --- | --- | --- | --- |
| Licence | MIT | Ambiguous (Apache-2.0 file vs MIT README vs empty crate field) | MIT | MIT |
| Shell | SvelteKit web app | Tauri **1.5** (superseded line) | Tauri 2 | Tauri 2.12 |
| Editor | Monaco | Monaco (CodeMirror also bundled) | Monaco 0.55 | Monaco 0.55 (local worker) |
| Mermaid | bundled (web) | 10.6 | 11 | 12.3 |
| Local file open/save | No | Import/export only; SQLite store | Yes (two commands, renderer-supplied paths) | Yes, Rust-authorised paths, atomic writes |
| Multiple diagrams | URL state only | Collections (single editor) | Tabs + session restore | Tabs + dirty guards + window-close guard |
| PNG export | Hosted (`mermaid.ink`) | No | No (roadmap v0.4) | Yes, local canvas rasterisation |
| SVG export | Browser download | Yes | Yes | Yes (dialog + beside diagram) |
| File associations | N/A | No | No | `.mmd`/`.mermaid` registered by installer |
| Drag & drop | No | No | No | Implemented, extension-filtered |
| Single-instance hand-off | N/A | No | No | Yes (verified with installed app) |
| Diagnostics | Error text | Error text via innerHTML | Error panel | Line-numbered diagnostics + go-to-line |
| Tests | Playwright (web) | None found | Vitest unit tests | 30 Rust + 49 Vitest + 22 Playwright + 35 desktop checks |
| Installer artefact | No | NSIS + MSI | None published | NSIS + MSI, installed and verified |
| Offline rendering | No (hosted links) | Yes | Yes | Yes (all assets bundled, CSP blocks network) |
| Security posture | Hosted renderer links | `csp: null`, loose Mermaid, unsanitised innerHTML, broad FS scope | Strict CSP; webview supplies arbitrary paths | Strict CSP, Rust-owned dialogs, path authorisation, sanitised SVG |
| Maintenance signal | Active (6.9k★) | 1★, last push 2026-01 | 0★, last push 2026-07, no releases | New code in this repository |
| Build | pnpm + SvelteKit | npm + Tauri 1 CLI | npm + Tauri 2 CLI (unreleased) | `npm ci && npm run tauri:build` |

## 7. Decision

**Build a new application (MermaidDesk) on a Tauri 2 + React + TypeScript + Monaco +
Mermaid foundations, reusing proven patterns rather than code.**

Rationale:

1. Neither candidate can be shipped as-is: MermaidUI needs a framework migration and a
   security rewrite under an ambiguous licence; DiagramForge needs most of the required
   feature set and has never produced an installer.
2. The mandatory requirements (PNG export, drag-and-drop, file associations,
   single-instance open, strict file authorisation, desktop E2E, installer) are the
   parts both candidates lack, so a fork would not reduce the critical path.
3. A clean implementation keeps the dependency surface small enough for an offline,
   auditable desktop build, and lets the file-access model be enforced in Rust from
   the start.
4. Patterns adopted from DiagramForge: atomic writes, mtime conflict detection, size
   limits, UTF-8 validation, settings sanitisation, tab model with dirty baselines.
   Patterns rejected: renderer-supplied arbitrary file paths, workspace mode.

This decision did not require user input: both candidates fail on licence clarity or
on missing mandatory deliverables, and the new-build option is strictly less risky.

## 8. Resulting architecture (summary)

- **Shell:** Tauri 2.12 (Rust 2021), single window, bundled frontend, no remote code.
- **Frontend:** React 19 + TypeScript, Vite 7, Monaco 0.55 (bundled, local worker),
  Mermaid 12.3 (bundled), DOMPurify.
- **Native:** Rust owns every file read/write, native dialogs, export writes, settings,
  file associations, and the single-instance hand-off. The webview has no filesystem
  capability at all.
- **Storage:** plain `.mmd`/`.mermaid` files chosen by the user plus one JSON settings
  file. No SQLite: documents are user-owned text files, and the only structured state
  is a short settings/recent list; a database would add migration and backup burden
  with no benefit.
- **Offline:** all assets are compiled into the binary; CSP blocks remote scripts,
  styles, fonts, frames and connections; PNG export rasterises in the WebView.

Detailed design: `docs/ARCHITECTURE.md`.

