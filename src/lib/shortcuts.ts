/**
 * Keyboard shortcut resolution.
 *
 * Shortcuts are matched against `event.code` where possible so they work on
 * non-US keyboard layouts, with `event.key` used for punctuation that differs
 * between layouts.
 */
export type ShortcutAction =
  | "new"
  | "open"
  | "save"
  | "save-as"
  | "close-tab"
  | "next-tab"
  | "previous-tab"
  | "export-svg"
  | "export-png"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "zoom-fit"
  | "toggle-theme"
  | "toggle-preview"
  | "toggle-shortcuts"
  | "find";

export interface ShortcutDefinition {
  action: ShortcutAction;
  keys: string[];
  label: string;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { action: "new", keys: ["Ctrl", "N"], label: "New diagram" },
  { action: "open", keys: ["Ctrl", "O"], label: "Open diagram" },
  { action: "save", keys: ["Ctrl", "S"], label: "Save" },
  { action: "save-as", keys: ["Ctrl", "Shift", "S"], label: "Save as" },
  { action: "close-tab", keys: ["Ctrl", "W"], label: "Close diagram" },
  { action: "next-tab", keys: ["Ctrl", "Tab"], label: "Next diagram" },
  { action: "previous-tab", keys: ["Ctrl", "Shift", "Tab"], label: "Previous diagram" },
  { action: "export-svg", keys: ["Ctrl", "Shift", "E"], label: "Export SVG" },
  { action: "export-png", keys: ["Ctrl", "Shift", "P"], label: "Export PNG" },
  { action: "zoom-in", keys: ["Ctrl", "+"], label: "Zoom in" },
  { action: "zoom-out", keys: ["Ctrl", "-"], label: "Zoom out" },
  { action: "zoom-reset", keys: ["Ctrl", "0"], label: "Actual size" },
  { action: "zoom-fit", keys: ["Ctrl", "9"], label: "Fit to window" },
  { action: "toggle-theme", keys: ["Ctrl", "Shift", "T"], label: "Toggle theme" },
  { action: "toggle-preview", keys: ["Ctrl", "Shift", "D"], label: "Toggle preview" },
  { action: "toggle-shortcuts", keys: ["F1"], label: "Keyboard shortcuts" },
  { action: "find", keys: ["Ctrl", "F"], label: "Find in diagram" },
];

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function hasPrimaryModifier(event: KeyLike): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

function normalizeKey(event: KeyLike): string {
  const key = event.key.toLowerCase();
  if (key === "esc") return "escape";
  if (key === " ") return "space";
  if (key === "add") return "+";
  if (key === "subtract") return "-";
  return key;
}

export function matchShortcut(event: KeyLike): ShortcutAction | null {
  const primary = hasPrimaryModifier(event);
  const key = normalizeKey(event);
  const shift = Boolean(event.shiftKey);

  if (primary && shift && key === "tab") return "previous-tab";
  if (primary && key === "tab") return "next-tab";

  if (!primary) {
    if (key === "f1") return "toggle-shortcuts";
    return null;
  }

  switch (key) {
    case "n":
      return shift ? null : "new";
    case "o":
      return shift ? null : "open";
    case "s":
      return shift ? "save-as" : "save";
    case "w":
      return shift ? null : "close-tab";
    case "f":
      return shift ? null : "find";
    case "t":
      return shift ? "toggle-theme" : null;
    case "d":
      return shift ? "toggle-preview" : null;
    case "e":
      return shift ? "export-svg" : null;
    case "p":
      return shift ? "export-png" : null;
    case "=":
    case "+":
      return "zoom-in";
    case "-":
    case "_":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    case "9":
      return "zoom-fit";
    default:
      return null;
  }
}

/** Rendering of a shortcut for the UI, respecting the host platform. */
export function shortcutLabel(keys: string[], platform: string): string {
  const isMac = platform === "macos" || platform === "darwin";
  return keys
    .map((key) => {
      if (isMac) {
        if (key === "Ctrl") return "⌘";
        if (key === "Shift") return "⇧";
        if (key === "Alt") return "⌥";
        return key;
      }
      return key;
    })
    .join(isMac ? "" : "+");
}
