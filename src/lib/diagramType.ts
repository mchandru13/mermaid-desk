/**
 * Detection of the Mermaid diagram type from the first meaningful statement.
 * Used for the status bar, the tab icon, and type-aware editor completions.
 */
export interface DiagramTypeInfo {
  /** Mermaid keyword, e.g. `flowchart`. */
  keyword: string;
  /** Human readable label for the UI. */
  label: string;
  /** Category used to group templates. */
  family: "process" | "structure" | "time" | "data" | "other";
}

const TYPES: Record<string, DiagramTypeInfo> = {
  graph: { keyword: "graph", label: "Flowchart", family: "process" },
  flowchart: { keyword: "flowchart", label: "Flowchart", family: "process" },
  sequencediagram: { keyword: "sequenceDiagram", label: "Sequence diagram", family: "structure" },
  classdiagram: { keyword: "classDiagram", label: "Class diagram", family: "structure" },
  statediagram: { keyword: "stateDiagram", label: "State diagram", family: "structure" },
  "statediagram-v2": { keyword: "stateDiagram-v2", label: "State diagram", family: "structure" },
  erdiagram: { keyword: "erDiagram", label: "Entity relationship", family: "data" },
  journey: { keyword: "journey", label: "User journey", family: "process" },
  gantt: { keyword: "gantt", label: "Gantt chart", family: "time" },
  pie: { keyword: "pie", label: "Pie chart", family: "data" },
  quadrantchart: { keyword: "quadrantChart", label: "Quadrant chart", family: "data" },
  requirementdiagram: { keyword: "requirementDiagram", label: "Requirement diagram", family: "structure" },
  gitgraph: { keyword: "gitGraph", label: "Git graph", family: "time" },
  c4context: { keyword: "C4Context", label: "C4 context", family: "structure" },
  c4container: { keyword: "C4Container", label: "C4 container", family: "structure" },
  c4component: { keyword: "C4Component", label: "C4 component", family: "structure" },
  c4dynamic: { keyword: "C4Dynamic", label: "C4 dynamic", family: "structure" },
  c4deployment: { keyword: "C4Deployment", label: "C4 deployment", family: "structure" },
  mindmap: { keyword: "mindmap", label: "Mind map", family: "structure" },
  timeline: { keyword: "timeline", label: "Timeline", family: "time" },
  zenuml: { keyword: "zenuml", label: "ZenUML sequence", family: "structure" },
  "sankey-beta": { keyword: "sankey-beta", label: "Sankey diagram", family: "data" },
  "xychart-beta": { keyword: "xychart-beta", label: "XY chart", family: "data" },
  "block-beta": { keyword: "block-beta", label: "Block diagram", family: "structure" },
  "packet-beta": { keyword: "packet-beta", label: "Packet diagram", family: "data" },
  "architecture-beta": { keyword: "architecture-beta", label: "Architecture", family: "structure" },
  kanban: { keyword: "kanban", label: "Kanban board", family: "process" },
  "treemap-beta": { keyword: "treemap-beta", label: "Treemap", family: "data" },
  "radar-beta": { keyword: "radar-beta", label: "Radar chart", family: "data" },
};

const UNKNOWN: DiagramTypeInfo = { keyword: "", label: "Unknown", family: "other" };

/** Returns the first statement that is not a comment, directive, or front matter. */
export function firstStatement(source: string): string {
  const withoutFrontMatter = source.replace(/^\s*---[\s\S]*?---\s*/, "");
  for (const rawLine of withoutFrontMatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("%%")) continue;
    if (line.startsWith("//")) continue;
    return line;
  }
  return "";
}

export function detectDiagramType(source: string): DiagramTypeInfo {
  const statement = firstStatement(source);
  if (!statement) return UNKNOWN;
  const keyword = statement.split(/[\s({[]/, 1)[0].toLowerCase();
  if (TYPES[keyword]) return TYPES[keyword];
  // `stateDiagram-v2` and friends: strip a trailing version suffix.
  const withoutVersion = keyword.replace(/-v\d+$/, "");
  if (TYPES[withoutVersion]) return TYPES[withoutVersion];
  if (keyword.startsWith("c4")) {
    const match = Object.values(TYPES).find((entry) => entry.keyword.toLowerCase() === keyword);
    if (match) return match;
  }
  return UNKNOWN;
}

export const DIAGRAM_TYPES = TYPES;
