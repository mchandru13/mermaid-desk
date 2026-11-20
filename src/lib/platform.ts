import type { AppInfo, AppSettings, DocumentPayload, ExportRequest } from "../types";
import { pngSize } from "./export";

/**
 * Platform bridge.
 *
 * Inside Tauri every call is forwarded to a Rust command. Outside Tauri (unit
 * tests, browser-based E2E runs) an in-memory backend is used so the whole UI
 * can be exercised without a desktop shell. The mock is never used in the
 * packaged application.
 */

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: Invoke | null = null;

async function getInvoke(): Promise<Invoke> {
  if (!invokeImpl) {
    const module = await import("@tauri-apps/api/core");
    invokeImpl = module.invoke as Invoke;
  }
  return invokeImpl;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return mockInvoke<T>(command, args);
  }
  const invoke = await getInvoke();
  return invoke<T>(command, args);
}

export interface CommandError {
  code: string;
  message: string;
}

export function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as CommandError).code === "string"
  );
}

export function errorMessage(value: unknown): string {
  if (isCommandError(value)) return value.message;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") {
    // Tauri serialises command errors as JSON strings in some versions.
    try {
      const parsed = JSON.parse(value) as CommandError;
      if (isCommandError(parsed)) return parsed.message;
    } catch {
      return value;
    }
    return value;
  }
  return "An unexpected error occurred.";
}

export function errorCode(value: unknown): string | null {
  if (isCommandError(value)) return value.code;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as CommandError;
      if (isCommandError(parsed)) return parsed.code;
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* App event bus                                                      */
/* ------------------------------------------------------------------ */

/**
 * Window-level events the Rust side emits (`menu-action`, `documents-pending`)
 * plus Tauri's webview drag-drop stream. They are funnelled through this bus so
 * the browser development/E2E build can deliver the same events the desktop
 * shell does, and so there is a single subscription path.
 */
type DropHandler = (summary: DroppedSummary) => void;
type MenuHandler = (action: string) => void;
type PendingHandler = () => void;

export interface DroppedSummary {
  accepted: number;
  ignored: number;
}

const droppedHandlers = new Set<DropHandler>();
const menuHandlers = new Set<MenuHandler>();
const pendingHandlers = new Set<PendingHandler>();

function makeRegistration<T>(handlers: Set<T>, handler: T): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * Simulate a native drop in the browser backend. Mirrors the Rust handler:
 * only absolute, existing diagram files are queued, and the renderer receives
 * counts rather than a path list it could forge.
 */
export function emitDragDrop(paths: string[]): void {
  const files = readMockFiles();
  let accepted = 0;
  let ignored = 0;

  for (const path of paths) {
    const absolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
    const diagram = /\.(mmd|mermaid|md|txt)$/i.test(path);
    if (absolute && diagram && Boolean(files[path]) && accepted < 32) {
      mockQueuePending([path]);
      accepted += 1;
    } else {
      ignored += 1;
    }
  }

  for (const handler of [...droppedHandlers]) handler({ accepted, ignored });
}

/** Deliver a native-menu action id. */
export function emitMenuAction(action: string): void {
  for (const handler of [...menuHandlers]) handler(action);
}

/** Deliver the "files were handed to the process" signal. */
export function emitPendingDocuments(): void {
  for (const handler of [...pendingHandlers]) handler();
}

declare global {
  interface Window {
    /** Test harness; only installed when the Tauri IPC is absent. */
    __MERMAIDDESK_TEST__?: {
      emitDragDrop: (paths: string[]) => void;
      emitMenuAction: (action: string) => void;
      emitPendingDocuments: () => void;
      seedFile: (path: string, content: string) => void;
      queuePending: (paths: string[]) => void;
      getLastExport: () => { kind: string; data: string; suggestedName: string } | null;
      getLastCopy: () => { data: string; width: number; height: number } | null;
    };
  }
}

if (!isTauri() && typeof window !== "undefined") {
  window.__MERMAIDDESK_TEST__ = {
    emitDragDrop,
    emitMenuAction,
    emitPendingDocuments,
    seedFile: (path: string, content: string) => mockSeedFile(path, content),
    queuePending: (paths: string[]) => mockQueuePending(paths),
    getLastExport: () => lastExport,
    getLastCopy: () => lastCopy,
  };
}

export const platform = {
  openDocument: () => call<DocumentPayload | null>("open_document"),
  readDocument: (path: string) => call<DocumentPayload>("read_document", { path }),
  saveDocument: (path: string, content: string, expectedModified: number | null) =>
    call<DocumentPayload>("save_document", { path, content, expectedModified }),
  saveDocumentAs: (content: string, suggestedName: string) =>
    call<DocumentPayload | null>("save_document_as", { content, suggestedName }),
  exportDocument: (request: ExportRequest) =>
    call<string | null>("export_document", {
      kind: request.kind,
      data: request.data,
      suggestedName: request.suggestedName,
    }),
  exportBesideDocument: (
    documentPath: string,
    kind: "svg" | "png",
    data: string,
    overwrite: boolean,
  ) =>
    call<string>("export_beside_document", {
      documentPath,
      kind,
      data,
      overwrite,
    }),
  copyImage: (pngBase64: string) =>
    call<{ width: number; height: number }>("copy_image_to_clipboard", {
      pngBase64,
    }),
  takePendingDocuments: () => call<DocumentPayload[]>("take_pending_documents"),
  revealDocument: (path: string) => call<void>("reveal_document", { path }),
  loadSettings: () => call<AppSettings>("load_app_settings"),
  saveSettings: (settings: AppSettings) =>
    call<AppSettings>("save_app_settings", { settings }),
  appInfo: () => call<AppInfo>("app_info"),

  async listenMenu(handler: (action: string) => void): Promise<() => void> {
    if (!isTauri()) return makeRegistration(menuHandlers, handler);
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("menu-action", (event) => handler(event.payload));
  },

  async listenPendingDocuments(handler: () => void): Promise<() => void> {
    if (!isTauri()) return makeRegistration(pendingHandlers, handler);
    const { listen } = await import("@tauri-apps/api/event");
    return listen("documents-pending", () => handler());
  },

  async listenDropped(handler: (summary: DroppedSummary) => void): Promise<() => void> {
    if (!isTauri()) return makeRegistration(droppedHandlers, handler);
    const { listen } = await import("@tauri-apps/api/event");
    return listen<DroppedSummary>("documents-dropped", (event) => handler(event.payload));
  },

  async listenCloseRequest(handler: () => Promise<boolean>): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().onCloseRequested(async (event) => {
      const shouldClose = await handler();
      if (!shouldClose) event.preventDefault();
    });
  },

  async closeWindow(): Promise<void> {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  },

  async setTitle(title: string): Promise<void> {
    if (!isTauri()) {
      document.title = title;
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  },
};

/* ------------------------------------------------------------------ */
/* Browser mock backend (development, unit tests, Playwright)          */
/* ------------------------------------------------------------------ */

const MOCK_DOCUMENTS_KEY = "mermaiddesk.mock.documents";
const MOCK_SETTINGS_KEY = "mermaiddesk.mock.settings";

interface MockFile {
  content: string;
  modified: number;
}

function readMockFiles(): Record<string, MockFile> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_DOCUMENTS_KEY) ?? "{}") as Record<
      string,
      MockFile
    >;
  } catch {
    return {};
  }
}

function writeMockFiles(files: Record<string, MockFile>): void {
  localStorage.setItem(MOCK_DOCUMENTS_KEY, JSON.stringify(files));
}

function payloadFor(path: string, file: MockFile): DocumentPayload {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? "untitled.mmd",
    content: file.content,
    modified: file.modified,
    size: file.content.length,
  };
}

export function mockSeedFile(path: string, content: string): void {
  const files = readMockFiles();
  files[path] = { content, modified: Date.now() };
  writeMockFiles(files);
}

/** Documents "handed to the process" before the UI was ready. */
const mockPending: string[] = [];

export function mockQueuePending(paths: string[]): void {
  mockPending.push(...paths);
}

/** Most recent export payload, exposed to the browser test harness. */
let lastExport: { kind: string; data: string; suggestedName: string } | null = null;

/** Most recent clipboard payload, exposed to the browser test harness. */
let lastCopy: { data: string; width: number; height: number } | null = null;

async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const files = readMockFiles();
  switch (command) {
    case "open_document": {
      const path = (args?.__mockOpenPath as string | undefined) ?? "C:\\mock\\diagram.mmd";
      if (!files[path]) {
        mockSeedFile(path, "flowchart TD\n    A --> B\n");
      }
      const refreshed = readMockFiles();
      return payloadFor(path, refreshed[path]) as T;
    }
    case "read_document": {
      // The real command accepts only paths authorised this session or listed in
      // the persisted recents. The browser mock has no native dialogs, so a
      // seeded/saved file is its stand-in for an authorised path; the actual
      // restriction is covered by Rust tests.
      const path = String(args?.path ?? "");
      const file = readMockFiles()[path];
      if (!file) throw { code: "io", message: `No such file: ${path}` };
      return payloadFor(path, file) as T;
    }
    case "save_document": {
      const path = String(args?.path ?? "");
      const content = String(args?.content ?? "");
      files[path] = { content, modified: Date.now() };
      writeMockFiles(files);
      return payloadFor(path, files[path]) as T;
    }
    case "save_document_as": {
      const suggested = String(args?.suggestedName ?? "diagram.mmd");
      const path = `C:\\mock\\${suggested}`;
      const content = String(args?.content ?? "");
      files[path] = { content, modified: Date.now() };
      writeMockFiles(files);
      return payloadFor(path, files[path]) as T;
    }
    case "export_document": {
      lastExport = {
        kind: String(args?.kind ?? ""),
        data: String(args?.data ?? ""),
        suggestedName: String(args?.suggestedName ?? ""),
      };
      return (args?.suggestedName as string) as T;
    }
    case "export_beside_document": {
      const documentPath = String(args?.documentPath ?? "C:\\mock\\diagram.mmd");
      lastExport = {
        kind: String(args?.kind ?? ""),
        data: String(args?.data ?? ""),
        suggestedName: documentPath,
      };
      return documentPath.replace(/\.(mmd|mermaid|md|txt)$/i, `.${String(args?.kind)}`) as T;
    }
    case "copy_image_to_clipboard": {
      // Mirror the Rust guard: the payload must be a real PNG. The browser
      // backend records it instead of touching the OS clipboard.
      const data = String(args?.pngBase64 ?? "");
      const size = pngSize(data);
      if (!size) throw { code: "invalid", message: "That payload is not a PNG image." };
      lastCopy = { data, ...size };
      return { ...size } as T;
    }
    case "take_pending_documents": {
      // Mirror Rust: drain once, filtering the same way as the OS hand-off.
      const drained = mockPending.splice(0, mockPending.length);
      const filesNow = readMockFiles();
      return drained
        .filter((path) => /\.(mmd|mermaid|md|txt)$/i.test(path))
        .map((path) => payloadFor(path, filesNow[path] ?? { content: "", modified: Date.now() })) as T;
    }
    case "reveal_document":
      return undefined as T;
    case "load_app_settings": {
      const raw = localStorage.getItem(MOCK_SETTINGS_KEY);
      if (!raw) throw { code: "io", message: "No settings" };
      return JSON.parse(raw) as T;
    }
    case "save_app_settings": {
      localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(args?.settings));
      return args?.settings as T;
    }
    case "app_info":
      return {
        name: "MermaidDesk",
        version: "1.0.0",
        tauriVersion: "mock",
        platform: "windows",
        configDir: "C:\\mock\\config",
        documentLimitBytes: 8 * 1024 * 1024,
      } as T;
    default:
      throw { code: "unsupported", message: `Unknown command: ${command}` };
  }
}
