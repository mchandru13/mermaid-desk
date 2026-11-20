import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import {
  applyPayload,
  baseName,
  findOpenDocument,
  fromPayload,
  fromSession,
  isDirty,
  newDocument,
  nextActiveId,
  normalizePath,
  pushRecentFile,
  samePath,
  sessionSnapshot,
  suggestFileName,
} from "./tabs";

const payload = (path: string, content = "graph TD\n A-->B\n") => ({
  path,
  name: path.split("\\").pop() ?? path,
  content,
  modified: 1_700_000_000_000,
  size: content.length,
});

describe("document tabs", () => {
  it("creates a clean untitled document", () => {
    const document = newDocument("graph TD\n A-->B\n", "Draft");
    expect(document.path).toBeNull();
    expect(document.name).toBe("Draft");
    expect(isDirty(document)).toBe(false);
  });

  it("tracks dirty state against the saved baseline", () => {
    const document = fromPayload(payload("C:\\diagrams\\flow.mmd"));
    expect(isDirty(document)).toBe(false);
    expect(isDirty({ ...document, content: "graph LR" })).toBe(true);
    expect(isDirty({ ...document, content: document.baseline })).toBe(false);
  });

  it("applies a save payload without changing the client id", () => {
    const document = fromPayload(payload("C:\\diagrams\\flow.mmd"));
    const edited = { ...document, content: "graph LR\n X-->Y\n" };
    const saved = applyPayload(edited, {
      ...payload("C:\\diagrams\\flow.mmd", edited.content),
      name: "flow.mmd",
    });
    expect(saved.id).toBe(document.id);
    expect(isDirty(saved)).toBe(false);
    expect(saved.path).toBe("C:\\diagrams\\flow.mmd");
  });

  it("normalises windows paths and compares case-insensitively", () => {
    expect(normalizePath("C:/diagrams/a.mmd")).toBe("C:\\diagrams\\a.mmd");
    expect(samePath("C:\\Diagrams\\A.mmd", "c:/diagrams/a.mmd")).toBe(true);
    expect(samePath("C:\\a.mmd", "C:\\b.mmd")).toBe(false);
    expect(samePath(null, null)).toBe(true);
    expect(samePath(null, "C:\\a.mmd")).toBe(false);
  });

  it("compares case-sensitively on POSIX paths", () => {
    expect(samePath("/home/me/a.mmd", "/home/me/A.mmd")).toBe(false);
  });

  it("finds an already-open document by path", () => {
    const document = fromPayload(payload("C:\\diagrams\\flow.mmd"));
    expect(findOpenDocument([document], "c:/diagrams/FLOW.mmd")?.id).toBe(document.id);
    expect(findOpenDocument([document], "C:\\diagrams\\other.mmd")).toBeUndefined();
  });

  it("picks the neighbouring tab when one closes", () => {
    const documents = [newDocument("a"), newDocument("b"), newDocument("c")];
    expect(nextActiveId(documents, documents[1].id, documents[1].id)).toBe(documents[2].id);
    expect(nextActiveId(documents, documents[2].id, documents[2].id)).toBe(documents[1].id);
    expect(nextActiveId(documents, documents[0].id, documents[2].id)).toBe(documents[2].id);
    expect(nextActiveId([documents[0]], documents[0].id, documents[0].id)).toBeNull();
  });

  it("derives export names from document names", () => {
    const document = fromPayload(payload("C:\\diagrams\\architecture.mmd"));
    expect(baseName(document.name)).toBe("architecture");
    expect(suggestFileName(document, "mmd")).toBe("architecture.mmd");
    expect(baseName("Untitled diagram")).toBe("Untitled diagram");
  });

  it("deduplicates recent files and keeps the newest first", () => {
    const recent = ["C:\\a.mmd", "C:\\b.mmd"];
    expect(pushRecentFile(recent, "C:\\B.mmd")).toEqual(["C:\\B.mmd", "C:\\a.mmd"]);
    const many = Array.from({ length: 20 }, (_, index) => `C:\\${index}.mmd`);
    expect(pushRecentFile(many, "C:\\new.mmd", 5)).toHaveLength(5);
  });

  it("snapshots clean, dirty and untitled tabs appropriately", () => {
    const clean: OpenDocument = {
      id: "a",
      path: "C:\\a.mmd",
      name: "a.mmd",
      content: "graph TD",
      baseline: "graph TD",
      modified: 1,
    };
    const dirty: OpenDocument = { ...clean, id: "b", content: "graph LR" };
    const untitled: OpenDocument = {
      id: "c",
      path: null,
      name: "Untitled diagram",
      content: "graph TD",
      baseline: "graph TD",
      modified: null,
    };

    const snapshot = sessionSnapshot([clean, dirty, untitled], "b");
    expect(snapshot.active).toBe(1);
    // A clean file is re-read from disk; only the path is needed.
    expect(snapshot.documents[0].content).toBeNull();
    expect(snapshot.documents[1]).toMatchObject({ content: "graph LR", dirty: true });
    // An untitled tab must keep its content even when it is not dirty.
    expect(snapshot.documents[2]).toMatchObject({ content: "graph TD", dirty: false });
  });

  it("clamps the active index when tabs are dropped from the snapshot", () => {
    const docs = [newDocument("graph TD"), newDocument("graph LR")];
    expect(sessionSnapshot(docs, "missing").active).toBe(0);
    expect(sessionSnapshot([], null)).toEqual({ active: 0, documents: [] });
  });

  it("keeps dirty tabs when the snapshot hits its cap", () => {
    const docs = Array.from({ length: 21 }, (_, index) =>
      newDocument(`graph TD\n  n${index}`),
    );
    // The last tab is the only dirty one and is beyond the cap.
    docs[20] = { ...docs[20], baseline: "graph TD" };
    const snapshot = sessionSnapshot(docs, docs[20].id);

    expect(snapshot.documents).toHaveLength(20);
    expect(snapshot.documents.some((document) => document.content?.includes("n20"))).toBe(
      true,
    );
    expect(snapshot.documents[snapshot.active].content).toContain("n20");
  });

  it("rebuilds a tab from a restored session document", () => {
    const restored = fromSession({
      path: null,
      name: "Draft",
      content: "graph LR\n A-->B",
      baseline: "",
      modified: null,
    });
    expect(restored.id).toBeTruthy();
    expect(restored.content).toBe("graph LR\n A-->B");
    expect(restored.baseline).toBe("");
    expect(isDirty(restored)).toBe(true);
  });
});
