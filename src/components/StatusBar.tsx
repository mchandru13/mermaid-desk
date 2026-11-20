import type { OpenDocument } from "../types";
import type { DiagramTypeInfo } from "../lib/diagramType";
import { isDirty } from "../lib/tabs";
import { AlertIcon, CheckIcon, ClockIcon } from "./Icons";

interface StatusBarProps {
  document: OpenDocument | null;
  diagramType: DiagramTypeInfo | null;
  cursor: { line: number; column: number };
  zoom: number;
  rendering: boolean;
  hasError: boolean;
  appVersion: string;
  status: { text: string; tone: "info" | "success" | "error" } | null;
}

export function StatusBar({
  document,
  diagramType,
  cursor,
  zoom,
  rendering,
  hasError,
  appVersion,
  status,
}: StatusBarProps) {
  const dirty = document ? isDirty(document) : false;
  return (
    <footer className="status-bar" data-testid="status-bar">
      <div className="status-left">
        <span className="status-item path" title={document?.path ?? "Not saved to disk"}>
          {document?.path ?? "Unsaved draft"}
        </span>
        {document ? (
          <span className={`status-item ${dirty ? "dirty" : "saved"}`} data-testid="save-state">
            {dirty ? (
              <>
                <ClockIcon size={12} /> Unsaved changes
              </>
            ) : document.path ? (
              <>
                <CheckIcon size={12} /> Saved
              </>
            ) : (
              <>
                <CheckIcon size={12} /> Not saved yet
              </>
            )}
          </span>
        ) : null}
      </div>

      <div className="status-right">
        {status ? (
          <span className={`status-toast ${status.tone}`} data-testid="status-message">
            {status.text}
          </span>
        ) : null}
        {diagramType && diagramType.keyword ? (
          <span className="status-item suggest">{diagramType.label}</span>
        ) : null}
        {hasError ? (
          <span className="status-item error">
            <AlertIcon size={12} /> Error
          </span>
        ) : null}
        {rendering ? <span className="status-item">Rendering…</span> : null}
        <span className="status-item">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="status-item">{Math.round(zoom * 100)}%</span>
        <span className="status-item offline" title="No network connection is required">
          Offline
        </span>
        <span className="status-item muted">v{appVersion}</span>
      </div>
    </footer>
  );
}
