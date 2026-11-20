import { describe, expect, it } from "vitest";
import { detectDiagramType, firstStatement } from "./diagramType";

describe("diagram type detection", () => {
  it("skips front matter, comments, and blank lines", () => {
    const source = `---\ntitle: Demo\n---\n%% a comment\n\n  flowchart LR\n  A-->B`;
    expect(firstStatement(source)).toBe("flowchart LR");
  });

  it("detects common diagram families", () => {
    expect(detectDiagramType("graph TD\nA-->B").label).toBe("Flowchart");
    expect(detectDiagramType("flowchart LR\nA-->B").label).toBe("Flowchart");
    expect(detectDiagramType("sequenceDiagram\nA->>B: hi").label).toBe("Sequence diagram");
    expect(detectDiagramType("stateDiagram-v2\n[*] --> A").label).toBe("State diagram");
    expect(detectDiagramType("classDiagram\nA <|-- B").label).toBe("Class diagram");
    expect(detectDiagramType("erDiagram\nA ||--o{ B : has").label).toBe("Entity relationship");
    expect(detectDiagramType("gantt\ntitle Plan").label).toBe("Gantt chart");
    expect(detectDiagramType("mindmap\n  root((x))").label).toBe("Mind map");
    expect(detectDiagramType("sankey-beta\nA,B,1").label).toBe("Sankey diagram");
    expect(detectDiagramType("block-beta\ncolumns 2").label).toBe("Block diagram");
  });

  it("handles keyword variants with and without brackets", () => {
    expect(detectDiagramType("gitGraph LR:").keyword).toBe("gitGraph");
    expect(detectDiagramType("C4Context\ntitle X").label).toBe("C4 context");
    expect(detectDiagramType("xychart-beta\nbar [1,2]").label).toBe("XY chart");
  });

  it("returns Unknown for empty or unrecognised input", () => {
    expect(detectDiagramType("").label).toBe("Unknown");
    expect(detectDiagramType("%% only a comment").label).toBe("Unknown");
    expect(detectDiagramType("hello world").label).toBe("Unknown");
  });
});
