import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, AppSettings, OpenDocument, RenderDiagnostic, ResolvedTheme } from "./types";
import { useWorkspace, type ConfirmRequest, type Notify } from "./state/workspace";
import { platform, errorMessage } from "./lib/platform";
import { applyThemeToDocument, resolveTheme, useSystemTheme } from "./lib/theme";
import { detectDiagramType } from "./lib/diagramType";
import { renderMermaid, toDiagnostic } from "./lib/render";
import { isDirty } from "./lib/tabs";
import { tightenSvgForExport } from "./lib/export";
import { matchShortcut, type ShortcutAction } from "./lib/shortcuts";
import { Toolbar } from "./components/Toolbar";
import { TabStrip } from "./components/TabStrip";
import { EditorPane, disposeDocumentModel, type EditorApi } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { StatusBar } from "./components/StatusBar";
import { TemplateGallery } from "./components/TemplateGallery";
import { AboutDialog, ShortcutsDialog } from "./components/InfoDialogs";
import { ConfirmDialog, UnsavedDialog } from "./components/ConfirmDialogs";

interface RenderState {
  documentId: string | null;
  svg: string;
  diagnostic: RenderDiagnostic | null;
  rendering: boolean;
}

const EMPTY_RENDER: RenderState = {
  documentId: null,
  svg: "",
  diagnostic: null,
  rendering: false,
};

type UnsavedRequest = {
  document: OpenDocument;
  resolve: (decision: "save" | "discard" | "cancel") => void;
};

type ConfirmState = ConfirmRequest & {
  resolve: (value: boolean) => void;
};

export default function App() {
  const systemDark = useSystemTheme();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<{
    text: string;
    tone: "info" | "success" | "error";
  } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmState | null>(null);
  const [unsavedRequest, setUnsavedRequest] = useState<UnsavedRequest | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [splitPercent, setSplitPercent] = useState(50);
  const splitInitialised = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [render, setRender] = useState<RenderState>(EMPTY_RENDER);

  const statusTimer = useRef<number | null>(null);
  const editorApi = useRef<EditorApi | null>(null);
  const autoSaving = useRef<Set<string>>(new Set());
  const splitRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: Notify) => {
    setStatus({ text: message.text, tone: message.tone ?? "info" });
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 5000);
  }, []);

  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setConfirmRequest({ ...request, resolve });
      }),
    [],
  );

  const promptUnsaved = useCallback(
    (document: OpenDocument) =>
      new Promise<"save" | "discard" | "cancel">((resolve) => {
        setUnsavedRequest({ document, resolve });
      }),
    [],
  );

  const workspace = useWorkspace({ confirm, promptUnsaved, notify });
  const { settings, documents, active, activeId } = workspace;
  const resolvedTheme: ResolvedTheme = resolveTheme(settings.theme, systemDark);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  /* -------------------------------------------------------------- */
  /* Menus, OS hand-off, drag & drop, window close                  */
  /* -------------------------------------------------------------- */

  const runActionRef = useRef<(action: ShortcutAction) => void>(() => undefined);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const offMenu = await platform.listenMenu((action) => {
        runActionRef.current(action as ShortcutAction);
      });
      const offPending = await platform.listenPendingDocuments(async () => {
        try {
          const payloads = await platform.takePendingDocuments();
          workspaceRef.current.openPayloads(payloads);
        } catch (error) {
          notify({ text: errorMessage(error), tone: "error" });
        }
      });
      const offDrop = await platform.listenDropped(async ({ accepted, ignored }) => {
        try {
          const payloads = await platform.takePendingDocuments();
          workspaceRef.current.openPayloads(payloads);
        } catch (error) {
          notify({ text: errorMessage(error), tone: "error" });
          return;
        }
        if (accepted === 0) {
          notify({
            text: "No .mmd or .mermaid diagram was found in the drop.",
            tone: "error",
          });
        } else if (ignored > 0) {
          notify({
            text: `Opened ${accepted} diagram(s); ignored ${ignored} unsupported file(s).`,
            tone: "info",
          });
        }
      });
      const offClose = await platform.listenCloseRequest(async () => {
        const shouldClose = await workspaceRef.current.closeAll();
        if (shouldClose) await workspaceRef.current.flushSession({ discardDirty: true });
        return shouldClose;
      });
      if (disposed) {
        offMenu();
        offPending();
        offDrop();
        offClose();
        return;
      }
      unlisteners.push(offMenu, offPending, offDrop, offClose);
    })();

    void platform
      .appInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));

    return () => {
      disposed = true;
      for (const off of unlisteners) off();
    };
  }, [notify]);

  /* -------------------------------------------------------------- */
  /* Rendering                                                      */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    if (!active) {
      setRender(EMPTY_RENDER);
      return;
    }
    if (!active.content.trim()) {
      setRender({ documentId: active.id, svg: "", diagnostic: null, rendering: false });
      return;
    }

    let cancelled = false;
    setRender((current) => ({ ...current, documentId: active.id, rendering: true }));

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await renderMermaid(active.content, resolvedTheme);
          if (cancelled) return;
          setRender({
            documentId: active.id,
            svg: result.svg,
            diagnostic: null,
            rendering: false,
          });
        } catch (error) {
          if (cancelled) return;
          setRender((current) => ({
            documentId: active.id,
            svg: current.documentId === active.id ? current.svg : "",
            diagnostic: toDiagnostic(error, active.content),
            rendering: false,
          }));
        }
      })();
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, resolvedTheme]);

  const renderedSvg = render.documentId === activeId ? render.svg : "";
  const diagnostic = render.documentId === activeId ? render.diagnostic : null;

  /* -------------------------------------------------------------- */
  /* Derived state                                                  */
  /* -------------------------------------------------------------- */

  const diagramType = useMemo(
    () => (active ? detectDiagramType(active.content) : null),
    [active],
  );

  useEffect(() => {
    if (!active) return;
    const dirty = isDirty(active) ? "• " : "";
    void platform.setTitle(`${dirty}${active.name} — MermaidDesk`).catch(() => undefined);
  }, [active]);

  // Zoom is owned by the preview: it fits each document when it is first
  // rendered. Resetting it here would race that fit and leave the diagram at
  // 100% in the corner.

  /* -------------------------------------------------------------- */
  /* Actions                                                        */
  /* -------------------------------------------------------------- */

  const currentExportSvg = useCallback(() => {
    // Use the live element so the output is cropped to the drawn artwork
    // (Mermaid's own viewBox pads asymmetrically and can clip).
    const live = document.querySelector<SVGSVGElement>(
      '[data-testid="preview-canvas"] svg',
    );
    return live ? tightenSvgForExport(live) : renderedSvg;
  }, [renderedSvg]);

  const doExport = useCallback(
    (
      kind: "svg" | "png",
      options: { beside?: boolean; transparent?: boolean } = {},
    ) => {
      const exportSvg = currentExportSvg();
      if (!exportSvg.trim()) {
        notify({ text: "Fix the diagram before exporting.", tone: "error" });
        return;
      }
      void workspace.exportDiagram(kind, exportSvg, options);
    },
    [currentExportSvg, notify, workspace],
  );

  const doCopy = useCallback(
    (options: { transparent?: boolean } = {}) => {
      const exportSvg = currentExportSvg();
      if (!exportSvg.trim()) {
        notify({ text: "Fix the diagram before copying it.", tone: "error" });
        return;
      }
      void workspace.copyDiagram(exportSvg, options);
    },
    [currentExportSvg, notify, workspace],
  );

  const toggleTheme = useCallback(() => {
    workspace.updateSettings({
      theme: resolvedTheme === "dark" ? "light" : "dark",
    });
  }, [resolvedTheme, workspace]);

  const runAction = useCallback(
    (action: ShortcutAction) => {
      switch (action) {
        case "new":
          workspace.createDocument();
          break;
        case "open":
          void workspace.openDocument();
          break;
        case "save":
          if (workspace.active) void workspace.saveDocument(workspace.active.id);
          break;
        case "save-as":
          if (workspace.active) void workspace.saveDocument(workspace.active.id, { as: true });
          break;
        case "close-tab":
          if (workspace.active) void workspace.closeDocument(workspace.active.id);
          break;
        case "next-tab":
          workspace.cycleDocument(1);
          break;
        case "previous-tab":
          workspace.cycleDocument(-1);
          break;
        case "export-svg":
          doExport("svg");
          break;
        case "export-png":
          doExport("png");
          break;
        case "copy-png":
          doCopy();
          break;
        case "zoom-in":
          setZoom((value) => Math.min(8, value * 1.25));
          break;
        case "zoom-out":
          setZoom((value) => Math.max(0.05, value / 1.25));
          break;
        case "zoom-reset":
          setZoom(1);
          break;
        case "zoom-fit":
          setZoom(fitScale);
          break;
        case "toggle-theme":
          toggleTheme();
          break;
        case "toggle-preview":
          setPreviewVisible((value) => !value);
          break;
        case "toggle-shortcuts":
          setShowShortcuts((value) => !value);
          break;
        case "find":
          setPreviewVisible(true);
          editorApi.current?.find();
          break;
        case "quit":
          void (async () => {
            if (!(await workspace.closeAll())) return;
            await workspace.flushSession({ discardDirty: true });
            await platform.quitApp();
          })();
          break;
        default:
          break;
      }
    },
    [doCopy, doExport, fitScale, notify, toggleTheme, workspace],
  );
  runActionRef.current = runAction;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = matchShortcut(event);
      if (!action) return;
      if (document.querySelector(".modal-backdrop")) return;
      if (!event.ctrlKey && !event.metaKey && event.key !== "F1") return;
      event.preventDefault();
      event.stopPropagation();
      runAction(action);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [runAction]);

  // Settings changes that require re-creating models are handled by the editor.

  // Auto-save applies only to documents that already exist on disk.
  useEffect(() => {
    if (!settings.autoSave) return;
    const candidates = documents.filter((document) => document.path && isDirty(document));
    if (candidates.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const document of candidates) {
        if (autoSaving.current.has(document.id)) continue;
        autoSaving.current.add(document.id);
        void workspaceRef.current.saveDocument(document.id).finally(() => {
          autoSaving.current.delete(document.id);
        });
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [documents, settings.autoSave]);

  /* -------------------------------------------------------------- */
  /* Split pane                                                     */
  /* -------------------------------------------------------------- */

  // The split is a user preference: restore it once settings are available and
  // persist the final position after a drag.
  useEffect(() => {
    if (!workspace.ready || splitInitialised.current) return;
    splitInitialised.current = true;
    if (Number.isFinite(settings.editorSplit)) {
      setSplitPercent(Math.min(85, Math.max(20, settings.editorSplit)));
    }
  }, [settings.editorSplit, workspace.ready]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let latest = splitPercent;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.min(85, Math.max(20, ((moveEvent.clientX - rect.left) / rect.width) * 100));
      setSplitPercent(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      workspace.updateSettings({ editorSplit: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* -------------------------------------------------------------- */
  /* Render                                                         */
  /* -------------------------------------------------------------- */

  const handleSettings = (patch: Partial<AppSettings>) => workspace.updateSettings(patch);

  return (
    <div className="app-shell">
      <Toolbar
        resolvedTheme={resolvedTheme}
        settings={settings}
        recentFiles={settings.recentFiles}
        canSave={Boolean(active)}
        canExportBeside={Boolean(active?.path)}
        previewVisible={previewVisible}
        onNew={() => workspace.createDocument()}
        onOpen={() => void workspace.openDocument()}
        onSave={() => active && void workspace.saveDocument(active.id)}
        onSaveAs={() => active && void workspace.saveDocument(active.id, { as: true })}
        onOpenRecent={(path) => void workspace.openRecent(path)}
        onReveal={() => void workspace.revealActive()}
        onExport={doExport}
        onExportBeside={(kind) => doExport(kind, { beside: true })}
        onExportTransparentSvg={() => doExport("svg", { transparent: true })}
        onCopyPng={() => doCopy()}
        onCopyPngTransparent={() => doCopy({ transparent: true })}
        onShowTemplates={() => setShowTemplates(true)}
        onShowShortcuts={() => setShowShortcuts(true)}
        onShowAbout={() => setShowAbout(true)}
        onTogglePreview={() => setPreviewVisible((value) => !value)}
        onThemeChange={(theme) => handleSettings({ theme })}
        onSettingsChange={handleSettings}
      />

      <TabStrip
        documents={documents}
        activeId={activeId}
        onSelect={workspace.selectDocument}
        onClose={(id) => void workspace.closeDocument(id)}
        onMove={workspace.moveDocument}
        onNew={() => workspace.createDocument()}
      />

      <main
        className={`workspace ${previewVisible ? "" : "preview-hidden"}`}
        ref={splitRef}
        data-theme={resolvedTheme}
      >
        {active ? (
          <>
            <section
              className="editor-pane"
              style={{ flexBasis: previewVisible ? `${splitPercent}%` : "100%" }}
              aria-label="Mermaid source"
            >
              <EditorPane
                documentId={active.id}
                content={active.content}
                theme={resolvedTheme}
                fontSize={settings.editorFontSize}
                wordWrap={settings.wordWrap}
                lineNumbers={settings.showLineNumbers}
                onChange={(value) => workspace.updateContent(active.id, value)}
                onCursorChange={(line, column) => setCursor({ line, column })}
                onSaveShortcut={() => void workspace.saveDocument(active.id)}
                onReady={(api) => {
                  editorApi.current = api;
                }}
              />
            </section>

            {previewVisible ? (
              <div
                className="split-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor and preview"
                onPointerDown={startResize}
                onDoubleClick={() => {
                  setSplitPercent(50);
                  workspace.updateSettings({ editorSplit: 50 });
                }}
              />
            ) : null}

            <PreviewPane
              svg={renderedSvg}
              diagnostic={diagnostic}
              rendering={render.rendering}
              theme={resolvedTheme}
              zoom={zoom}
              onZoomChange={setZoom}
              onFitScaleChange={setFitScale}
              onGoToLine={(line) => editorApi.current?.goToLine(line)}
              documentKey={active.id}
              hidden={!previewVisible}
            />
          </>
        ) : (
          <div className="empty-workspace">
            <h1>No diagram open</h1>
            <p>Create a new diagram or open a .mmd file to begin.</p>
            <div className="empty-actions">
              <button className="button primary" onClick={() => workspace.createDocument()}>
                New diagram
              </button>
              <button className="button" onClick={() => void workspace.openDocument()}>
                Open file…
              </button>
            </div>
          </div>
        )}
      </main>

      <StatusBar
        document={active}
        diagramType={diagramType}
        cursor={cursor}
        zoom={zoom}
        rendering={render.rendering}
        hasError={Boolean(diagnostic)}
        appVersion={appInfo?.version ?? "1.0.0"}
        status={status}
      />

      {showTemplates ? (
        <TemplateGallery
          onInsert={(source, title) => {
            workspace.createDocument(source, title);
            setShowTemplates(false);
            notify({ text: `Created a ${title} from template`, tone: "success" });
          }}
          onClose={() => setShowTemplates(false)}
        />
      ) : null}

      {showShortcuts ? (
        <ShortcutsDialog
          platform={appInfo?.platform ?? "windows"}
          appInfo={appInfo}
          onClose={() => setShowShortcuts(false)}
        />
      ) : null}

      {showAbout ? (
        <AboutDialog
          platform={appInfo?.platform ?? "windows"}
          appInfo={appInfo}
          onClose={() => setShowAbout(false)}
        />
      ) : null}

      {unsavedRequest ? (
        <UnsavedDialog
          name={unsavedRequest.document.name}
          onSave={() => {
            const request = unsavedRequest;
            setUnsavedRequest(null);
            request.resolve("save");
          }}
          onDiscard={() => {
            const request = unsavedRequest;
            setUnsavedRequest(null);
            request.resolve("discard");
          }}
          onCancel={() => {
            const request = unsavedRequest;
            setUnsavedRequest(null);
            request.resolve("cancel");
          }}
        />
      ) : null}

      {confirmRequest ? (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          confirmLabel={confirmRequest.confirmLabel}
          cancelLabel={confirmRequest.cancelLabel}
          tone={confirmRequest.tone}
          onConfirm={() => {
            const request = confirmRequest;
            setConfirmRequest(null);
            request.resolve(true);
          }}
          onCancel={() => {
            const request = confirmRequest;
            setConfirmRequest(null);
            request.resolve(false);
          }}
        />
      ) : null}
    </div>
  );
}

export { disposeDocumentModel };
