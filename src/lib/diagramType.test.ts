import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { TYPES, detectDiagramType, firstStatement } from "./diagramType";

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

  it("does not claim keyword families Mermaid 12 cannot render", () => {
    // `zenuml` needs the ZenUML external plugin and `usecase` is not a Mermaid
    // 12 diagram at all; both used to be listed here and produced a diagram
    // error in the real app. Guard against them coming back.
    for (const source of ["zenuml\nA.method()", "usecase\nactor A"]) {
      expect(detectDiagramType(source).label).toBe("Unknown");
    }
  });

  it("only lists keywords Mermaid actually registers", () => {
    // Opening statement for each family, so `parse` can tell a real diagram from
    // an unknown one. A keyword missing here fails the test rather than silently
    // passing, which is how `zenuml` and `usecase` survived.
    const SAMPLES: Record<string, string> = {
      graph: "graph TD\n A-->B",
      flowchart: "flowchart TD\n A-->B",
      sequencediagram: "sequenceDiagram\n A->>B: hi",
      classdiagram: "classDiagram\n class A",
      statediagram: "stateDiagram\n [*] --> A",
      "statediagram-v2": "stateDiagram-v2\n [*] --> A",
      erdiagram: "erDiagram\n A ||--o{ B : has",
      journey: "journey\n title T\n section S\n Task: 5: Me",
      gantt: "gantt\n title T\n dateFormat YYYY-MM-DD\n section S\n Task: 2024-01-01, 1d",
      pie: 'pie title T\n "A" : 1',
      quadrantchart: "quadrantChart\n x-axis a --> b\n y-axis c --> d\n A: [0.1, 0.2]",
      requirementdiagram:
        "requirementDiagram\n requirement r {\n id: 1\n text: t\n risk: high\n verifymethod: test\n }",
      gitgraph: "gitGraph\n commit",
      c4context: 'C4Context\n Person(p, "P")',
      c4container: 'C4Container\n Container(c, "C")',
      c4component: 'C4Component\n Component(c, "C")',
      c4dynamic: 'C4Dynamic\n Component(c, "C")',
      c4deployment: 'C4Deployment\n Deployment_Node(n, "N") {\n Container(c, "C")\n }',
      mindmap: "mindmap\n  root\n    child",
      timeline: "timeline\n title T\n 2024 : event",
      "sankey-beta": "sankey-beta\nA,B,10",
      "xychart-beta": "xychart-beta\n x-axis [a]\n bar [1]",
      "block-beta": 'block-beta\n columns 1\n a["A"]',
      "packet-beta": 'packet-beta\n0-15: "A"',
      "architecture-beta": "architecture-beta\n service a(server)[A]",
      kanban: "kanban\n Todo\n  [task]",
      "treemap-beta": 'treemap-beta\n"A": 10',
      "radar-beta": 'radar-beta\n axis a["A"]\n curve c["c"]{1}',
    };

    // Every registry key must have a sample, so a new entry cannot slip in
    // unverified.
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(TYPES).sort());

    return Promise.all(
      Object.entries(SAMPLES).map(async ([key, text]) => {
        const ok = await mermaid.parse(text, { suppressErrors: true });
        expect(ok, `${TYPES[key].keyword} is not registered by Mermaid`).not.toBe(false);
      }),
    );
  });
});
