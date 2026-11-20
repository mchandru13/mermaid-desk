import type {
  DocumentPayload,
  OpenDocument,
  RestoredDocument,
  SessionSnapshot,
} from "../types";

let counter = 0;

export function createId(): string {
  counter += 1;
  return `doc-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export const WELCOME_DIAGRAM = `flowchart TD
    A([Start]) --> B{Ready to diagram?}
    B -- Yes --> C[Write Mermaid here]
    B -- No --> D[Open a .mmd file]
    C --> E[Export SVG or PNG]
    D --> C
    E --> F([Done])
`;

export function newDocument(content = WELCOME_DIAGRAM, name = "Untitled diagram"): OpenDocument {
  return {
    id: createId(),
    path: null,
    name,
    content,
    baseline: content,
    modified: null,
  };
}

export function fromPayload(payload: DocumentPayload): OpenDocument {
  return {
    id: createId(),
    path: payload.path,
    name: payload.name,
    content: payload.content,
    baseline: payload.content,
    modified: payload.modified,
  };
}

export function isDirty(document: OpenDocument): boolean {
  return document.content !== document.baseline;
}

/** Rebuild a tab from a session restored by Rust. */
export function fromSession(document: RestoredDocument): OpenDocument {
  return {
    id: createId(),
    path: document.path,
    name: document.name,
    content: document.content,
    baseline: document.baseline,
    modified: document.modified,
  };
}

/**
 * Snapshot the workspace for the recovery file.
 *
 * Clean files store only their path, because restoring re-reads the file from
 * disk. Dirty and untitled buffers store their content.
 */
export function sessionSnapshot(
  documents: OpenDocument[],
  activeId: string | null,
  limit = 20,
): SessionSnapshot {
  // If there are more tabs than the cap, keep every dirty buffer: losing an
  // unsaved tab is worse than losing a clean one that can be reopened.
  const kept = documents
    .map((document, index) => ({ document, index }))
    .sort((a, b) => {
      const byDirty = Number(isDirty(b.document)) - Number(isDirty(a.document));
      return byDirty !== 0 ? byDirty : a.index - b.index;
    })
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.document);

  const activeIndex = kept.findIndex((document) => document.id === activeId);
  return {
    active: activeIndex === -1 ? 0 : activeIndex,
    documents: kept.map((document) => {
      const dirty = isDirty(document);
      return {
        path: document.path,
        name: document.name,
        content: dirty || document.path === null ? document.content : null,
        modified: document.modified,
        dirty,
      };
    }),
  };
}

export function isUntitled(document: OpenDocument): boolean {
  return document.path === null;
}

/** Normalise separators so Windows paths compare deterministically. */
export function normalizePath(path: string): string {
  return path.replace(/\//g, "\\");
}

export function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = normalizePath(a);
  const right = normalizePath(b);
  const caseInsensitive = /^[a-z]:\\/i.test(left) || /^[a-z]:\\/i.test(right);
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function fileName(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("\\");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function findOpenDocument(
  documents: OpenDocument[],
  path: string,
): OpenDocument | undefined {
  return documents.find((document) => samePath(document.path, path));
}

/** Sensible next tab after closing `closedId`. */
export function nextActiveId(
  documents: OpenDocument[],
  closedId: string,
  activeId: string | null,
): string | null {
  const remaining = documents.filter((document) => document.id !== closedId);
  if (remaining.length === 0) return null;
  if (activeId !== closedId && remaining.some((document) => document.id === activeId)) {
    return activeId;
  }
  const closedIndex = documents.findIndex((document) => document.id === closedId);
  const fallbackIndex = Math.min(Math.max(closedIndex, 0), remaining.length - 1);
  return remaining[fallbackIndex]?.id ?? remaining[0].id;
}

export function replaceDocument(
  documents: OpenDocument[],
  id: string,
  patch: Partial<OpenDocument>,
): OpenDocument[] {
  return documents.map((document) =>
    document.id === id ? { ...document, ...patch, id: document.id } : document,
  );
}

/** Apply a save payload to a document without losing its client identity. */
export function applyPayload(document: OpenDocument, payload: DocumentPayload): OpenDocument {
  return {
    ...document,
    path: payload.path,
    name: payload.name,
    baseline: payload.content,
    modified: payload.modified,
  };
}

/** Strip the extension for export / suggested file names. */
export function baseName(name: string): string {
  const withoutExtension = name.replace(/\.(mmd|mermaid|md|txt)$/i, "");
  return withoutExtension.trim() || "diagram";
}

export function suggestFileName(document: OpenDocument, extension: string): string {
  return `${baseName(document.name)}.${extension}`;
}

/**
 * Insert or update a recent file entry (most recent first, de-duplicated).
 */
export function pushRecentFile(recent: string[], path: string, limit = 12): string[] {
  const filtered = recent.filter((entry) => !samePath(entry, path));
  return [path, ...filtered].slice(0, limit);
}

export function moveTab(
  documents: OpenDocument[],
  fromId: string,
  toId: string,
): OpenDocument[] {
  const from = documents.findIndex((document) => document.id === fromId);
  const to = documents.findIndex((document) => document.id === toId);
  if (from === -1 || to === -1 || from === to) return documents;
  const next = [...documents];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
