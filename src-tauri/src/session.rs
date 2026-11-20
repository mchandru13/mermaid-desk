//! Session persistence: open tabs and unsaved buffers.
//!
//! This is the crash-recovery and "reopen my workspace" feature. The file lives
//! next to the settings and is written atomically.
//!
//! Trust model:
//! * `save_session` accepts documents from the renderer, but every path must
//!   already be authorised in this session. A compromised renderer cannot add a
//!   path to the session, so the file cannot become a capability.
//! * `load_session` therefore treats persisted paths as trusted, authorises them
//!   and re-reads clean documents from disk. A path that disappeared is restored
//!   as an untitled buffer if it had unsaved content, and skipped otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::documents::{
    canonical_existing, display_path, has_diagram_extension, read_text_file, write_atomic,
    DocumentAccess,
};
use crate::error::{AppError, AppResult};
use crate::settings::config_dir;

const SESSION_VERSION: u32 = 1;
const MAX_SESSION_DOCS: usize = 20;
const MAX_SESSION_BYTES: u64 = 16 * 1024 * 1024;

/// What the renderer sends when it snapshots the workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionDocument {
    pub path: Option<String>,
    pub name: String,
    /// Present for dirty and untitled documents; `None` for clean files, whose
    /// content is re-read from disk on restore.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// The mtime the buffer was based on, so an external edit still produces the
    /// overwrite prompt after a restart.
    pub modified: Option<u64>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionSnapshot {
    pub version: u32,
    pub active: usize,
    pub documents: Vec<SessionDocument>,
}

/// What the frontend gets back, ready to become tabs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredDocument {
    pub path: Option<String>,
    pub name: String,
    pub content: String,
    /// The on-disk content, so a restored buffer keeps its dirty state.
    pub baseline: String,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSession {
    pub active: usize,
    pub documents: Vec<RestoredDocument>,
}

fn session_path(dir: &Path) -> PathBuf {
    dir.join("session.json")
}

fn clean_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Untitled diagram".to_string()
    } else {
        trimmed.chars().take(255).collect()
    }
}

/// Validate a snapshot before it is written.
pub(crate) fn sanitize_snapshot(
    mut snapshot: SessionSnapshot,
    access: &DocumentAccess,
) -> AppResult<SessionSnapshot> {
    snapshot.version = SESSION_VERSION;
    let mut kept = Vec::new();
    let mut total = 0usize;

    for document in snapshot.documents.into_iter().take(MAX_SESSION_DOCS) {
        let name = clean_name(&document.name);
        let (path, content, dirty) = match document.path {
            Some(raw) if !raw.trim().is_empty() => {
                let candidate = PathBuf::from(&raw);
                if !candidate.is_absolute() {
                    return Err(AppError::forbidden("Session paths must be absolute."));
                }
                match canonical_existing(&candidate) {
                    Ok(canonical) => {
                        if !access.is_authorized(&canonical) {
                            return Err(AppError::forbidden(
                                "A session document was not opened in this session.",
                            ));
                        }
                        let content = if document.dirty {
                            Some(document.content.unwrap_or_default())
                        } else {
                            None
                        };
                        // Store the canonical path, so a symlink swap while the
                        // app is closed cannot redirect the next restore.
                        (
                            Some(canonical.to_string_lossy().to_string()),
                            content,
                            document.dirty,
                        )
                    }
                    // The file disappeared mid-session. Keep unsaved work as an
                    // untitled buffer instead of failing the whole snapshot.
                    Err(_) if document.dirty => {
                        (None, Some(document.content.unwrap_or_default()), true)
                    }
                    Err(_) => continue,
                }
            }
            _ => {
                let content = document.content.unwrap_or_default();
                let content = if document.dirty || !content.is_empty() {
                    Some(content)
                } else {
                    None
                };
                (None, content, document.dirty)
            }
        };

        if let Some(text) = &content {
            total = total.saturating_add(text.len());
            if total as u64 > MAX_SESSION_BYTES {
                return Err(AppError::invalid("The session is too large to save."));
            }
        }

        kept.push(SessionDocument {
            path,
            name,
            content,
            modified: document.modified,
            dirty,
        });
    }

    snapshot.active = if kept.is_empty() {
        0
    } else {
        snapshot.active.min(kept.len() - 1)
    };
    snapshot.documents = kept;
    Ok(snapshot)
}

/// Expand a persisted snapshot into documents the frontend can open.
pub(crate) fn restore_session(
    snapshot: SessionSnapshot,
    access: &DocumentAccess,
) -> RestoredSession {
    let mut documents = Vec::new();

    for document in snapshot.documents.into_iter().take(MAX_SESSION_DOCS) {
        let name = clean_name(&document.name);
        let Some(raw) = document.path else {
            let content = document.content.unwrap_or_default();
            let baseline = if document.dirty {
                String::new()
            } else {
                content.clone()
            };
            documents.push(RestoredDocument {
                path: None,
                name,
                content,
                baseline,
                modified: None,
            });
            continue;
        };

        let candidate = PathBuf::from(&raw);
        if !candidate.is_absolute() {
            continue;
        }

        // Only the exact canonical path that was written may be restored, and
        // only if it is a diagram. A hand-edited or redirected session file must
        // not authorise something the app never opened.
        let canonical = match canonical_existing(&candidate) {
            Ok(canonical) if canonical == candidate && has_diagram_extension(&canonical) => {
                canonical
            }
            _ => {
                if document.dirty {
                    documents.push(RestoredDocument {
                        path: None,
                        name,
                        content: document.content.unwrap_or_default(),
                        baseline: String::new(),
                        modified: None,
                    });
                }
                continue;
            }
        };

        if document.dirty {
            // An unreadable file (deleted, oversized, locked, not UTF-8) becomes
            // an untitled buffer rather than an authorised path with no content.
            match read_text_file(&canonical) {
                Ok(payload) => {
                    access.authorize(&canonical);
                    documents.push(RestoredDocument {
                        path: Some(display_path(&canonical)),
                        name,
                        content: document.content.unwrap_or_default(),
                        baseline: payload.content,
                        // The mtime the buffer was based on. If the file changed
                        // while the app was closed, saving still asks first.
                        modified: document.modified.or(payload.modified),
                    });
                }
                Err(_) => documents.push(RestoredDocument {
                    path: None,
                    name,
                    content: document.content.unwrap_or_default(),
                    baseline: String::new(),
                    modified: None,
                }),
            }
        } else if let Ok(payload) = read_text_file(&canonical) {
            // Clean documents follow the file on disk, not a stale copy.
            access.authorize(&canonical);
            documents.push(RestoredDocument {
                path: Some(payload.path),
                name: payload.name,
                baseline: payload.content.clone(),
                content: payload.content,
                modified: payload.modified,
            });
        }
    }

    let active = if documents.is_empty() {
        0
    } else {
        snapshot.active.min(documents.len() - 1)
    };
    RestoredSession { active, documents }
}

pub(crate) fn read_session(dir: &Path) -> Option<SessionSnapshot> {
    let path = session_path(dir);
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() > MAX_SESSION_BYTES {
        set_aside(&path);
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(snapshot) => Some(snapshot),
        Err(_) => {
            // Keep the bytes for manual recovery instead of letting the next
            // autosave overwrite them with a fresh workspace.
            set_aside(&path);
            None
        }
    }
}

fn set_aside(path: &Path) {
    let _ = fs::rename(path, path.with_file_name("session.corrupt.json"));
}

pub(crate) fn write_session(dir: &Path, snapshot: &SessionSnapshot) -> AppResult<()> {
    let bytes = serde_json::to_vec(snapshot)
        .map_err(|err| AppError::invalid(format!("Cannot serialise the session: {err}")))?;
    write_atomic(&session_path(dir), &bytes)
}

/// Persist the open tabs. Best effort from the UI's point of view, but the file
/// is written atomically so a crash cannot leave a half-written session.
#[tauri::command]
pub fn save_session(
    app: AppHandle,
    access: State<'_, DocumentAccess>,
    session: SessionSnapshot,
) -> AppResult<()> {
    let snapshot = sanitize_snapshot(session, &access)?;
    write_session(&config_dir(&app)?, &snapshot)
}

/// Return the previous session, or `None` when there is no session file.
#[tauri::command]
pub fn load_session(
    app: AppHandle,
    access: State<'_, DocumentAccess>,
) -> AppResult<Option<RestoredSession>> {
    let Some(snapshot) = read_session(&config_dir(&app)?) else {
        return Ok(None);
    };
    Ok(Some(restore_session(snapshot, &access)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn open_file(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    /// Session paths are stored in canonical form; tests must do the same.
    fn stored(path: &Path) -> String {
        canonical_existing(path)
            .unwrap()
            .to_string_lossy()
            .to_string()
    }

    fn authorised(path: &Path) -> DocumentAccess {
        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(path).unwrap());
        access
    }

    fn dirty(path: &Path, content: &str) -> SessionDocument {
        SessionDocument {
            path: Some(stored(path)),
            name: "diagram.mmd".to_string(),
            content: Some(content.to_string()),
            modified: None,
            dirty: true,
        }
    }

    fn clean(path: &Path) -> SessionDocument {
        SessionDocument {
            path: Some(stored(path)),
            name: "diagram.mmd".to_string(),
            content: None,
            modified: None,
            dirty: false,
        }
    }

    #[test]
    fn saving_requires_authorisation() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "secret.md", "private");
        let access = DocumentAccess::default();

        let snapshot = SessionSnapshot {
            version: 0,
            active: 0,
            documents: vec![clean(&path)],
        };
        assert_eq!(
            sanitize_snapshot(snapshot, &access).unwrap_err().code,
            "forbidden"
        );
    }

    #[test]
    fn saving_drops_the_content_of_clean_documents() {
        let dir = tempfile::tempdir().unwrap();
        let clean_path = open_file(dir.path(), "clean.mmd", "graph TD");
        let dirty_path = open_file(dir.path(), "dirty.mmd", "graph TD");
        let access = authorised(&clean_path);
        access.authorize(&canonical_existing(&dirty_path).unwrap());

        let snapshot = SessionSnapshot {
            version: 0,
            active: 1,
            documents: vec![clean(&clean_path), dirty(&dirty_path, "graph LR")],
        };
        let stored = sanitize_snapshot(snapshot, &access).unwrap();

        assert_eq!(stored.version, SESSION_VERSION);
        assert_eq!(stored.documents[0].content, None);
        assert_eq!(stored.documents[1].content.as_deref(), Some("graph LR"));
        assert_eq!(stored.active, 1);
    }

    #[test]
    fn saving_keeps_unsaved_work_when_the_file_disappeared() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "gone.mmd", "graph TD");
        let path_text = stored(&path);
        let access = authorised(&path);
        fs::remove_file(&path).unwrap();

        let stored = sanitize_snapshot(
            SessionSnapshot {
                version: 0,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(path_text),
                    name: "diagram.mmd".to_string(),
                    content: Some("graph LR".to_string()),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        )
        .unwrap();

        assert_eq!(stored.documents[0].path, None);
        assert_eq!(stored.documents[0].content.as_deref(), Some("graph LR"));
        assert!(stored.documents[0].dirty);
    }

    #[test]
    fn saving_caps_documents_and_active() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "one.mmd", "graph TD");
        let access = authorised(&path);
        let documents = (0..25).map(|_| clean(&path)).collect();

        let stored = sanitize_snapshot(
            SessionSnapshot {
                version: 0,
                active: 99,
                documents,
            },
            &access,
        )
        .unwrap();

        assert_eq!(stored.documents.len(), MAX_SESSION_DOCS);
        assert_eq!(stored.active, MAX_SESSION_DOCS - 1);
    }

    #[test]
    fn saving_rejects_an_oversized_buffer() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "big.mmd", "graph TD");
        let access = authorised(&path);

        let huge = "x".repeat(MAX_SESSION_BYTES as usize + 1);
        let error = sanitize_snapshot(
            SessionSnapshot {
                version: 0,
                active: 0,
                documents: vec![SessionDocument {
                    path: None,
                    name: "Untitled".to_string(),
                    content: Some(huge),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid");
    }

    #[test]
    fn clean_documents_restore_from_disk_not_from_the_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "diagram.mmd", "graph TD\n A-->B");
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![clean(&path)],
            },
            &access,
        );

        assert_eq!(restored.documents.len(), 1);
        assert_eq!(restored.documents[0].content, "graph TD\n A-->B");
        assert_eq!(restored.documents[0].baseline, "graph TD\n A-->B");
        // Restoring is what authorises a session path.
        assert!(access.is_authorized(&canonical_existing(&path).unwrap()));
    }

    #[test]
    fn dirty_documents_keep_their_buffer_and_pick_up_the_new_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "diagram.mmd", "graph TD\n A-->B");
        let access = DocumentAccess::default();

        // The file changed on disk while the app was closed.
        fs::write(&path, "graph TD\n A-->C").unwrap();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![dirty(&path, "graph LR")],
            },
            &access,
        );

        assert_eq!(restored.documents[0].content, "graph LR");
        assert_eq!(restored.documents[0].baseline, "graph TD\n A-->C");
        assert_eq!(
            restored.documents[0].path,
            Some(display_path(&canonical_existing(&path).unwrap()))
        );
    }

    #[test]
    fn a_restored_dirty_buffer_keeps_the_old_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "diagram.mmd", "graph TD");
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(stored(&path)),
                    name: "diagram.mmd".to_string(),
                    content: Some("graph LR".to_string()),
                    modified: Some(111),
                    dirty: true,
                }],
            },
            &access,
        );

        // Saving must still detect that the file changed while the app was closed.
        assert_eq!(restored.documents[0].modified, Some(111));
    }

    #[test]
    fn a_missing_dirty_document_comes_back_untitled() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "gone.mmd", "graph TD");
        let path_text = stored(&path);
        fs::remove_file(&path).unwrap();
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(path_text),
                    name: "diagram.mmd".to_string(),
                    content: Some("graph LR".to_string()),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        );

        assert_eq!(restored.documents[0].path, None);
        assert_eq!(restored.documents[0].content, "graph LR");
        assert_eq!(restored.documents[0].baseline, "");
    }

    #[test]
    fn a_missing_clean_document_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.mmd");
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(path.to_string_lossy().to_string()),
                    name: "diagram.mmd".to_string(),
                    content: None,
                    modified: None,
                    dirty: false,
                }],
            },
            &access,
        );

        assert!(restored.documents.is_empty());
    }

    #[test]
    fn untitled_buffers_keep_their_dirty_state() {
        let access = DocumentAccess::default();
        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![
                    SessionDocument {
                        path: None,
                        name: "Welcome".to_string(),
                        content: Some("graph TD".to_string()),
                        modified: None,
                        dirty: false,
                    },
                    SessionDocument {
                        path: None,
                        name: "Draft".to_string(),
                        content: Some("graph LR".to_string()),
                        modified: None,
                        dirty: true,
                    },
                ],
            },
            &access,
        );

        assert_eq!(restored.documents[0].baseline, "graph TD");
        assert_eq!(restored.documents[1].baseline, "");
    }

    #[test]
    fn active_is_clamped_when_documents_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone.mmd");
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 5,
                documents: vec![SessionDocument {
                    path: None,
                    name: "Draft".to_string(),
                    content: Some("graph".to_string()),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        );
        assert_eq!(restored.active, 0);
        assert!(restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(missing.to_string_lossy().to_string()),
                    name: "diagram.mmd".to_string(),
                    content: None,
                    modified: None,
                    dirty: false,
                }],
            },
            &access
        )
        .documents
        .is_empty());
    }

    #[test]
    fn roundtrips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let snapshot = SessionSnapshot {
            version: SESSION_VERSION,
            active: 0,
            documents: vec![SessionDocument {
                path: None,
                name: "Draft".to_string(),
                content: Some("graph TD".to_string()),
                modified: None,
                dirty: true,
            }],
        };

        write_session(dir.path(), &snapshot).unwrap();
        let loaded = read_session(dir.path()).unwrap();
        assert_eq!(loaded.documents[0].content.as_deref(), Some("graph TD"));
    }

    #[test]
    fn a_corrupt_session_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = session_path(dir.path());
        fs::write(&path, "{ not json").unwrap();
        assert!(read_session(dir.path()).is_none());
        assert!(!path.exists());
        assert!(dir.path().join("session.corrupt.json").exists());
    }

    #[test]
    fn restore_does_not_authorise_an_unreadable_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("binary.mmd");
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(stored(&path)),
                    name: "binary.mmd".to_string(),
                    content: Some("graph LR".to_string()),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        );

        assert_eq!(restored.documents[0].path, None);
        assert!(!access.is_authorized(&canonical_existing(&path).unwrap()));
    }

    #[test]
    fn restore_refuses_non_diagram_paths() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "notes.txt", "hello");
        let png = dir.path().join("image.png");
        fs::write(&png, "not really a png").unwrap();
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(stored(&png)),
                    name: "image.png".to_string(),
                    content: Some("graph LR".to_string()),
                    modified: None,
                    dirty: true,
                }],
            },
            &access,
        );

        // .txt is allowed, .png is not; the dirty buffer survives untitled.
        assert_eq!(restored.documents[0].path, None);
        assert!(!access.is_authorized(&canonical_existing(&png).unwrap()));
        assert!(canonical_existing(&path).is_ok());
    }

    #[test]
    fn restore_refuses_a_non_canonical_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = open_file(dir.path(), "diagram.mmd", "graph TD");
        let non_canonical = dir.path().join("sub").join("..").join("diagram.mmd");
        let access = DocumentAccess::default();

        let restored = restore_session(
            SessionSnapshot {
                version: SESSION_VERSION,
                active: 0,
                documents: vec![SessionDocument {
                    path: Some(non_canonical.to_string_lossy().to_string()),
                    name: "diagram.mmd".to_string(),
                    content: None,
                    modified: None,
                    dirty: false,
                }],
            },
            &access,
        );

        assert!(restored.documents.is_empty());
        assert!(!access.is_authorized(&canonical_existing(&path).unwrap()));
    }
}
