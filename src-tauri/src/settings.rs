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

use crate::documents::{
    canonical_existing, has_diagram_extension, same_file, DocumentAccess, MAX_DOCUMENT_BYTES,
};
use crate::error::{AppError, AppResult};

const SETTINGS_VERSION: u32 = 2;
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
            // A poisoned pre-1.1.1 settings file could list any path. Only
            // diagram files are ever legitimate recents.
            .filter(|entry| has_diagram_extension(Path::new(entry)))
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

pub(crate) fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|err| AppError::io(format!("Cannot resolve the configuration folder: {err}")))
}

/// Keep only recent entries the webview may add.
///
/// The list is display data, so removals (a subset of the input) are always
/// allowed. An *addition* must be a path authorised in this session, or an entry
/// that was already persisted. Without this, a compromised renderer could write
/// `recentFiles: [<any path>]` and then read that file through the recent-file
/// path — defeating the authorisation check in `read_document`.
pub(crate) fn keep_trusted_recents(
    incoming: Vec<String>,
    existing: &[String],
    access: &DocumentAccess,
) -> Vec<String> {
    incoming
        .into_iter()
        .filter(|entry| {
            let path = Path::new(entry);
            if !path.is_absolute() || !has_diagram_extension(path) {
                return false;
            }
            match canonical_existing(path) {
                Ok(canonical) => {
                    access.is_authorized(&canonical)
                        || existing.iter().any(|old| {
                            // Avoid resolving every persisted recent (network shares).
                            old == entry || same_file(Path::new(old), &canonical)
                        })
                }
                // The file no longer resolves (deleted). Keep it only if it was
                // already a recent, so pruning still works and forging cannot.
                Err(_) => existing.iter().any(|old| old == entry),
            }
        })
        .collect()
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> AppResult<Settings> {
    Ok(load_settings(&config_dir(&app)?))
}

/// Merge an incoming settings write with the trust rules for recents.
fn merged_for_write(incoming: Settings, existing: &Settings, access: &DocumentAccess) -> Settings {
    Settings {
        recent_files: keep_trusted_recents(incoming.recent_files, &existing.recent_files, access),
        ..incoming
    }
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    state: tauri::State<'_, SettingsState>,
    access: tauri::State<'_, DocumentAccess>,
    settings: Settings,
) -> AppResult<Settings> {
    let _guard = state.write_lock.lock().expect("settings lock");
    let dir = config_dir(&app)?;
    let existing = load_settings(&dir);
    let settings = merged_for_write(settings, &existing, &access);
    store_settings(&dir, settings)
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

    /// An absolute path for the current platform. The settings filter drops
    /// entries that are not absolute, and `C:\...` is not absolute on Unix.
    fn absolute_path(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn roundtrips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            theme: "dark".to_string(),
            recent_files: vec![absolute_path("one.mmd")],
            ..Settings::default()
        };
        let stored = store_settings(dir.path(), settings.clone()).unwrap();
        assert_eq!(stored, settings);
        let loaded = load_settings(dir.path());
        assert_eq!(loaded, settings);
    }

    #[test]
    fn sanitizes_hand_edited_values() {
        let keep = absolute_path("a.mmd");
        let raw = Settings {
            theme: "neon".to_string(),
            editor_font_size: 200,
            preview_scale: f64::NAN,
            editor_split: 4.0,
            recent_files: vec![keep.clone(), keep.clone(), "relative/path.mmd".to_string()],
            ..Settings::default()
        };
        let clean = raw.sanitized();
        assert_eq!(clean.theme, "system");
        assert_eq!(clean.editor_font_size, 28);
        assert_eq!(clean.preview_scale, 1.0);
        assert_eq!(clean.editor_split, 20.0);
        assert_eq!(clean.recent_files, vec![keep]);
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
        let changed = Settings {
            theme: "light".to_string(),
            ..Settings::default()
        };
        store_settings(dir.path(), changed).unwrap();
        assert!(dir.path().join("settings.backup.json").exists());
    }

    #[test]
    fn recent_files_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            recent_files: (0..40)
                .map(|index| absolute_path(&format!("{index}.mmd")))
                .collect(),
            ..Settings::default()
        };
        let stored = store_settings(dir.path(), settings).unwrap();
        assert_eq!(stored.recent_files.len(), MAX_RECENT_FILES);
    }

    #[test]
    fn recents_can_only_add_paths_the_user_opened() {
        let dir = tempfile::tempdir().unwrap();
        let opened = dir.path().join("opened.mmd");
        let forged = dir.path().join("secret.txt");
        fs::write(&opened, "graph TD").unwrap();
        fs::write(&forged, "top secret").unwrap();

        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(&opened).unwrap());

        let kept = keep_trusted_recents(
            vec![
                opened.to_string_lossy().to_string(),
                forged.to_string_lossy().to_string(),
                "relative/path.mmd".to_string(),
            ],
            &[],
            &access,
        );

        // The forged absolute path and the relative one are dropped.
        assert_eq!(kept, vec![opened.to_string_lossy().to_string()]);
    }

    #[test]
    fn recents_survive_a_restart_and_can_be_removed() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old.mmd");
        fs::write(&old, "graph TD").unwrap();
        let old = old.to_string_lossy().to_string();

        // Nothing is authorised in a fresh session; the persisted list is trusted.
        let access = DocumentAccess::default();
        let existing = vec![old.clone()];
        assert_eq!(
            keep_trusted_recents(vec![old.clone()], &existing, &access),
            vec![old.clone()]
        );
        assert!(keep_trusted_recents(vec![], &existing, &access).is_empty());
    }

    #[test]
    fn a_poisoned_settings_write_cannot_add_a_recent() {
        let dir = tempfile::tempdir().unwrap();
        let opened = dir.path().join("opened.mmd");
        let secret = dir.path().join("id_rsa");
        fs::write(&opened, "graph TD").unwrap();
        fs::write(&secret, "private").unwrap();

        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(&opened).unwrap());

        let existing = Settings {
            recent_files: vec![opened.to_string_lossy().to_string()],
            ..Settings::default()
        };
        let incoming = Settings {
            theme: "dark".to_string(),
            recent_files: vec![
                opened.to_string_lossy().to_string(),
                secret.to_string_lossy().to_string(),
            ],
            ..Settings::default()
        };

        let merged = merged_for_write(incoming, &existing, &access);
        assert_eq!(merged.theme, "dark", "unrelated settings still save");
        assert_eq!(
            merged.recent_files,
            vec![opened.to_string_lossy().to_string()],
            "the forged entry is dropped"
        );
    }

    #[test]
    fn loading_drops_non_diagram_recents() {
        let settings = Settings {
            recent_files: vec![
                "C:\\notes.txt".to_string(),
                "C:\\keys\\id_rsa".to_string(),
                "C:\\diagram.mmd".to_string(),
            ],
            ..Settings::default()
        }
        .sanitized();

        // .txt is an accepted diagram extension; the key file is not.
        assert_eq!(
            settings.recent_files,
            vec!["C:\\notes.txt".to_string(), "C:\\diagram.mmd".to_string()]
        );
    }
}
