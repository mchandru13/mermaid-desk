import { useEffect, useRef } from "react";
import { monaco, monacoThemeId, setupMonaco } from "../lib/monaco";

export interface EditorApi {
  focus: () => void;
  goToLine: (line: number) => void;
  find: () => void;
  revealLine: (line: number) => void;
}

interface EditorPaneProps {
  documentId: string;
  content: string;
  theme: "light" | "dark";
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  onChange: (value: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onSaveShortcut: () => void;
  onReady: (api: EditorApi) => void;
}

const models = new Map<string, monaco.editor.ITextModel>();

function modelUri(documentId: string) {
  return monaco.Uri.parse(`inmemory://mermaid-desk/${documentId}.mmd`);
}

function getModel(documentId: string, content: string): monaco.editor.ITextModel {
  const existing = models.get(documentId);
  if (existing && !existing.isDisposed()) return existing;
  const model = monaco.editor.createModel(content, "mermaid", modelUri(documentId));
  models.set(documentId, model);
  return model;
}

export function disposeDocumentModel(documentId: string): void {
  const model = models.get(documentId);
  if (model) {
    models.delete(documentId);
    model.dispose();
  }
}

export function EditorPane({
  documentId,
  content,
  theme,
  fontSize,
  wordWrap,
  lineNumbers,
  onChange,
  onCursorChange,
  onSaveShortcut,
  onReady,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorChange);
  const onSaveRef = useRef(onSaveShortcut);

  onChangeRef.current = onChange;
  onCursorRef.current = onCursorChange;
  onSaveRef.current = onSaveShortcut;

  useEffect(() => {
    setupMonaco();
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      model: getModel(documentId, content),
      theme: monacoThemeId(theme),
      fontSize,
      wordWrap: wordWrap ? "on" : "off",
      lineNumbers: lineNumbers ? "on" : "off",
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      tabSize: 2,
      insertSpaces: true,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      // The Mermaid keyword list is large; only show it on Ctrl+Space or an
      // explicit trigger character, not after every keystroke.
      quickSuggestions: { other: false, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "off",
      padding: { top: 12, bottom: 24 },
      fontFamily:
        "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12 },
      stickyScroll: { enabled: false },
      contextmenu: true,
      overviewRulerBorder: false,
      ariaLabel: "Mermaid source editor",
    });
    editorRef.current = editor;

    const contentSubscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
      onCursorRef.current(event.position.lineNumber, event.position.column);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current();
    });

    onReady({
      focus: () => editor.focus(),
      goToLine: (line: number) => {
        editor.revealLineInCenter(Math.max(1, line));
        editor.setPosition({ lineNumber: Math.max(1, line), column: 1 });
        editor.focus();
      },
      revealLine: (line: number) => {
        editor.revealLineInCenter(Math.max(1, line));
      },
      find: () => {
        editor.getAction("actions.find")?.run();
      },
    });

    return () => {
      contentSubscription.dispose();
      cursorSubscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // The editor is created once; later props are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap models when the active document changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = getModel(documentId, content);
    if (editor.getModel() !== model) {
      editor.setModel(model);
      editor.setScrollTop(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Apply externally changed content (template insertion, reload) without
  // fighting the editor's own edits.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && model.getValue() !== content) {
      model.setValue(content);
    }
  }, [content]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      theme: monacoThemeId(theme),
      fontSize,
      wordWrap: wordWrap ? "on" : "off",
      lineNumbers: lineNumbers ? "on" : "off",
    });
  }, [theme, fontSize, wordWrap, lineNumbers]);

  return <div className="editor-host" ref={hostRef} data-testid="editor" />;
}
