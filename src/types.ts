export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface AppSettings {
  version: number;
  theme: ThemeMode;
  editorTheme: string;
  editorFontSize: number;
  wordWrap: boolean;
  showLineNumbers: boolean;
  previewScale: number;
  editorSplit: number;
  autoSave: boolean;
  recentFiles: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  theme: "system",
  editorTheme: "auto",
  editorFontSize: 14,
  wordWrap: false,
  showLineNumbers: true,
  previewScale: 1,
  editorSplit: 50,
  autoSave: false,
  recentFiles: [],
};

/** A document as returned by the Rust file commands. */
export interface DocumentPayload {
  path: string;
  name: string;
  content: string;
  modified: number | null;
  size: number;
}

export interface OpenDocument {
  /** Stable client-side identity used for editor models and keys. */
  id: string;
  path: string | null;
  name: string;
  content: string;
  /** Content as it exists on disk (or the empty string for new documents). */
  baseline: string;
  /** mtime in ms recorded when the file was read or written. */
  modified: number | null;
}

export interface RenderDiagnostic {
  message: string;
  line: number | null;
  detail: string;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  platform: string;
  configDir: string;
  documentLimitBytes: number;
}

export interface ExportRequest {
  kind: "svg" | "png";
  data: string;
  suggestedName: string;
}
