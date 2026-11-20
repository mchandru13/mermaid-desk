import { useRef } from "react";
import type { OpenDocument } from "../types";
import { isDirty } from "../lib/tabs";
import { PlusIcon, XIcon } from "./Icons";

interface TabStripProps {
  documents: OpenDocument[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (fromId: string, toId: string) => void;
  onNew: () => void;
}

export function TabStrip({
  documents,
  activeId,
  onSelect,
  onClose,
  onMove,
  onNew,
}: TabStripProps) {
  const dragId = useRef<string | null>(null);

  return (
    <div className="tab-strip" role="tablist" aria-label="Open diagrams">
      <div className="tab-scroll">
        {documents.map((document) => {
          const active = document.id === activeId;
          const dirty = isDirty(document);
          return (
            <div
              key={document.id}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={`tab ${active ? "active" : ""}`}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(document.id);
                } else if (event.button === 0) {
                  onSelect(document.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(document.id);
                }
              }}
              title={document.path ?? "Not saved yet"}
              draggable
              onDragStart={() => {
                dragId.current = document.id;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId.current) onMove(dragId.current, document.id);
                dragId.current = null;
              }}
              data-testid={`tab-${document.name}`}
            >
              <span
                className={`tab-dot ${dirty ? "dirty" : ""}`}
                aria-hidden="true"
                title={dirty ? "Unsaved changes" : "Saved"}
              />
              <span className="tab-name">{document.name}</span>
              <button
                className="tab-close"
                aria-label={`Close ${document.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(document.id);
                }}
              >
                <XIcon size={13} />
              </button>
            </div>
          );
        })}
        <button className="tab-new" onClick={onNew} aria-label="New diagram (Ctrl+N)" title="New diagram (Ctrl+N)">
          <PlusIcon size={15} />
        </button>
      </div>
    </div>
  );
}
