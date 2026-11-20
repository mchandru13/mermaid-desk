import { useMemo, useState } from "react";
import { TEMPLATES, TEMPLATE_FAMILIES } from "../lib/templates";
import { Modal } from "./Modal";
import { ChevronRightIcon } from "./Icons";

interface TemplateGalleryProps {
  onInsert: (source: string, title: string) => void;
  onClose: () => void;
}

export function TemplateGallery({ onInsert, onClose }: TemplateGalleryProps) {
  const [family, setFamily] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(TEMPLATES[0].id);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TEMPLATES.filter((template) => {
      const matchesFamily = family === "all" || template.family === family;
      const matchesQuery =
        !needle ||
        template.title.toLowerCase().includes(needle) ||
        template.description.toLowerCase().includes(needle) ||
        template.source.toLowerCase().includes(needle);
      return matchesFamily && matchesQuery;
    });
  }, [family, query]);

  const selected =
    filtered.find((template) => template.id === selectedId) ?? filtered[0] ?? null;

  return (
    <Modal
      title="Diagram templates"
      subtitle="Start from a working example. A template opens in a new tab, so your current diagram is left untouched."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!selected}
            onClick={() => {
              if (selected) onInsert(selected.source, selected.title);
            }}
            data-testid="insert-template"
          >
            Use template
          </button>
        </>
      }
    >
      <div className="template-layout">
        <aside className="template-sidebar">
          <label className="field">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="flowchart, gantt, sequence…"
              autoFocus
            />
          </label>
          <div className="filter-list" role="listbox" aria-label="Template family">
            <button
              className={`filter-item ${family === "all" ? "active" : ""}`}
              onClick={() => setFamily("all")}
            >
              All
            </button>
            {TEMPLATE_FAMILIES.map((entry) => (
              <button
                key={entry.key}
                className={`filter-item ${family === entry.key ? "active" : ""}`}
                onClick={() => setFamily(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <ul className="template-list">
            {filtered.map((template) => (
              <li key={template.id}>
                <button
                  className={`template-item ${selected?.id === template.id ? "active" : ""}`}
                  onClick={() => setSelectedId(template.id)}
                  onDoubleClick={() => onInsert(template.source, template.title)}
                >
                  <span>
                    <strong>{template.title}</strong>
                    <small>{template.description}</small>
                  </span>
                  <ChevronRightIcon size={14} />
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="template-empty">No template matches that search.</li>
            ) : null}
          </ul>
        </aside>
        <div className="template-preview">
          {selected ? (
            <>
              <h3>{selected.title}</h3>
              <pre>{selected.source}</pre>
            </>
          ) : (
            <p>Select a template to preview its source.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
