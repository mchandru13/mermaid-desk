import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { MERMAID_KEYWORDS, MERMAID_SNIPPETS } from "./mermaidLanguage";

/**
 * Monaco is bundled locally with the application; no CDN loader is used. The
 * worker is emitted by Vite and served from the same origin as the app.
 */
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

let initialised = false;

export function setupMonaco(): void {
  if (initialised) return;
  initialised = true;

  monaco.languages.register({
    id: "mermaid",
    extensions: [".mmd", ".mermaid"],
    aliases: ["Mermaid", "mermaid"],
    mimetypes: ["text/vnd.mermaid"],
  });

  monaco.languages.setLanguageConfiguration("mermaid", {
    comments: { lineComment: "%%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    folding: { markers: { start: /^\s*subgraph\b/, end: /^\s*end\s*$/ } },
  });

  monaco.languages.setMonarchTokensProvider("mermaid", {
    defaultToken: "",
    tokenPostfix: ".mermaid",
    keywords: MERMAID_KEYWORDS,
    arrows: [/-->/, /---/, /-\.->/, /==>/, /-.->/, /-->>/, /--x/, /--o/],
    tokenizer: {
      root: [
        [/%%\{.*?\}%%/, "comment.directive"],
        [/%%[^\n]*/, "comment"],
        [/^\s*---\s*$/, "string.frontmatter"],
        [
          /[a-zA-Z_][\w-]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
        [/"[^"]*"/, "string"],
        [/\|[^|]*\|/, "string"],
        [/[{}[\]()]/, "@brackets"],
        [/[<>]/, "delimiter"],
        [/--+[>ox]|==+[>ox]|-\.+->?/, "operator.arrow"],
        [/[:;,.]/, "delimiter"],
        [/\d+(\.\d+)?/, "number"],
      ],
      comment: [
        [/[^%]+/, "comment"],
        [/%%/, "comment", "@pop"],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider("mermaid", {
    // Word characters and a couple of shapes only. Including "\n" or " " made
    // the whole keyword list pop up on every keystroke while writing.
    triggerCharacters: ["<", ":", "|"],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const suggestions: monaco.languages.CompletionItem[] = [
        ...MERMAID_KEYWORDS.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range,
          detail: "Mermaid keyword",
        })),
        ...MERMAID_SNIPPETS.map((snippet) => ({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: snippet.documentation,
          range,
        })),
      ];
      return { suggestions };
    },
  });

  monaco.editor.defineTheme("mermaid-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7aa2f7", fontStyle: "bold" },
      { token: "operator.arrow", foreground: "bb9af7" },
      { token: "comment", foreground: "6b7b8f", fontStyle: "italic" },
      { token: "string", foreground: "9ece6a" },
      { token: "identifier", foreground: "c0caf5" },
      { token: "number", foreground: "ff9e64" },
      { token: "delimiter", foreground: "89ddff" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#4b5b74",
      "editorLineNumber.activeForeground": "#c9d5e4",
      "editor.selectionBackground": "#264f78",
      "editor.lineHighlightBackground": "#111827",
      "editorCursor.foreground": "#58a6ff",
      "editorIndentGuide.background1": "#1f2a3a",
      "editorWidget.background": "#111827",
      "editorWidget.border": "#2b3648",
    },
  });

  monaco.editor.defineTheme("mermaid-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "1d4ed8", fontStyle: "bold" },
      { token: "operator.arrow", foreground: "7c3aed" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "string", foreground: "047857" },
      { token: "identifier", foreground: "0f172a" },
      { token: "number", foreground: "b45309" },
      { token: "delimiter", foreground: "0e7490" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#334155",
      "editor.selectionBackground": "#cfe3ff",
      "editor.lineHighlightBackground": "#f4f7fb",
      "editorCursor.foreground": "#1d4ed8",
      "editorIndentGuide.background1": "#e2e8f0",
      "editorWidget.background": "#f8fafc",
      "editorWidget.border": "#dbe3ee",
    },
  });
}

export { monaco };

/** Editor theme id for the resolved application theme. */
export function monacoThemeId(theme: "light" | "dark"): string {
  return theme === "dark" ? "mermaid-dark" : "mermaid-light";
}
