import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./workspace";
import { mockSeedFile } from "../lib/platform";

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
});
