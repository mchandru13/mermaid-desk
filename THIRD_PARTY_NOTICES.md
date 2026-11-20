# Third-party notices

MermaidDesk is MIT licensed. It bundles the following runtime components inside the
application binary, so they work offline after installation.

| Component | Version | Licence | Use |
| --- | --- | --- | --- |
| Mermaid.js | 12.3.0 | MIT | Diagram parsing and SVG rendering |
| Monaco Editor | 0.55.1 | MIT | Source editor |
| React / React DOM | 19.3.1 | MIT | User interface |
| DOMPurify | 3.4.18 | MPL-2.0 OR Apache-2.0 | SVG sanitisation |
| Tauri (Rust crates) | 2.12.x | Apache-2.0 OR MIT | Desktop shell |
| tauri-plugin-dialog | 2.8.x | Apache-2.0 OR MIT | Native open/save dialogs |
| tauri-plugin-opener | 2.7.x | Apache-2.0 OR MIT | Reveal in folder |
| tauri-plugin-window-state | 2.5.x | Apache-2.0 OR MIT | Window geometry persistence |
| tauri-plugin-single-instance | 2.5.x | Apache-2.0 OR MIT | Single-instance hand-off |
| tempfile | 3.x | MIT OR Apache-2.0 | Atomic writes |
| serde / serde_json | 1.x | MIT OR Apache-2.0 | Settings and IPC |
| thiserror | 2.x | MIT OR Apache-2.0 | Command errors |
| base64 | 0.22 | MIT OR Apache-2.0 | PNG payload transport |
| Vite | 7.3.8 | MIT | Build tooling (not shipped) |
| Vitest / Playwright | current | MIT / Apache-2.0 | Test tooling (not shipped) |

Mermaid.js includes Katex-derived rendering support and dagre/elk layout engines under
their respective MIT licences. Monaco is distributed under the MIT licence. DOMPurify is
available under MPL-2.0 or Apache-2.0; this project relies on the Apache-2.0 option for
distribution compatibility.

No GPL, AGPL, or proprietary runtime components are bundled.

Full texts: `node_modules/<package>/LICENSE*` after `npm ci`, and
`src-tauri/target/**/Cargo.lock` for the exact Rust dependency graph (`cargo license`
can produce a consolidated report).
