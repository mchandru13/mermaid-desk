import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  DocumentPayload,
  OpenDocument,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import {
  applyPayload,
  findOpenDocument,
  fromPayload,
  isDirty,
  newDocument,
  nextActiveId,
  pushRecentFile,
  replaceDocument,
  suggestFileName,
} from "../lib/tabs";
import { errorCode, errorMessage, platform } from "../lib/platform";
import { CLIPBOARD_MAX_PIXELS, exportFileName, svgToPngBase64, withBackground } from "../lib/export";
import { resolveTheme } from "../lib/theme";

export interface Notify {
  text: string;
  tone?: "info" | "success" | "error";
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

interface WorkspaceOptions {
  confirm: ConfirmFn;
  promptUnsaved: (document: OpenDocument) => Promise<"save" | "discard" | "cancel">;
  notify: (message: Notify) => void;
}

export interface Workspace {
  documents: OpenDocument[];
  activeId: string | null;
  active: OpenDocument | null;
  settings: AppSettings;
  ready: boolean;
  createDocument: (content?: string, name?: string) => void;
  openDocument: () => Promise<void>;
  openPaths: (paths: string[]) => Promise<void>;
  openRecent: (path: string) => Promise<void>;
  openPayloads: (payloads: DocumentPayload[]) => void;
  updateContent: (id: string, content: string) => void;
  saveDocument: (id: string, options?: { as?: boolean }) => Promise<boolean>;
  closeDocument: (id: string) => Promise<boolean>;
  closeAll: () => Promise<boolean>;
  selectDocument: (id: string) => void;
  cycleDocument: (direction: 1 | -1) => void;
  moveDocument: (fromId: string, toId: string) => void;
  exportDiagram: (
    kind: "svg" | "png",
    svg: string,
    options?: { beside?: boolean; transparent?: boolean },
  ) => Promise<void>;
  copyDiagram: (
    svg: string,
    options?: { transparent?: boolean },
  ) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  revealActive: () => Promise<void>;
  hasUnsavedChanges: boolean;
  dirtyDocuments: OpenDocument[];
}

const MAX_RECENT = 12;

/**
 * Background that matches the theme the diagram was rendered with, so a pasted
 * PNG has the same contrast as the preview.
 */
function themedBackground(theme: AppSettings["theme"]): string {
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  return resolveTheme(theme, prefersDark) === "dark" ? "#0d1117" : "#ffffff";
}

export function useWorkspace({ confirm, promptUnsaved, notify }: WorkspaceOptions): Workspace {
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  const documentsRef = useRef<OpenDocument[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const settingsSaveTimer = useRef<number | null>(null);

  documentsRef.current = documents;
  activeIdRef.current = activeId;
  settingsRef.current = settings;

  const active = useMemo(
    () => documents.find((document) => document.id === activeId) ?? null,
    [documents, activeId],
  );

  const persistSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    settingsRef.current = next;
    if (settingsSaveTimer.current !== null) {
      window.clearTimeout(settingsSaveTimer.current);
    }
    settingsSaveTimer.current = window.setTimeout(() => {
      void platform.saveSettings(next).catch((error) => {
        notify({
          text: `Could not save settings: ${errorMessage(error)}`,
          tone: "error",
        });
      });
    }, 300);
  }, [notify]);

  const rememberRecent = useCallback(
    (path: string) => {
      const next = pushRecentFile(settingsRef.current.recentFiles, path, MAX_RECENT);
      persistSettings({ ...settingsRef.current, recentFiles: next });
    },
    [persistSettings],
  );

  const addPayload = useCallback(
    (payload: DocumentPayload): OpenDocument => {
      const existing = findOpenDocument(documentsRef.current, payload.path);
      if (existing) {
        setActiveId(existing.id);
        return existing;
      }
      const document = fromPayload(payload);
      setDocuments((current) => [...current, document]);
      setActiveId(document.id);
      rememberRecent(payload.path);
      return document;
    },
    [rememberRecent],
  );

  const openPayloads = useCallback(
    (payloads: DocumentPayload[]) => {
      if (payloads.length === 0) return;
      let last: OpenDocument | null = null;
      for (const payload of payloads) {
        last = addPayload(payload);
      }
      if (last) {
        notify({
          text:
            payloads.length === 1
              ? `Opened ${last.name}`
              : `Opened ${payloads.length} diagrams`,
          tone: "success",
        });
      }
    },
    [addPayload, notify],
  );

  const createDocument = useCallback((content?: string, name?: string) => {
    const document = newDocument(content, name);
    setDocuments((current) => [...current, document]);
    setActiveId(document.id);
  }, []);

  const openDocument = useCallback(async () => {
    try {
      const payload = await platform.openDocument();
      if (payload) openPayloads([payload]);
    } catch (error) {
      notify({ text: errorMessage(error), tone: "error" });
    }
  }, [notify, openPayloads]);

  const openPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      try {
        const payloads = await platform.openDroppedDocuments(paths);
        if (payloads.length === 0) {
          notify({
            text: "No .mmd or .mermaid diagram was found in the drop.",
            tone: "error",
          });
          return;
        }
        openPayloads(payloads);
        const ignored = paths.length - payloads.length;
        if (ignored > 0) {
          notify({
            text: `Opened ${payloads.length} diagram(s); ignored ${ignored} unsupported file(s).`,
            tone: "info",
          });
        }
      } catch (error) {
        notify({ text: errorMessage(error), tone: "error" });
      }
    },
    [notify, openPayloads],
  );

  const updateContent = useCallback((id: string, content: string) => {    setDocuments((current) => {
      const target = current.find((document) => document.id === id);
      if (!target || target.content === content) return current;
      return replaceDocument(current, id, { content });
    });
  }, []);

  const saveDocument = useCallback(
    async (id: string, options: { as?: boolean } = {}): Promise<boolean> => {
      const document = documentsRef.current.find((entry) => entry.id === id);
      if (!document) return false;
      try {
        let payload: DocumentPayload | null;
        if (!options.as && document.path) {
          try {
            payload = await platform.saveDocument(
              document.path,
              document.content,
              document.modified,
            );
          } catch (error) {
            if (errorCode(error) !== "conflict") throw error;
            const overwrite = await confirm({
              title: "File changed on disk",
              message:
                "This file has changed since it was opened. Saving now will overwrite those changes.",
              confirmLabel: "Overwrite",
              tone: "danger",
            });
            if (!overwrite) return false;
            payload = await platform.saveDocument(document.path, document.content, null);
          }
        } else {
          payload = await platform.saveDocumentAs(
            document.content,
            suggestFileName(document, "mmd"),
          );
        }
        if (!payload) return false;
        setDocuments((current) =>
          current.map((entry) =>
            entry.id === id ? applyPayload(entry, payload as DocumentPayload) : entry,
          ),
        );
        rememberRecent(payload.path);
        notify({ text: `Saved ${payload.name}`, tone: "success" });
        return true;
      } catch (error) {
        notify({ text: `Save failed: ${errorMessage(error)}`, tone: "error" });
        return false;
      }
    },
    [confirm, notify, rememberRecent],
  );

  const openRecent = useCallback(
    async (path: string) => {
      try {
        const payload = await platform.readDocument(path);
        openPayloads([payload]);
      } catch (error) {
        notify({
          text: `Could not reopen ${path}: ${errorMessage(error)}`,
          tone: "error",
        });
        const next = settingsRef.current.recentFiles.filter((entry) => entry !== path);
        persistSettings({ ...settingsRef.current, recentFiles: next });
      }
    },
    [notify, openPayloads, persistSettings],
  );

  const closeDocument = useCallback(
    async (id: string): Promise<boolean> => {
      const document = documentsRef.current.find((entry) => entry.id === id);
      if (!document) return true;
      if (isDirty(document)) {
        const decision = await promptUnsaved(document);
        if (decision === "cancel") return false;
        if (decision === "save") {
          const saved = await saveDocument(id);
          if (!saved) return false;
        }
      }
      const remaining = documentsRef.current.filter((entry) => entry.id !== id);
      const nextActive = nextActiveId(
        documentsRef.current,
        id,
        activeIdRef.current,
      );
      setDocuments(remaining);
      setActiveId(nextActive);
      return true;
    },
    [promptUnsaved, saveDocument],
  );

  const closeAll = useCallback(async (): Promise<boolean> => {
    const dirty = documentsRef.current.filter(isDirty);
    if (dirty.length > 0) {
      const proceed = await confirm({
        title: `${dirty.length} diagram${dirty.length === 1 ? "" : "s"} with unsaved changes`,
        message:
          "Close the application anyway? Unsaved edits will be discarded.",
        confirmLabel: "Close without saving",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!proceed) return false;
    }
    return true;
  }, [confirm]);

  const selectDocument = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const cycleDocument = useCallback((direction: 1 | -1) => {
    const list = documentsRef.current;
    if (list.length < 2) return;
    const index = list.findIndex((entry) => entry.id === activeIdRef.current);
    const next = (index + direction + list.length) % list.length;
    setActiveId(list[next].id);
  }, []);

  const moveDocument = useCallback((fromId: string, toId: string) => {
    setDocuments((current) => {
      const from = current.findIndex((entry) => entry.id === fromId);
      const to = current.findIndex((entry) => entry.id === toId);
      if (from === -1 || to === -1 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const exportDiagram = useCallback(
    async (
      kind: "svg" | "png",
      svg: string,
      options: { beside?: boolean; transparent?: boolean } = {},
    ) => {
      const document = documentsRef.current.find(
        (entry) => entry.id === activeIdRef.current,
      );
      if (!document) return;
      if (!svg.trim()) {
        notify({
          text: "There is nothing to export until the diagram renders.",
          tone: "error",
        });
        return;
      }
      try {
        const name = exportFileName(document.name, kind);
        const background = themedBackground(settingsRef.current.theme);

        let data = svg;
        if (kind === "png") {
          data = await svgToPngBase64(svg, { background });
        } else if (!options.transparent) {
          // The diagram is drawn with the current theme's text colours, so an
          // SVG without a background is unreadable when opened on an opposite
          // background (light text on white had a contrast ratio of 1.18:1).
          // A transparent export is still available explicitly.
          data = withBackground(svg, background);
        }

        if (options.beside && document.path) {
          try {
            const savedPath = await platform.exportBesideDocument(
              document.path,
              kind,
              data,
              false,
            );
            notify({
              text: `Exported ${kind.toUpperCase()} to ${savedPath}`,
              tone: "success",
            });
          } catch (error) {
            if (errorCode(error) !== "conflict") throw error;
            const overwrite = await confirm({
              title: "Replace the existing export?",
              message: `${name} already exists next to this diagram.`,
              confirmLabel: "Replace",
              tone: "danger",
            });
            if (!overwrite) return;
            const savedPath = await platform.exportBesideDocument(
              document.path,
              kind,
              data,
              true,
            );
            notify({
              text: `Exported ${kind.toUpperCase()} to ${savedPath}`,
              tone: "success",
            });
          }
          return;
        }

        const savedPath = await platform.exportDocument({
          kind,
          data,
          suggestedName: name,
        });
        if (savedPath) {
          notify({ text: `Exported ${kind.toUpperCase()} to ${savedPath}`, tone: "success" });
        }
      } catch (error) {
        notify({ text: `Export failed: ${errorMessage(error)}`, tone: "error" });
      }
    },
    [confirm, notify],
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      persistSettings({ ...settingsRef.current, ...patch });
    },
    [persistSettings],
  );

  const copyDiagram = useCallback(
    async (svg: string, options: { transparent?: boolean } = {}) => {
      if (!svg.trim()) {
        notify({
          text: "There is nothing to copy until the diagram renders.",
          tone: "error",
        });
        return;
      }
      try {
        // Same renderer and theme as the preview; an empty background leaves
        // the canvas transparent instead of filling it.
        const background = options.transparent
          ? ""
          : themedBackground(settingsRef.current.theme);
        // The clipboard path must stay inside Rust's size budget, so the raster
        // is scaled down rather than rejected for a large-but-valid diagram.
        const png = await svgToPngBase64(svg, {
          background,
          maxPixels: CLIPBOARD_MAX_PIXELS,
        });
        const { width, height } = await platform.copyImage(png);
        notify({
          text: `Copied PNG (${width} × ${height}) to the clipboard`,
          tone: "success",
        });
      } catch (error) {
        notify({ text: `Copy failed: ${errorMessage(error)}`, tone: "error" });
      }
    },
    [notify],
  );

  const revealActive = useCallback(async () => {
    const document = documentsRef.current.find(
      (entry) => entry.id === activeIdRef.current,
    );
    if (!document?.path) return;
    try {
      await platform.revealDocument(document.path);
    } catch (error) {
      notify({ text: errorMessage(error), tone: "error" });
    }
  }, [notify]);

  // Initial workspace: restore settings, then open anything handed to us by the
  // operating system. A welcome diagram keeps the first run useful.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await platform.loadSettings();
        if (!cancelled) {
          const merged = { ...DEFAULT_SETTINGS, ...stored };
          setSettings(merged);
          settingsRef.current = merged;
        }
      } catch {
        // First run: no settings file yet.
      }

      let pending: DocumentPayload[] = [];
      try {
        pending = await platform.takePendingDocuments();
      } catch {
        pending = [];
      }

      if (cancelled) return;
      if (pending.length > 0) {
        for (const payload of pending) addPayload(payload);
      } else {
        const document = newDocument();
        setDocuments([document]);
        setActiveId(document.id);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (settingsSaveTimer.current !== null) {
        window.clearTimeout(settingsSaveTimer.current);
      }
    };
  }, [addPayload]);

  const dirtyDocuments = useMemo(
    () => documents.filter((document) => isDirty(document)),
    [documents],
  );

  return {
    documents,
    activeId,
    active,
    settings,
    ready,
    createDocument,
    openDocument,
    openPaths,
    openRecent,
    openPayloads,
    updateContent,
    saveDocument,
    closeDocument,
    closeAll,
    selectDocument,
    cycleDocument,
    moveDocument,
    exportDiagram,
    copyDiagram,
    updateSettings,
    revealActive,
    hasUnsavedChanges: dirtyDocuments.length > 0,
    dirtyDocuments,
  };
}
