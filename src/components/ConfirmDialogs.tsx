import { AlertIcon } from "./Icons";
import { Modal } from "./Modal";

export interface UnsavedPrompt {
  name: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedDialog({ name, onSave, onDiscard, onCancel }: UnsavedPrompt) {
  return (
    <Modal
      title={`Save changes to “${name}”?`}
      subtitle="Your edits have not been written to disk yet."
      onClose={onCancel}
      size="sm"
      dismissible={false}
      footer={
        <>
          <button className="button ghost" onClick={onCancel} data-testid="unsaved-cancel">
            Cancel
          </button>
          <button className="button danger" onClick={onDiscard} data-testid="unsaved-discard">
            Discard
          </button>
          <button className="button primary" onClick={onSave} data-testid="unsaved-save">
            Save
          </button>
        </>
      }
    >
      <p className="dialog-text">
        Saving writes the current source to the file on disk. Discarding restores
        the last saved version and cannot be undone.
      </p>
    </Modal>
  );
}

export interface ConfirmPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmPrompt) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      dismissible={false}
      footer={
        <>
          <button className="button ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`button ${tone === "danger" ? "danger" : "primary"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-text">{message}</p>
      {tone === "danger" ? (
        <p className="dialog-warning">
          <AlertIcon size={14} /> This action cannot be undone.
        </p>
      ) : null}
    </Modal>
  );
}
