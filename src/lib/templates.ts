import type { DiagramTypeInfo } from "./diagramType";

export interface Template {
  id: string;
  title: string;
  description: string;
  family: DiagramTypeInfo["family"];
  source: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "flowchart",
    title: "Flowchart",
    description: "Decisions and steps with styled nodes",
    family: "process",
    source: `flowchart TD
    A([Start]) --> B{Is it working?}
    B -- Yes --> C[Ship it]
    B -- No --> D[Debug]
    D --> E{Found the bug?}
    E -- Yes --> C
    E -- No --> F[Take a break]
    F --> D
    C --> G([Done])

    classDef good fill:#0f766e,stroke:#14b8a6,color:#ecfeff
    class C,G good
`,
  },
  {
    id: "sequence",
    title: "Sequence diagram",
    description: "Messages between participants over time",
    family: "structure",
    source: `sequenceDiagram
    autonumber
    actor User
    participant UI as Desktop App
    participant Core as Rust Core
    participant Disk as Local Disk

    User->>UI: Press Ctrl+S
    UI->>Core: save_document(path, content)
    Core->>Core: Validate path + encode UTF-8
    Core->>Disk: Atomic write
    Disk-->>Core: OK
    Core-->>UI: { modified, size }
    UI-->>User: Status bar: Saved
`,
  },
  {
    id: "class",
    title: "Class diagram",
    description: "Types, members, and relationships",
    family: "structure",
    source: `classDiagram
    class Document {
      +string id
      +string? path
      +string content
      +bool isDirty()
      +save() Promise
    }
    class Editor {
      +render(source) Promise
      +goToLine(line) void
    }
    class FileService {
      +read(path) Document
      +write(path, content) void
    }
    Document --> Editor : renders in
    Document --> FileService : persisted by
`,
  },
  {
    id: "state",
    title: "State diagram",
    description: "Lifecycle of a document tab",
    family: "structure",
    source: `stateDiagram-v2
    [*] --> Clean
    Clean --> Dirty : edit
    Dirty --> Clean : save
    Dirty --> Confirming : close
    Confirming --> Clean : discard
    Confirming --> Dirty : cancel
    Clean --> [*] : close
`,
  },
  {
    id: "er",
    title: "Entity relationship",
    description: "Tables and cardinality",
    family: "data",
    source: `erDiagram
    WORKSPACE ||--o{ DIAGRAM : contains
    DIAGRAM ||--o{ REVISION : has
    WORKSPACE {
      string id PK
      string name
      datetime created_at
    }
    DIAGRAM {
      string id PK
      string workspace_id FK
      string title
      string source
    }
    REVISION {
      string id PK
      string diagram_id FK
      datetime saved_at
    }
`,
  },
  {
    id: "gantt",
    title: "Gantt chart",
    description: "A simple project schedule",
    family: "time",
    source: `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Foundations
    Architecture        :done, a1, 2027-01-04, 10d
    File services       :done, a2, after a1, 8d

    section Editor
    Monaco integration  :active, b1, 2027-01-18, 12d
    Live preview        :b2, after b1, 9d
    Export pipeline     :b3, after b2, 6d

    section Release
    Installer + signing :c1, after b3, 5d
`,
  },
  {
    id: "mindmap",
    title: "Mind map",
    description: "Break an idea into branches",
    family: "structure",
    source: `mindmap
  root((MermaidDesk))
    Editing
      Monaco
      Shortcuts
      Templates
    Preview
      Mermaid render
      Zoom & pan
      Diagnostics
    Files
      Open & save
      Recent files
      Export SVG/PNG
    Quality
      Unit tests
      Desktop E2E
`,
  },
  {
    id: "timeline",
    title: "Timeline",
    description: "Milestones in chronological order",
    family: "time",
    source: `timeline
    title MermaidDesk milestones
    section Discovery
      2026-01 : Assess Mermaid Live Editor
      2026-02 : Compare Tauri candidates
    section Build
      2026-03 : Editor and preview
      2026-04 : Export pipeline
    section Ship
      2026-05 : Installer and file associations
`,
  },
  {
    id: "pie",
    title: "Pie chart",
    description: "Proportions with a legend",
    family: "data",
    source: `pie showData
    title Where diagram time goes
    "Writing Mermaid" : 45
    "Adjusting layout" : 25
    "Exporting" : 15
    "Reading docs" : 15
`,
  },
  {
    id: "journey",
    title: "User journey",
    description: "Experience across steps",
    family: "process",
    source: `journey
    title First run experience
    section Install
      Download installer: 5: User
      Run setup: 5: User
    section Create
      Launch app: 5: User
      Pick a template: 4: User
      Edit diagram: 4: User
    section Finish
      Save to disk: 5: User
      Export PNG: 4: User
`,
  },
  {
    id: "gitgraph",
    title: "Git graph",
    description: "Branch and merge history",
    family: "time",
    source: `gitGraph
    commit id: "init"
    commit id: "scaffold"
    branch feature/editor
    checkout feature/editor
    commit id: "monaco"
    commit id: "preview"
    checkout main
    merge feature/editor
    commit id: "v1.0.0" tag: "v1.0.0"
`,
  },
  {
    id: "c4",
    title: "C4 context",
    description: "System context with people and systems",
    family: "structure",
    source: `C4Context
    title System context - MermaidDesk
    Person(user, "Author", "Writes and exports diagrams")
    System(desk, "MermaidDesk", "Tauri desktop application")
    System_Ext(disk, "Local disk", "Documents and settings")
    Rel(user, desk, "Edits diagrams")
    Rel(desk, disk, "Reads and writes files")
`,
  },
  {
    id: "xychart",
    title: "XY chart",
    description: "Bars and a line series",
    family: "data",
    source: `xychart-beta
    title "Diagram render time (ms)"
    x-axis [Small, Medium, Large, Huge]
    y-axis "Milliseconds" 0 --> 900
    bar [40, 120, 380, 760]
    line [35, 110, 360, 720]
`,
  },
  {
    id: "block",
    title: "Block diagram",
    description: "Layered application architecture",
    family: "structure",
    source: `block-beta
    columns 3
    ui["React UI"]:3
    editor["Monaco editor"] preview["Mermaid preview"] tabs["Tab strip"]
    ipc["Tauri IPC"] dialogs["Native dialogs"] files["Rust file service"]
    settings["Settings store"]:3

    ui --> ipc
    ipc --> files
    files --> settings
`,
  },
  {
    id: "sankey",
    title: "Sankey",
    description: "Flow quantities between stages",
    family: "data",
    source: `sankey-beta
Editing,Preview,80
Editing,Corrections,20
Preview,SVG export,35
Preview,PNG export,30
Preview,Screen only,15
Corrections,Preview,20
`,
  },
  {
    id: "treemap",
    title: "Treemap",
    description: "Nested area breakdown",
    family: "data",
    source: `treemap-beta
"Documents"
    "Diagrams": 42
    "Notes": 18
"Settings"
    "Theme": 8
    "Editor": 12
    "Recents": 6
`,
  },
  {
    id: "packet",
    title: "Packet diagram",
    description: "Byte layout of a binary header",
    family: "data",
    source: `packet-beta
0-15: "Source Port"
16-31: "Destination Port"
32-63: "Sequence Number"
64-95: "Acknowledgment Number"
96-99: "Data Offset"
100-105: "Reserved"
106-111: "Flags"
112-127: "Window Size"
`,
  },
  {
    id: "architecture",
    title: "Architecture",
    description: "Services grouped inside a boundary",
    family: "structure",
    source: `architecture-beta
    group app(cloud)[Desktop app]
    service ui(server)[React UI] in app
    service core(server)[Rust core] in app
    service disk(database)[Local disk]

    ui:R -- L:core
    core:R -- L:disk
`,
  },
  {
    id: "kanban",
    title: "Kanban board",
    description: "Work items in columns",
    family: "process",
    source: `kanban
  Todo
    [Add template gallery filters]
    [Reduce render time]
  Doing
    [Harden the export path]
  Done
    [Verify on Windows]
    [Publish 1.2.1]
`,
  },
];

export const TEMPLATE_FAMILIES: { key: Template["family"]; label: string }[] = [
  { key: "process", label: "Process" },
  { key: "structure", label: "Structure" },
  { key: "time", label: "Time" },
  { key: "data", label: "Data" },
  { key: "other", label: "Other" },
];
