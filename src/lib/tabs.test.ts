import { describe, expect, it } from "vitest";
import {
  applyPayload,
  baseName,
  findOpenDocument,
  fromPayload,
  isDirty,
  newDocument,
  nextActiveId,
  normalizePath,
  pushRecentFile,
  samePath,
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
});
