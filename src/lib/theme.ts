import { useEffect, useState } from "react";
import type { ResolvedTheme, ThemeMode } from "../types";

/** Resolve `system` against the OS preference. */
export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function useSystemTheme(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", handle);
    return () => query.removeEventListener("change", handle);
  }, []);

  return prefersDark;
}

export function applyThemeToDocument(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
