//! Local, offline-first application settings.
//!
//! Settings live in a single JSON file inside the platform configuration
//! directory. The file is written atomically and validated on read; a corrupt
//! file falls back to defaults without destroying the user's copy.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::documents::MAX_DOCUMENT_BYTES;
use crate::error::{AppError, AppResult};

const SETTINGS_VERSION: u32 = 1;
const MAX_RECENT_FILES: usize = 15;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub theme: String,
    pub editor_theme: String,
    pub editor_font_size: u32,
    pub word_wrap: bool,
    pub show_line_numbers: bool,
    pub preview_scale: f64,
    pub editor_split: f64,
    pub auto_save: bool,
    pub recent_files: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            theme: "system".to_string(),
            editor_theme: "vs-dark".to_string(),
            editor_font_size: 14,
            word_wrap: false,
            show_line_numbers: true,
            preview_scale: 1.0,
            editor_split: 50.0,
            auto_save: false,
            recent_files: Vec::new(),
        }
    }
}

impl Settings {
    /// Clamp values that came from disk or the renderer into a usable range.
    /// This keeps a hand-edited settings file from breaking the UI.
    pub fn sanitized(mut self) -> Self {
        self.version = SETTINGS_VERSION;
        if !matches!(self.theme.as_str(), "light" | "dark" | "system") {
            self.theme = "system".to_string();
        }
        if self.editor_theme.is_empty() || self.editor_theme.len() > 40 {
            self.editor_theme = "vs-dark".to_string();
        }
        self.editor_font_size = self.editor_font_size.clamp(10, 28);
        if !self.preview_scale.is_finite() {
            self.preview_scale = 1.0;
        }
        self.preview_scale = self.preview_scale.clamp(0.25, 4.0);
        if !self.editor_split.is_finite() {
            self.editor_split = 50.0;
        }
        // Keep both panes usable; the UI has the same range.
        self.editor_split = self.editor_split.clamp(20.0, 85.0);

        let mut seen = std::collections::HashSet::new();
        self.recent_files = self
            .recent_files
            .into_iter()
            .filter(|entry| entry.len() < 4096)
            .filter(|entry| Path::new(entry).is_absolute())
            .filter(|entry| seen.insert(entry.clone()))
            .take(MAX_RECENT_FILES)
            .collect();
        self
    }
}

#[derive(Default)]
pub struct SettingsState {
    write_lock: Mutex<()>,
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

fn read_settings_file(path: &Path) -> Settings {
    let Ok(metadata) = fs::metadata(path) else {
        return Settings::default();
    };
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Settings::default();
    }
    let Ok(bytes) = fs::read(path) else {
        return Settings::default();
    };
    serde_json::from_slice::<Settings>(&bytes)
        .map(Settings::sanitized)
        .unwrap_or_default()
}

pub fn load_settings(config_dir: &Path) -> Settings {
    read_settings_file(&settings_path(config_dir))
}

pub fn store_settings(config_dir: &Path, settings: Settings) -> AppResult<Settings> {
    let settings = settings.sanitized();
    fs::create_dir_all(config_dir)
        .map_err(|err| AppError::io(format!("Cannot create the settings folder: {err}")))?;
    let path = settings_path(config_dir);

    // Keep one backup of the previous file so a crash cannot lose preferences.
    if path.exists() {
        let backup = config_dir.join("settings.backup.json");
        let _ = fs::copy(&path, backup);
    }

    let serialized = serde_json::to_vec_pretty(&settings)
        .map_err(|err| AppError::invalid(format!("Cannot serialise settings: {err}")))?;

    let mut temp = tempfile::NamedTempFile::new_in(config_dir)
        .map_err(|err| AppError::io(format!("Cannot create a temporary settings file: {err}")))?;
    use std::io::Write as _;
    temp.write_all(&serialized)
        .map_err(|err| AppError::io(format!("Cannot write settings: {err}")))?;
    temp.as_file()
        .sync_all()
        .map_err(|err| AppError::io(format!("Cannot flush settings: {err}")))?;
    temp.persist(&path)
        .map_err(|err| AppError::io(format!("Cannot save settings: {}", err.error)))?;

    Ok(settings)
}

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|err| AppError::io(format!("Cannot resolve the configuration folder: {err}")))
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> AppResult<Settings> {
    Ok(load_settings(&config_dir(&app)?))
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    settings: Settings,
) -> AppResult<Settings> {
    let _guard = state.write_lock.lock().expect("settings lock");
    store_settings(&config_dir(&app)?, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let settings = Settings::default();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.editor_font_size, 14);
        assert!(!settings.auto_save);
    }

    #[test]
    fn roundtrips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::default();
        settings.theme = "dark".to_string();
        settings.recent_files = vec!["C:\\diagrams\\one.mmd".to_string()];
        let stored = store_settings(dir.path(), settings.clone()).unwrap();
        assert_eq!(stored, settings);
        let loaded = load_settings(dir.path());
        assert_eq!(loaded, settings);
    }

    #[test]
    fn sanitizes_hand_edited_values() {
        let raw = Settings {
            theme: "neon".to_string(),
            editor_font_size: 200,
            preview_scale: f64::NAN,
            editor_split: 4.0,
            recent_files: vec![
                "C:\\a.mmd".to_string(),
                "C:\\a.mmd".to_string(),
                "relative/path.mmd".to_string(),
            ],
            ..Settings::default()
        };
        let clean = raw.sanitized();
        assert_eq!(clean.theme, "system");
        assert_eq!(clean.editor_font_size, 28);
        assert_eq!(clean.preview_scale, 1.0);
        assert_eq!(clean.editor_split, 20.0);
        assert_eq!(clean.recent_files, vec!["C:\\a.mmd".to_string()]);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults_without_rewriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        fs::write(&path, b"{ not json").unwrap();
        let loaded = load_settings(dir.path());
        assert_eq!(loaded, Settings::default());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn writes_a_backup_when_replacing() {
        let dir = tempfile::tempdir().unwrap();
        store_settings(dir.path(), Settings::default()).unwrap();
        let mut changed = Settings::default();
        changed.theme = "light".to_string();
        store_settings(dir.path(), changed).unwrap();
        assert!(dir.path().join("settings.backup.json").exists());
    }

    #[test]
    fn recent_files_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = Settings::default();
        settings.recent_files = (0..40)
            .map(|index| format!("C:\\diagrams\\{index}.mmd"))
            .collect();
        let stored = store_settings(dir.path(), settings).unwrap();
        assert_eq!(stored.recent_files.len(), MAX_RECENT_FILES);
    }
}
