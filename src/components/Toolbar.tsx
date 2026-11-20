import type { AppSettings, ResolvedTheme } from "../types";
import { Dropdown, DropdownItem, DropdownSeparator } from "./Dropdown";
import {
  ClipboardIcon,
  DownloadIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  GridIcon,
  ImageIcon,
  InfoIcon,
  KeyboardIcon,
  LayoutIcon,
  MoonIcon,
  SaveIcon,
  SettingsIcon,
  SunIcon,
} from "./Icons";

interface ToolbarProps {
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
  recentFiles: string[];
  canSave: boolean;
  canExportBeside: boolean;
  previewVisible: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenRecent: (path: string) => void;
  onReveal: () => void;
  onExport: (kind: "svg" | "png") => void;
  onExportBeside: (kind: "svg" | "png") => void;
  onExportTransparentSvg: () => void;
  onCopyPng: () => void;
  onCopyPngTransparent: () => void;
  onShowTemplates: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onTogglePreview: () => void;
  onThemeChange: (theme: AppSettings["theme"]) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
}

function recentLabel(path: string): { name: string; folder: string } {
  const parts = path.split(/[\\/]/);
  const name = parts.pop() ?? path;
  return { name, folder: parts.join("\\") };
}

export function Toolbar({
  resolvedTheme,
  settings,
  recentFiles,
  canSave,
  canExportBeside,
  previewVisible,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onOpenRecent,
  onReveal,
  onExport,
  onExportBeside,
  onExportTransparentSvg,
  onCopyPng,
  onCopyPngTransparent,
  onShowTemplates,
  onShowShortcuts,
  onShowAbout,
  onTogglePreview,
  onThemeChange,
  onSettingsChange,
}: ToolbarProps) {
  return (
    <header className="toolbar" data-testid="toolbar">
      <div className="toolbar-brand" title="MermaidDesk">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <defs>
              <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3b82f6" />
                <stop offset="0.55" stopColor="#8b5cf6" />
                <stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#brand-gradient)" />
            <path
              d="M10 10.5v6.5l6 5 6-5v-6.5"
              fill="none"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="9" r="2.4" fill="#fff" />
            <circle cx="22" cy="9" r="2.4" fill="#fff" />
            <circle cx="16" cy="23" r="2.4" fill="#fff" />
          </svg>
        </span>
        <span className="brand-text">MermaidDesk</span>
      </div>

      <div className="toolbar-group">
        <button className="toolbar-button" onClick={onNew} title="New diagram (Ctrl+N)">
          <FilePlusIcon />
          <span className="toolbar-label">New</span>
        </button>
        <button className="toolbar-button" onClick={onOpen} title="Open diagram (Ctrl+O)">
          <FolderOpenIcon />
          <span className="toolbar-label">Open</span>
        </button>
        <button
          className="toolbar-button primary"
          onClick={onSave}
          disabled={!canSave}
          title="Save (Ctrl+S)"
          data-testid="save-button"
        >
          <SaveIcon />
          <span className="toolbar-label">Save</span>
        </button>

        <Dropdown
          label={
            <>
              <FolderSearchIcon />
              <span className="toolbar-label">Recent</span>
            </>
          }
          title="Recent files (Ctrl+R)"
          testId="recent-menu"
        >
          {(close) => (
            <>
              {recentFiles.length === 0 ? (
                <div className="dropdown-empty">No recent diagrams yet.</div>
              ) : (
                recentFiles.map((path) => {
                  const { name, folder } = recentLabel(path);
                  return (
                    <DropdownItem
                      key={path}
                      onClick={() => {
                        onOpenRecent(path);
                        close();
                      }}
                      hint={folder}
                    >
                      {name}
                    </DropdownItem>
                  );
                })
              )}
              {recentFiles.length > 0 ? (
                <>
                  <DropdownSeparator />
                  <DropdownItem
                    onClick={() => {
                      onReveal();
                      close();
                    }}
                    hint="Explorer / Finder"
                  >
                    Show current file in folder
                  </DropdownItem>
                </>
              ) : null}
            </>
          )}
        </Dropdown>
      </div>

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={onShowTemplates}
          title="Insert a diagram template"
          data-testid="templates-button"
        >
          <GridIcon />
          <span className="toolbar-label">Templates</span>
        </button>

        <Dropdown
          label={
            <>
              <DownloadIcon />
              <span className="toolbar-label">Export</span>
            </>
          }
          title="Export the current preview"
          testId="export-menu"
        >
          {(close) => (
            <>
              <DropdownItem
                onClick={() => {
                  onExport("svg");
                  close();
                }}
                hint="vector"
              >
                <ImageIcon size={14} /> Export SVG…
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  onExport("png");
                  close();
                }}
                hint="2× raster"
              >
                <ImageIcon size={14} /> Export PNG…
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  onExportTransparentSvg();
                  close();
                }}
                hint={resolvedTheme === "dark" ? "light text" : "dark text"}
              >
                <ImageIcon size={14} /> Export SVG (transparent)…
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                onClick={() => {
                  onCopyPng();
                  close();
                }}
                hint="Ctrl+Shift+C"
              >
                <ClipboardIcon size={14} /> Copy PNG
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  onCopyPngTransparent();
                  close();
                }}
                hint="no background"
              >
                <ClipboardIcon size={14} /> Copy PNG (transparent)
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                onClick={() => {
                  onExportBeside("svg");
                  close();
                }}
                hint={canExportBeside ? "next to .mmd" : "save first"}
                disabled={!canExportBeside}
              >
                <ImageIcon size={14} /> Export SVG beside diagram
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  onExportBeside("png");
                  close();
                }}
                hint={canExportBeside ? "next to .mmd" : "save first"}
                disabled={!canExportBeside}
              >
                <ImageIcon size={14} /> Export PNG beside diagram
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                onClick={() => {
                  onSaveAs();
                  close();
                }}
                hint="Ctrl+Shift+S"
              >
                Save As…
              </DropdownItem>
            </>
          )}
        </Dropdown>

        <button
          className={`toolbar-button ${previewVisible ? "active" : ""}`}
          onClick={onTogglePreview}
          title="Toggle preview (Ctrl+Shift+D)"
          aria-pressed={previewVisible}
        >
          <LayoutIcon />
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={() => onThemeChange(resolvedTheme === "dark" ? "light" : "dark")}
          title="Toggle theme (Ctrl+Shift+T)"
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        <Dropdown
          label={<SettingsIcon />}
          title="Editor settings"
          align="right"
          testId="settings-menu"
          className="icon-only"
        >
          {(close) => (
            <>
              <DropdownItem
                onClick={() => onSettingsChange({ wordWrap: !settings.wordWrap })}
                checked={settings.wordWrap}
              >
                Word wrap
              </DropdownItem>
              <DropdownItem
                onClick={() =>
                  onSettingsChange({ showLineNumbers: !settings.showLineNumbers })
                }
                checked={settings.showLineNumbers}
              >
                Line numbers
              </DropdownItem>
              <DropdownItem
                onClick={() => onSettingsChange({ autoSave: !settings.autoSave })}
                checked={settings.autoSave}
                hint="saved files only"
              >
                Auto-save
              </DropdownItem>
              <DropdownSeparator />
              <div className="dropdown-row">
                <span>Font size</span>
                <div className="stepper">
                  <button
                    onClick={() =>
                      onSettingsChange({
                        editorFontSize: Math.max(10, settings.editorFontSize - 1),
                      })
                    }
                    aria-label="Decrease font size"
                  >
                    −
                  </button>
                  <span>{settings.editorFontSize}px</span>
                  <button
                    onClick={() =>
                      onSettingsChange({
                        editorFontSize: Math.min(28, settings.editorFontSize + 1),
                      })
                    }
                    aria-label="Increase font size"
                  >
                    +
                  </button>
                </div>
              </div>
              <DropdownSeparator />
              <DropdownItem onClick={() => onThemeChange("system")} checked={settings.theme === "system"}>
                Theme: system
              </DropdownItem>
              <DropdownItem onClick={() => onThemeChange("light")} checked={settings.theme === "light"}>
                Theme: light
              </DropdownItem>
              <DropdownItem onClick={() => onThemeChange("dark")} checked={settings.theme === "dark"}>
                Theme: dark
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem onClick={close} hint="Esc">
                Close menu
              </DropdownItem>
            </>
          )}
        </Dropdown>

        <button
          className="toolbar-button"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts (F1)"
          aria-label="Keyboard shortcuts"
        >
          <KeyboardIcon />
        </button>
        <button
          className="toolbar-button"
          onClick={onShowAbout}
          title="About MermaidDesk"
          aria-label="About MermaidDesk"
        >
          <InfoIcon />
        </button>
      </div>
    </header>
  );
}
