import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import type { AppInfo } from "../types";
import { Modal } from "./Modal";

interface DialogsProps {
  platform: string;
  appInfo: AppInfo | null;
  onClose: () => void;
}

export function ShortcutsDialog({ platform, onClose }: DialogsProps) {
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Every shortcut works without a mouse and without a network connection."
      onClose={onClose}
      size="md"
      footer={
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map((shortcut) => (
            <tr key={shortcut.action}>
              <th scope="row">{shortcut.label}</th>
              <td>
                <kbd>{shortcutLabel(shortcut.keys, platform)}</kbd>
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">Pan preview</th>
            <td>
              <kbd>Drag</kbd>
            </td>
          </tr>
          <tr>
            <th scope="row">Zoom at cursor</th>
            <td>
              <kbd>{platform === "macos" ? "⌘" : "Ctrl"} + wheel</kbd>
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}

export function AboutDialog({ appInfo, onClose }: DialogsProps) {
  return (
    <Modal
      title="MermaidDesk"
      subtitle="A local-first Mermaid diagram editor."
      onClose={onClose}
      size="sm"
      footer={
        <button className="button primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="about-body">
        <div className="about-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="56" height="56">
            <rect width="32" height="32" rx="9" fill="#4f46e5" />
            <path
              d="M10 10.5v6.5l6 5 6-5v-6.5"
              fill="none"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <dl className="about-grid">
          <dt>Version</dt>
          <dd>{appInfo?.version ?? "1.0.0"}</dd>
          <dt>Desktop shell</dt>
          <dd>Tauri {appInfo?.tauriVersion ?? "2"}</dd>
          <dt>Renderer</dt>
          <dd>Mermaid.js (bundled)</dd>
          <dt>Editor</dt>
          <dd>Monaco (bundled)</dd>
          <dt>Settings</dt>
          <dd className="mono">{appInfo?.configDir ?? "Local app data"}</dd>
        </dl>
        <p className="about-note">
          MermaidDesk keeps your diagrams on your own disk. It has no account
          system, telemetry, or hosted rendering dependency, and it works with the
          network disconnected.
        </p>
        <p className="about-note muted">
          MIT licensed. Mermaid.js and Monaco retain their own licences (see
          THIRD_PARTY_NOTICES.md).
        </p>
      </div>
    </Modal>
  );
}
