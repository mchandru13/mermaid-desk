import { describe, expect, it } from "vitest";
import { matchShortcut, SHORTCUTS, shortcutLabel } from "./shortcuts";

const key = (keyName: string, extras: Partial<Parameters<typeof matchShortcut>[0]> = {}) => ({
  key: keyName,
  ...extras,
});

describe("keyboard shortcuts", () => {
  it("maps file actions", () => {
    expect(matchShortcut(key("n", { ctrlKey: true }))).toBe("new");
    expect(matchShortcut(key("o", { ctrlKey: true }))).toBe("open");
    expect(matchShortcut(key("s", { ctrlKey: true }))).toBe("save");
    expect(matchShortcut(key("S", { ctrlKey: true, shiftKey: true }))).toBe("save-as");
    expect(matchShortcut(key("w", { ctrlKey: true }))).toBe("close-tab");
  });

  it("supports the command key on macOS", () => {
    expect(matchShortcut(key("s", { metaKey: true }))).toBe("save");
  });

  it("handles tab cycling", () => {
    expect(matchShortcut(key("Tab", { ctrlKey: true }))).toBe("next-tab");
    expect(matchShortcut(key("Tab", { ctrlKey: true, shiftKey: true }))).toBe("previous-tab");
  });

  it("handles zoom with both punctuation layouts", () => {
    expect(matchShortcut(key("+", { ctrlKey: true }))).toBe("zoom-in");
    expect(matchShortcut(key("=", { ctrlKey: true }))).toBe("zoom-in");
    expect(matchShortcut(key("-", { ctrlKey: true }))).toBe("zoom-out");
    expect(matchShortcut(key("0", { ctrlKey: true }))).toBe("zoom-reset");
    expect(matchShortcut(key("9", { ctrlKey: true }))).toBe("zoom-fit");
  });

  it("ignores unrelated keys and modifier-less letters", () => {
    expect(matchShortcut(key("q", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("n"))).toBeNull();
    expect(matchShortcut(key("s", { ctrlKey: true, altKey: true }))).toBe("save");
  });

  it("opens the shortcut sheet with F1", () => {
    expect(matchShortcut(key("F1"))).toBe("toggle-shortcuts");
  });

  it("every declared shortcut resolves to its own action", () => {
    for (const shortcut of SHORTCUTS) {
      const isMac = shortcut.keys.includes("Ctrl") && false;
      const ctrl = shortcut.keys.includes("Ctrl");
      const shift = shortcut.keys.includes("Shift");
      const literal = shortcut.keys.filter((entry) => entry !== "Ctrl" && entry !== "Shift");
      if (literal.length !== 1) continue;
      const pressed = key(literal[0], { ctrlKey: ctrl, shiftKey: shift || isMac });
      expect(matchShortcut(pressed)).toBe(shortcut.action);
    }
  });

  it("renders platform labels", () => {
    expect(shortcutLabel(["Ctrl", "Shift", "S"], "windows")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel(["Ctrl", "Shift", "S"], "macos")).toBe("⌘⇧S");
  });
});
