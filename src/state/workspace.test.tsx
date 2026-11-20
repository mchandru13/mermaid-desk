import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./workspace";
import { mockSeedFile } from "../lib/platform";

// Rasterising needs a real canvas, which happy-dom does not provide; the real
// path is covered by the Playwright scenario. Here the PNG payload is stubbed so
// the platform/target handling can be tested. The fixture is inlined because
// vi.mock factories are hoisted above imports.
vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return {
    ...actual,
    svgToPngBase64: vi.fn(
      async () =>
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ),
  };
});

function setup() {
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const promptUnsaved = vi.fn(
    async (): Promise<"save" | "discard" | "cancel"> => "discard",
  );
  const hook = renderHook(() => useWorkspace({ confirm, promptUnsaved, notify }));
  return { ...hook, notify, confirm, promptUnsaved };
}

describe("workspace state", () => {
  beforeEach(() => {
    localStorage.removeItem("mermaiddesk.mock.session");
  });
  it("starts with a welcome diagram once ready", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.active?.name).toBe("Untitled diagram");
    expect(result.current.active?.path).toBeNull();
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("creates documents and tracks edits", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.createDocument("graph LR\n A-->B", "Second"));
    expect(result.current.documents).toHaveLength(2);
    expect(result.current.active?.name).toBe("Second");

    const id = result.current.active!.id;
    act(() => result.current.updateContent(id, "graph LR\n A-->C"));
    expect(result.current.active?.content).toBe("graph LR\n A-->C");
    expect(result.current.active?.baseline).toBe("graph LR\n A-->B");
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it("saves a new document through the save-as path", async () => {
    const { result, notify } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.createDocument("flowchart TD\n A-->B", "Flow"));
    const id = result.current.active!.id;
    act(() => result.current.updateContent(id, "flowchart TD\n A-->C"));

    let saved = false;
    await act(async () => {
      saved = await result.current.saveDocument(id);
    });
    expect(saved).toBe(true);
    expect(result.current.active?.path).toContain("Flow.mmd");
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" }));
  });

  it("reopens a recent file from the mock backend", async () => {
    mockSeedFile("C:\\mock\\recent.mmd", "sequenceDiagram\n A->>B: hi");
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.openRecent("C:\\mock\\recent.mmd");
    });
    expect(result.current.documents).toHaveLength(2);
    expect(result.current.active?.name).toBe("recent.mmd");
    expect(result.current.active?.content).toContain("sequenceDiagram");
  });

  it("asks before closing a dirty document and honours cancel", async () => {
    const { result, promptUnsaved } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const id = result.current.active!.id;
    act(() => result.current.updateContent(id, "flowchart TD\n A-->B"));

    promptUnsaved.mockResolvedValueOnce("cancel");
    let closed = true;
    await act(async () => {
      closed = await result.current.closeDocument(id);
    });
    expect(closed).toBe(false);
    expect(result.current.documents).toHaveLength(1);

    let closedAfterDiscard = false;
    await act(async () => {
      closedAfterDiscard = await result.current.closeDocument(id);
    });
    expect(closedAfterDiscard).toBe(true);
    expect(result.current.documents).toHaveLength(0);
  });

  it("closes a clean document without prompting", async () => {
    const { result, promptUnsaved } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const id = result.current.active!.id;
    let closed = false;
    await act(async () => {
      closed = await result.current.closeDocument(id);
    });
    expect(closed).toBe(true);
    expect(promptUnsaved).not.toHaveBeenCalled();
  });

  it("cycles between open documents", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.createDocument("graph TD", "Two"));
    const twoId = result.current.active!.id;
    act(() => result.current.cycleDocument(1));
    expect(result.current.activeId).not.toBe(twoId);
    act(() => result.current.cycleDocument(-1));
    expect(result.current.activeId).toBe(twoId);
  });

  it("copies the diagram through the clipboard command", async () => {
    const { result, notify } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.copyDiagram('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });

    expect(window.__MERMAIDDESK_TEST__?.getLastCopy()).toMatchObject({
      width: 1,
      height: 1,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Copied PNG (1 × 1)"),
        tone: "success",
      }),
    );
  });

  it("does not copy when there is nothing rendered", async () => {
    const { result, notify } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    notify.mockClear();

    await act(async () => {
      await result.current.copyDiagram("   ");
    });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" }));
  });

  it("restores the previous session, including unsaved content", async () => {
    mockSeedFile("C:\\mock\\saved.mmd", "graph TD\n A-->B");
    localStorage.setItem(
      "mermaiddesk.mock.session",
      JSON.stringify({
        active: 1,
        documents: [
          { path: "C:\\mock\\saved.mmd", name: "saved.mmd", content: null, dirty: false },
          { path: null, name: "Draft", content: "graph LR\n A-->B", dirty: true },
        ],
      }),
    );

    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.documents).toHaveLength(2);
    // The clean file is re-read from disk, not from a stale snapshot.
    expect(result.current.documents[0].content).toContain("graph TD");
    expect(result.current.active?.name).toBe("Draft");
    expect(result.current.active?.content).toContain("graph LR");
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it("keeps an intentionally empty workspace empty", async () => {
    localStorage.setItem(
      "mermaiddesk.mock.session",
      JSON.stringify({ active: 0, documents: [] }),
    );

    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.documents).toHaveLength(0);
    expect(result.current.active).toBeNull();
  });

  it("does not resurrect buffers the user chose to discard on close", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const id = result.current.active!.id;
    act(() => result.current.updateContent(id, "graph TD\n A-->B"));

    await act(async () => {
      await result.current.flushSession({ discardDirty: true });
    });

    const stored = JSON.parse(
      localStorage.getItem("mermaiddesk.mock.session") ?? "{}",
    ) as { documents?: unknown[] };
    expect(stored.documents).toEqual([]);
  });

  it("keeps dirty buffers when the session is flushed for recovery", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const id = result.current.active!.id;
    act(() => result.current.updateContent(id, "graph TD\n A-->B"));

    await act(async () => {
      await result.current.flushSession();
    });

    const stored = JSON.parse(
      localStorage.getItem("mermaiddesk.mock.session") ?? "{}",
    ) as { documents?: Array<{ content?: string; dirty?: boolean }> };
    expect(stored.documents).toHaveLength(1);
    expect(stored.documents?.[0].content).toContain("graph TD");
    expect(stored.documents?.[0].dirty).toBe(true);
  });
});
