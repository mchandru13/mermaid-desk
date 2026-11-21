//! File access for diagram documents.
//!
//! Security model
//! ---------------
//! * The webview never receives a general-purpose filesystem capability. All
//!   reads and writes are funnelled through the commands in this module.
//! * A path is only readable when the user chose it through a native Open
//!   dialog, a native Save dialog, the operating system file association, a
//!   drag-and-drop over the window, or when it is in the persisted recent list
//!   (which only ever contains paths the user opened). Paths supplied by
//!   drag-and-drop and the file association must additionally use a known
//!   diagram extension.
//! * Writes require a path that has already been authorised in this session,
//!   so a compromised renderer cannot overwrite arbitrary files.
//! * Documents are capped at [`MAX_DOCUMENT_BYTES`] and must be valid UTF-8.
//! * Writes are atomic (temp file in the same directory + replacement rename).

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::clipboard::PNG_SIGNATURE;
use crate::error::{AppError, AppResult};

/// Hard ceiling for a diagram document (8 MiB). Mermaid sources are text and
/// anything larger is not a diagram.
pub const MAX_DOCUMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Largest SVG or PNG payload accepted for export.
pub const MAX_EXPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Extensions accepted from drag-and-drop, file association, and recent files.
pub const DIAGRAM_EXTENSIONS: [&str; 4] = ["mmd", "mermaid", "md", "txt"];

/// Extensions offered in the native open dialog.
const DIALOG_FILTERS: [&str; 4] = ["mmd", "mermaid", "md", "txt"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub path: String,
    pub name: String,
    pub content: String,
    /// Last-modified time in milliseconds since the Unix epoch.
    pub modified: Option<u64>,
    /// Byte length of the file on disk (may differ from `content` after edits).
    pub size: u64,
}

#[derive(Default)]
pub struct DocumentAccess {
    /// Canonical paths the user explicitly selected or handed to the app.
    authorized: Mutex<HashSet<PathBuf>>,
    /// Paths handed to the app by the OS (file association, second instance,
    /// drag-and-drop before the UI was ready).
    pending: Mutex<Vec<PathBuf>>,
}

impl DocumentAccess {
    pub fn authorize(&self, path: &Path) {
        let mut guard = self.authorized.lock().expect("document access lock");
        guard.insert(path.to_path_buf());
    }

    pub(crate) fn is_authorized(&self, path: &Path) -> bool {
        self.authorized
            .lock()
            .expect("document access lock")
            .contains(path)
    }

    pub fn push_pending(&self, path: PathBuf) {
        self.pending
            .lock()
            .expect("pending document lock")
            .push(path);
    }

    fn take_pending(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.pending.lock().expect("pending document lock"))
    }
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

pub(crate) fn has_diagram_extension(path: &Path) -> bool {
    extension_of(path)
        .map(|ext| DIAGRAM_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// Resolve an existing file to its canonical path.
/// Canonicalise an existing file, rejecting directories and missing paths.
pub(crate) fn canonical_existing(path: &Path) -> AppResult<PathBuf> {
    let canonical = fs::canonicalize(path)
        .map_err(|err| AppError::io(format!("Cannot open {}: {err}", path.display())))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|err| AppError::io(format!("Cannot stat {}: {err}", canonical.display())))?;
    if !metadata.is_file() {
        return Err(AppError::invalid("The selected path is not a file."));
    }
    Ok(canonical)
}

/// Resolve a path that may not exist yet (new document).
fn canonical_target(path: &Path) -> AppResult<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| AppError::invalid("A file name is required."))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::invalid("A file name is required."))?;
    let parent = fs::canonicalize(parent)
        .map_err(|err| AppError::io(format!("Cannot use that folder: {err}")))?;
    Ok(parent.join(file_name))
}

fn modified_millis(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let elapsed = modified.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(elapsed.as_millis()).ok()
}

/// Windows canonicalisation returns verbatim paths (`\\?\C:\...`). They work,
/// but they are noisy in the UI and in the recent-files list, so the payload
/// value is normalised for display.
pub(crate) fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    text.to_string()
}

fn payload(path: &Path, content: String, size: u64) -> DocumentPayload {
    DocumentPayload {
        path: display_path(path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("untitled.mmd")
            .to_string(),
        content,
        modified: modified_millis(path),
        size,
    }
}

/// Strip a UTF-8 byte-order mark. Editors (including Monaco) do not show it, so
/// keeping it in the payload would make every BOM-prefixed file look modified
/// the moment it is opened.
fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

pub(crate) fn read_text_file(path: &Path) -> AppResult<DocumentPayload> {
    let metadata = fs::metadata(path)
        .map_err(|err| AppError::io(format!("Cannot read {}: {err}", path.display())))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::invalid(format!(
            "The file is larger than the {:.0} MiB limit for diagram documents.",
            MAX_DOCUMENT_BYTES as f64 / (1024.0 * 1024.0)
        )));
    }
    let bytes = fs::read(path)
        .map_err(|err| AppError::io(format!("Cannot read {}: {err}", path.display())))?;
    let text = String::from_utf8(bytes).map_err(|_| {
        AppError::invalid("The file is not valid UTF-8 text and cannot be opened as a diagram.")
    })?;
    Ok(payload(path, strip_bom(&text).to_string(), metadata.len()))
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("A destination folder is required."))?;
    fs::create_dir_all(parent)
        .map_err(|err| AppError::io(format!("Cannot create {}: {err}", parent.display())))?;

    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|err| AppError::io(format!("Cannot create a temporary file: {err}")))?;
    temp.write_all(bytes)
        .map_err(|err| AppError::io(format!("Cannot write the file: {err}")))?;
    temp.as_file()
        .sync_all()
        .map_err(|err| AppError::io(format!("Cannot flush the file: {err}")))?;
    temp.persist(path)
        .map_err(|err| AppError::io(format!("Cannot replace {}: {}", path.display(), err.error)))?;
    Ok(())
}

fn authorize_and_read(access: &DocumentAccess, path: PathBuf) -> AppResult<DocumentPayload> {
    let canonical = canonical_existing(&path)?;
    let document = read_text_file(&canonical)?;
    access.authorize(&canonical);
    Ok(document)
}

fn missing_extension_hint(path: &Path) -> bool {
    path.extension().is_none()
}

/// Append `.mmd` when the user typed a bare file name in the save dialog.
fn ensure_extension(path: PathBuf) -> PathBuf {
    if missing_extension_hint(&path) {
        path.with_extension("mmd")
    } else {
        path
    }
}

/// Read a diagram that the user already made available to the application.
///
/// A path is accepted only when the user opened it in this session or when it is
/// in the persisted recent list (so "Recent files" survives a restart). The
/// extension alone is not sufficient: the webview must not be able to read an
/// arbitrary `.md`/`.txt` file by guessing its path.
#[tauri::command]
pub fn read_document(
    app: AppHandle,
    path: String,
    access: State<'_, DocumentAccess>,
) -> AppResult<DocumentPayload> {
    let recents = crate::settings::load_settings(&crate::settings::config_dir(&app)?).recent_files;
    let canonical = read_target(&access, &recents, Path::new(&path))?;
    authorize_and_read(&access, canonical)
}

/// Decide whether a path may be read, returning its canonical form.
fn read_target(access: &DocumentAccess, recents: &[String], path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::forbidden(
            "Only absolute file paths are supported.",
        ));
    }
    let canonical = canonical_existing(path)?;

    let is_recent = has_diagram_extension(&canonical)
        && recents.iter().any(|entry| {
            // Fast path: the usual case is the exact string that was stored, and
            // resolving every recent could touch a slow network share.
            Path::new(entry) == path || same_file(Path::new(entry), &canonical)
        });
    if !access.is_authorized(&canonical) && !is_recent {
        return Err(AppError::forbidden(
            "That file was not opened in this session and is not in the recent list.",
        ));
    }
    Ok(canonical)
}

/// Compare two paths, tolerating entries that no longer resolve (deleted files).
pub(crate) fn same_file(candidate: &Path, canonical: &Path) -> bool {
    match canonical_existing(candidate) {
        Ok(resolved) => resolved == canonical,
        Err(_) => candidate == canonical,
    }
}

/// Native Open dialog followed by the read. Runs on the async runtime, never
/// the main thread.
#[tauri::command]
pub async fn open_document(
    app: AppHandle,
    access: State<'_, DocumentAccess>,
) -> AppResult<Option<DocumentPayload>> {
    let selection = app
        .dialog()
        .file()
        .set_title("Open Mermaid diagram")
        .add_filter("Mermaid diagram", &DIALOG_FILTERS)
        .blocking_pick_file();

    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|err| AppError::io(format!("Unsupported selection: {err}")))?;
    authorize_and_read(&access, path).map(Some)
}

/// Overwrite an already-authorised document.
#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_modified: Option<u64>,
    access: State<'_, DocumentAccess>,
) -> AppResult<DocumentPayload> {
    save_authorized(&access, PathBuf::from(&path), content, expected_modified)
}

/// Shared implementation for the save command (also covered by unit tests).
fn save_authorized(
    access: &DocumentAccess,
    path: PathBuf,
    content: String,
    expected_modified: Option<u64>,
) -> AppResult<DocumentPayload> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::invalid(format!(
            "The document is larger than the {:.0} MiB limit.",
            MAX_DOCUMENT_BYTES as f64 / (1024.0 * 1024.0)
        )));
    }

    // A file that was deleted outside the app can still be recreated at the
    // path the user already authorised; resolve it against its canonical parent.
    let canonical = match canonical_existing(&path) {
        Ok(canonical) => canonical,
        Err(_) => canonical_target(&path)?,
    };
    if !access.is_authorized(&canonical) {
        return Err(AppError::forbidden(
            "This document was not opened in the current session. Use Save As.",
        ));
    }

    if let (Some(expected), Some(current)) = (expected_modified, modified_millis(&canonical)) {
        if expected != current {
            return Err(AppError::conflict(
                "The file changed on disk since it was opened. Overwrite anyway?",
            ));
        }
    }

    write_atomic(&canonical, content.as_bytes())?;
    let size = content.len() as u64;
    Ok(payload(&canonical, content, size))
}

/// Native Save dialog followed by an atomic write.
#[tauri::command]
pub async fn save_document_as(
    app: AppHandle,
    access: State<'_, DocumentAccess>,
    content: String,
    suggested_name: String,
) -> AppResult<Option<DocumentPayload>> {
    let suggested = if suggested_name.trim().is_empty() {
        "untitled.mmd".to_string()
    } else {
        suggested_name
    };
    let selection = app
        .dialog()
        .file()
        .set_title("Save Mermaid diagram")
        .set_file_name(&suggested)
        .add_filter("Mermaid diagram", &DIALOG_FILTERS)
        .blocking_save_file();

    let Some(selection) = selection else {
        return Ok(None);
    };
    let chosen = selection
        .into_path()
        .map_err(|err| AppError::io(format!("Unsupported selection: {err}")))?;
    perform_save_as(&access, chosen, content).map(Some)
}

/// The write half of Save As, split out so it can be tested without a dialog.
fn perform_save_as(
    access: &DocumentAccess,
    chosen: PathBuf,
    content: String,
) -> AppResult<DocumentPayload> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::invalid(format!(
            "The document is larger than the {:.0} MiB limit.",
            MAX_DOCUMENT_BYTES as f64 / (1024.0 * 1024.0)
        )));
    }

    let target = canonical_target(&ensure_extension(chosen))?;
    write_atomic(&target, content.as_bytes())?;
    access.authorize(&target);
    let size = content.len() as u64;
    Ok(payload(&target, content, size))
}

/// Decode an export payload into bytes for the requested format.
fn decode_export_payload(kind: &str, data: &str) -> AppResult<Vec<u8>> {
    let bytes: Vec<u8> = if kind == "png" {
        use base64::Engine as _;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|err| AppError::invalid(format!("Invalid PNG payload: {err}")))?;
        // The export path must not double as a generic byte writer, so the
        // payload has to actually be a PNG rather than merely base64.
        if !decoded.starts_with(&PNG_SIGNATURE) {
            return Err(AppError::invalid("The export payload is not a PNG image."));
        }
        decoded
    } else {
        if !data.contains("<svg") {
            return Err(AppError::invalid("The export payload is not SVG markup."));
        }
        data.as_bytes().to_vec()
    };

    if bytes.len() as u64 > MAX_EXPORT_BYTES {
        return Err(AppError::invalid("The export is too large to write."));
    }
    Ok(bytes)
}

fn export_extension(kind: &str) -> AppResult<(&'static str, &'static str)> {
    match kind {
        "svg" => Ok(("svg", "SVG image")),
        "png" => Ok(("png", "PNG image")),
        other => Err(AppError::invalid(format!(
            "Unsupported export format: {other}"
        ))),
    }
}

/// Write an exported SVG or PNG next to a user-selected location.
///
/// `data` is the SVG markup for `kind = "svg"` and a base64 payload for
/// `kind = "png"`.
#[tauri::command]
pub async fn export_document(
    app: AppHandle,
    kind: String,
    data: String,
    suggested_name: String,
) -> AppResult<Option<String>> {
    let (extension, filter_name) = export_extension(&kind)?;
    // Validate and encode before prompting so a bad payload never opens a dialog.
    let bytes = decode_export_payload(&kind, &data)?;

    let suggested = if suggested_name.trim().is_empty() {
        format!("diagram.{extension}")
    } else {
        suggested_name
    };

    let selection = app
        .dialog()
        .file()
        .set_title(format!("Export {filter_name}"))
        .set_file_name(&suggested)
        .add_filter(filter_name, &[extension])
        .blocking_save_file();

    let Some(selection) = selection else {
        return Ok(None);
    };
    let chosen = selection
        .into_path()
        .map_err(|err| AppError::io(format!("Unsupported selection: {err}")))?;
    write_export_bytes(&kind, chosen, &bytes).map(Some)
}

/// The write half of the export dialog: decode the payload exactly as the
/// command does, then write it. Used by the tests so the same composition is
/// covered without a native dialog.
#[cfg(test)]
fn perform_export(kind: &str, chosen: PathBuf, data: &str) -> AppResult<String> {
    let bytes = decode_export_payload(kind, data)?;
    write_export_bytes(kind, chosen, &bytes)
}

fn write_export_bytes(kind: &str, chosen: PathBuf, bytes: &[u8]) -> AppResult<String> {
    let (extension, _) = export_extension(kind)?;
    let target = if chosen.extension().is_none() {
        chosen.with_extension(extension)
    } else {
        chosen
    };
    let target = canonical_target(&target)?;
    write_atomic(&target, bytes)?;
    Ok(display_path(&target))
}

/// Quick export beside the diagram that is already open.
///
/// The destination directory is the one the user already chose for the file, so
/// no file picker is shown. Replacing a file the app did not create still needs
/// the user's consent, and only a dialog owned by Rust can collect it: the
/// renderer is untrusted, so a flag it sends is not permission.
#[tauri::command]
pub async fn export_beside_document(
    app: AppHandle,
    document_path: String,
    kind: String,
    data: String,
    access: State<'_, DocumentAccess>,
) -> AppResult<String> {
    export_beside_confirmed(&access, &app, Path::new(&document_path), &kind, &data)
}

/// Ask the user before replacing an existing file, then write.
///
/// Split from the command so the decision can be tested without a native dialog.
fn export_beside_confirmed(
    access: &DocumentAccess,
    app: &AppHandle,
    document_path: &Path,
    kind: &str,
    data: &str,
) -> AppResult<String> {
    let (extension, _) = export_extension(kind)?;
    let document = canonical_existing(document_path)?;
    let target = export_target(access, &document, extension)?;

    if let Some(occupied) = target.consent_target() {
        if !confirm_replace(app, occupied) {
            return Err(AppError::conflict(format!(
                "{} was not replaced.",
                display_path(occupied)
            )));
        }
    }

    write_beside(&target.path, kind, data)
}

/// Where a beside-export would write, and whether that needs the user's consent.
#[derive(Debug)]
struct BesideTarget {
    path: PathBuf,
    /// Set when the destination already exists and replacing it must be asked
    /// about. `None` means the write may proceed without a prompt.
    requires_consent: Option<PathBuf>,
}

impl BesideTarget {
    /// The target to prompt about, when a prompt is needed.
    fn consent_target(&self) -> Option<&Path> {
        self.requires_consent.as_deref()
    }
}

/// Decide whether a beside-export may write, and whether it must ask first.
///
/// This is the security decision, kept free of the dialog so it can be unit
/// tested. It deliberately takes no renderer-supplied input: the destination is
/// derived from the authorised document, so nothing the webview sends can widen
/// it or stand in for consent.
fn export_target(
    access: &DocumentAccess,
    document: &Path,
    extension: &str,
) -> AppResult<BesideTarget> {
    if !access.is_authorized(document) {
        return Err(AppError::forbidden(
            "Export beside is only available for a document opened in this session.",
        ));
    }

    let path = document.with_extension(extension);
    let requires_consent = path.exists().then(|| path.clone());
    Ok(BesideTarget {
        path,
        requires_consent,
    })
}

/// Ask whether an existing file may be replaced.
///
/// Kept separate so the branch can be unit-tested: the answer is the security
/// decision, and the dialog only collects it. The renderer cannot reach this —
/// it holds no permission flag at all.
fn confirm_replace(app: &AppHandle, target: &Path) -> bool {
    app.dialog()
        .message(format!(
            "{} already exists next to this diagram. Replace it?",
            display_path(target)
        ))
        .title("Replace existing export?")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show()
}

/// Write the already-authorised beside-export. The caller owns consent.
fn write_beside(target: &Path, kind: &str, data: &str) -> AppResult<String> {
    let bytes = decode_export_payload(kind, data)?;
    write_atomic(target, &bytes)?;
    Ok(display_path(target))
}

/// Implementation of the beside-export, split out so it can be tested directly.
///
/// The caller is responsible for consenting to a replacement; this function
/// writes unconditionally once the document itself is authorised. Production
/// reaches the same logic through `export_beside_confirmed`, which adds the
/// prompt.
#[cfg(test)]
fn export_beside_impl(
    access: &DocumentAccess,
    document_path: &Path,
    kind: &str,
    data: &str,
) -> AppResult<String> {
    let (extension, _) = export_extension(kind)?;
    let document = canonical_existing(document_path)?;
    // Same authorisation decision as the real command, minus the prompt.
    let target = export_target(access, &document, extension)?;
    write_beside(&target.path, kind, data)
}

/// Drain documents handed to the process by the OS.
#[tauri::command]
pub fn take_pending_documents(access: State<'_, DocumentAccess>) -> Vec<DocumentPayload> {
    let pending = access.take_pending();
    let mut documents = Vec::new();
    for path in pending {
        if let Ok(document) = authorize_and_read(&access, path) {
            documents.push(document);
        }
    }
    documents
}

/// Read every diagram-looking path in `args`. Used at startup and by the
/// single-instance hand-off.
pub fn collect_paths(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && has_diagram_extension(path))
        .collect()
}

/// Queue files from a real operating-system drop.
///
/// The path list comes from the window event, never from the webview: a command
/// that accepted paths would let a compromised renderer authorise any
/// `.mmd`/`.md`/`.txt` file and then read or overwrite it.
pub fn queue_dropped(access: &DocumentAccess, paths: Vec<PathBuf>) -> (usize, usize) {
    let mut accepted = 0;
    let mut ignored = 0;
    for path in paths {
        let valid = path.is_absolute() && has_diagram_extension(&path) && path.is_file();
        if valid && accepted < 32 {
            access.push_pending(path);
            accepted += 1;
        } else {
            ignored += 1;
        }
    }
    (accepted, ignored)
}

/// Resolve a path that may be revealed, refusing anything the user did not open
/// or save in this session.
fn reveal_target(access: &DocumentAccess, path: &str) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err(AppError::forbidden(
            "Only absolute file paths are supported.",
        ));
    }
    let canonical = canonical_existing(&candidate)?;
    if !access.is_authorized(&canonical) {
        return Err(AppError::forbidden(
            "That file was not opened in this session.",
        ));
    }
    Ok(canonical)
}

/// Reveal a saved document in the platform file manager.
#[tauri::command]
pub fn reveal_document(
    app: AppHandle,
    path: String,
    access: State<'_, DocumentAccess>,
) -> AppResult<()> {
    let target = reveal_target(&access, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(target)
        .map_err(|err| AppError::io(format!("Cannot reveal the file: {err}")))?;
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, contents: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(name);
        fs::write(&path, contents).expect("write fixture");
        (dir, path)
    }

    #[test]
    fn accepts_known_diagram_extensions() {
        assert!(has_diagram_extension(Path::new("a.mmd")));
        assert!(has_diagram_extension(Path::new("A.MERMAID")));
        assert!(has_diagram_extension(Path::new("notes.md")));
        assert!(!has_diagram_extension(Path::new("diagram.exe")));
        assert!(!has_diagram_extension(Path::new("no-extension")));
        assert!(!has_diagram_extension(Path::new("archive.mmd.zip")));
    }

    #[test]
    fn reveal_requires_authorisation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagram.mmd");
        fs::write(&path, "graph TD").unwrap();
        let access = DocumentAccess::default();

        // Nothing was opened, so the webview may not open Explorer here.
        assert_eq!(
            reveal_target(&access, path.to_str().unwrap())
                .unwrap_err()
                .code,
            "forbidden"
        );

        access.authorize(&canonical_existing(&path).unwrap());
        assert_eq!(
            reveal_target(&access, path.to_str().unwrap()).unwrap(),
            canonical_existing(&path).unwrap()
        );
    }

    #[test]
    fn reveal_refuses_relative_and_missing_paths() {
        let access = DocumentAccess::default();
        assert_eq!(
            reveal_target(&access, "diagram.mmd").unwrap_err().code,
            "forbidden"
        );

        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone.mmd");
        assert_eq!(
            reveal_target(&access, missing.to_str().unwrap())
                .unwrap_err()
                .code,
            "io"
        );
    }

    #[test]
    fn reads_require_authorisation_or_a_recent_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "top secret").unwrap();
        let access = DocumentAccess::default();

        // The old extension fallback let any absolute .txt path through.
        let error = read_target(&access, &[], &path).unwrap_err();
        assert_eq!(error.code, "forbidden");

        // A persisted recent entry is enough, so recents survive a restart.
        let recents = vec![path.to_string_lossy().to_string()];
        assert_eq!(
            read_target(&access, &recents, &path).unwrap(),
            canonical_existing(&path).unwrap()
        );

        // An authorised path needs no recent entry.
        access.authorize(&canonical_existing(&path).unwrap());
        assert!(read_target(&access, &[], &path).is_ok());
    }

    #[test]
    fn reads_refuse_non_diagram_recents() {
        // A 1.1.0 settings file could hold any absolute path; even if one
        // survives on disk it must not grant a read.
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_rsa");
        fs::write(&key, "private").unwrap();

        let access = DocumentAccess::default();
        let recents = vec![key.to_string_lossy().to_string()];
        assert_eq!(
            read_target(&access, &recents, &key).unwrap_err().code,
            "forbidden"
        );
    }

    #[test]
    fn reads_reject_paths_outside_the_recent_list() {
        let dir = tempfile::tempdir().unwrap();
        let allowed = dir.path().join("allowed.mmd");
        let other = dir.path().join("other.mmd");
        fs::write(&allowed, "graph TD").unwrap();
        fs::write(&other, "graph LR").unwrap();

        let access = DocumentAccess::default();
        let recents = vec![allowed.to_string_lossy().to_string()];
        assert_eq!(
            read_target(&access, &recents, &other).unwrap_err().code,
            "forbidden"
        );
    }

    #[test]
    fn appends_default_extension_only_when_missing() {
        assert_eq!(
            ensure_extension(PathBuf::from("diagram")),
            PathBuf::from("diagram.mmd")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("diagram.svg")),
            PathBuf::from("diagram.svg")
        );
    }

    #[test]
    fn atomic_write_replaces_existing_content() {
        let (dir, path) = temp_file("chart.mmd", b"flowchart TD\n A-->B\n");
        write_atomic(&path, b"graph LR\n X-->Y\n").expect("write");
        assert_eq!(fs::read_to_string(&path).unwrap(), "graph LR\n X-->Y\n");
        // The temporary file must not be left behind.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn atomic_write_creates_missing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("nested").join("deep").join("diagram.mmd");
        write_atomic(&target, b"graph TD\n").expect("write");
        assert!(target.exists());
    }

    #[test]
    fn rejects_oversized_documents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.mmd");
        let handle = fs::File::create(&path).unwrap();
        handle.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let error = read_text_file(&path).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(error.message.contains("limit"));
    }

    #[test]
    fn rejects_invalid_utf8() {
        let (_dir, path) = temp_file("bad.mmd", &[0xff, 0xfe, 0x00]);
        let error = read_text_file(&path).unwrap_err();
        assert_eq!(error.code, "invalid");
    }

    #[test]
    fn collect_paths_keeps_only_existing_diagrams() {
        let dir = tempfile::tempdir().unwrap();
        let keep = dir.path().join("keep.mmd");
        let drop = dir.path().join("drop.txt".replace("txt", "bin").as_str());
        fs::write(&keep, "graph TD").unwrap();
        fs::write(&drop, "binary").unwrap();
        let args = vec![
            "mermaid-desk.exe".to_string(),
            keep.to_string_lossy().to_string(),
            drop.to_string_lossy().to_string(),
            dir.path().join("missing.mmd").to_string_lossy().to_string(),
        ];
        let collected = collect_paths(args);
        assert_eq!(collected, vec![keep]);
    }

    #[test]
    fn strips_verbatim_prefix_from_display_paths() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\diagrams\flow.mmd")),
            r"C:\diagrams\flow.mmd"
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share\flow.mmd")),
            r"\\server\share\flow.mmd"
        );
        assert_eq!(
            display_path(Path::new(r"C:\diagrams\flow.mmd")),
            r"C:\diagrams\flow.mmd"
        );
    }

    #[test]
    fn save_as_writes_and_authorises_the_new_path() {
        let dir = tempfile::tempdir().unwrap();
        // The native dialog returns a bare name when the user types no extension.
        let chosen = dir.path().join("fresh");
        let access = DocumentAccess::default();

        let payload =
            perform_save_as(&access, chosen, "graph TD\n A-->B\n".into()).expect("save as");
        assert_eq!(payload.name, "fresh.mmd");
        assert!(payload.path.ends_with("fresh.mmd"));
        assert_eq!(
            fs::read_to_string(dir.path().join("fresh.mmd")).unwrap(),
            "graph TD\n A-->B\n"
        );

        // The new path becomes writable for later saves in the same session.
        let again = save_authorized(
            &access,
            dir.path().join("fresh.mmd"),
            "graph TD\n A-->C\n".into(),
            payload.modified,
        );
        assert!(again.is_ok(), "authorised after Save As: {again:?}");
    }

    #[test]
    fn save_as_keeps_an_explicit_extension() {
        let dir = tempfile::tempdir().unwrap();
        let chosen = dir.path().join("named.mermaid");
        let payload = perform_save_as(&DocumentAccess::default(), chosen, "graph TD".into())
            .expect("save as");
        assert_eq!(payload.name, "named.mermaid");
    }

    #[test]
    fn save_as_requires_a_real_folder() {
        let dir = tempfile::tempdir().unwrap();
        let error = perform_save_as(
            &DocumentAccess::default(),
            dir.path().join("missing").join("file.mmd"),
            "graph TD".into(),
        )
        .unwrap_err();
        assert_eq!(error.code, "io");
    }

    #[test]
    fn save_as_refuses_oversized_content() {
        let dir = tempfile::tempdir().unwrap();
        let huge = "x".repeat((MAX_DOCUMENT_BYTES + 1) as usize);
        let error = perform_save_as(&DocumentAccess::default(), dir.path().join("big.mmd"), huge)
            .unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(!dir.path().join("big.mmd").exists());
    }

    #[test]
    fn export_writes_svg_and_appends_the_extension() {
        let dir = tempfile::tempdir().unwrap();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>"#;

        let written = perform_export("svg", dir.path().join("chart"), svg).expect("svg export");
        assert!(written.ends_with("chart.svg"));
        let contents = fs::read_to_string(dir.path().join("chart.svg")).unwrap();
        assert!(contents.contains("<svg"));
        assert!(!contents.contains("<script"));
    }

    #[test]
    fn export_writes_png_bytes_from_base64() {
        use base64::Engine as _;
        let dir = tempfile::tempdir().unwrap();
        // Smallest valid PNG header; content correctness is not the point here.
        let png: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let encoded = base64::engine::general_purpose::STANDARD.encode(png);

        let written =
            perform_export("png", dir.path().join("chart.png"), &encoded).expect("png export");
        assert!(written.ends_with("chart.png"));
        assert_eq!(fs::read(dir.path().join("chart.png")).unwrap(), png);
    }

    #[test]
    fn export_rejects_unknown_formats_and_bad_payloads() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            perform_export("pdf", dir.path().join("x"), "<svg/>")
                .unwrap_err()
                .code,
            "invalid"
        );
        assert_eq!(
            perform_export("svg", dir.path().join("x"), "not markup")
                .unwrap_err()
                .code,
            "invalid"
        );
        assert_eq!(
            perform_export("png", dir.path().join("x"), "!!not base64!!")
                .unwrap_err()
                .code,
            "invalid"
        );
        assert!(!dir.path().join("x.svg").exists());
    }

    #[test]
    fn export_beside_requires_authorisation() {
        let (dir, path) = temp_file("beside.mmd", b"graph TD\n");
        let access = DocumentAccess::default();
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";

        let refused = export_beside_impl(&access, &path, "svg", svg).unwrap_err();
        assert_eq!(refused.code, "forbidden");

        access.authorize(&canonical_existing(&path).unwrap());
        let written = export_beside_impl(&access, &path, "svg", svg).expect("beside");
        assert!(written.ends_with("beside.svg"));
        assert!(dir.path().join("beside.svg").exists());
    }

    /// The decision the dialog collects, tested without a dialog: an
    /// unauthorised document is refused, a fresh target needs no consent, and a
    /// target that already exists always requires it.
    #[test]
    fn export_target_decides_authorisation_and_consent() {
        let (dir, path) = temp_file("target.mmd", b"graph TD\n");
        let document = canonical_existing(&path).unwrap();
        let access = DocumentAccess::default();

        let refused = export_target(&access, &document, "svg").unwrap_err();
        assert_eq!(refused.code, "forbidden");

        access.authorize(&document);
        let fresh = export_target(&access, &document, "svg").expect("target");
        assert!(fresh.path.ends_with("target.svg"));
        assert!(
            fresh.requires_consent.is_none(),
            "a file that does not exist must not prompt"
        );

        // The renderer holds no flag that can skip this: existence alone decides.
        fs::write(dir.path().join("target.svg"), b"existing").unwrap();
        let occupied = export_target(&access, &document, "svg").expect("target");
        assert_eq!(
            occupied.requires_consent.as_deref(),
            Some(occupied.path.as_path()),
            "an existing file must require consent"
        );
    }

    /// The extension is fixed by `export_extension`, so the renderer cannot
    /// steer the write to another name or another directory.
    #[test]
    fn export_target_is_confined_to_the_document_stem() {
        let (_dir, path) = temp_file("confined.md", b"# notes\n");
        let document = canonical_existing(&path).unwrap();
        let access = DocumentAccess::default();
        access.authorize(&document);

        for (kind, expected) in [("svg", "confined.svg"), ("png", "confined.png")] {
            let (extension, _) = export_extension(kind).unwrap();
            let target = export_target(&access, &document, extension).expect("target");
            assert!(target.path.ends_with(expected));
            assert_eq!(target.path.parent(), document.parent());
        }
        assert_eq!(export_extension("exe").unwrap_err().code, "invalid");
    }

    /// `kind = "png"` must not be a generic byte writer: arbitrary base64 used to
    /// be accepted, which is what let a compromised renderer plant or clobber a
    /// `.png` sibling with any content it liked.
    #[test]
    fn export_rejects_png_payloads_without_a_signature() {
        use base64::Engine as _;
        let dir = tempfile::tempdir().unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"not a png at all");

        let error = perform_export("png", dir.path().join("chart.png"), &encoded).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(!dir.path().join("chart.png").exists());
    }

    #[test]
    fn dropped_paths_are_filtered_by_extension_and_absolute() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("dropped.mmd");
        let also_good = dir.path().join("notes.md");
        let bad_ext = dir.path().join("dropped.exe");
        let missing = dir.path().join("missing.mmd");
        fs::write(&good, "graph TD\n A-->B\n").unwrap();
        fs::write(&also_good, "# Notes\n").unwrap();
        fs::write(&bad_ext, "MZ").unwrap();

        let access = DocumentAccess::default();
        let (accepted, ignored) = queue_dropped(
            &access,
            vec![
                good.clone(),
                also_good.clone(),
                bad_ext,
                missing,
                PathBuf::from("relative\\dropped.mmd"),
            ],
        );

        assert_eq!((accepted, ignored), (2, 3));
        let drained = {
            let mut pending = access.pending.lock().unwrap();
            pending.drain(..).collect::<Vec<_>>()
        };
        assert_eq!(drained.len(), 2);
        // Queuing is not authorisation: the read path still decides.
        assert!(!access.is_authorized(&canonical_existing(&good).unwrap()));
    }

    #[test]
    fn dropped_paths_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let access = DocumentAccess::default();
        let mut paths = Vec::new();
        for index in 0..40 {
            let path = dir.path().join(format!("many-{index}.mmd"));
            fs::write(&path, "graph TD\n").unwrap();
            paths.push(path);
        }
        assert_eq!(queue_dropped(&access, paths), (32, 8));
    }

    #[test]
    fn strips_bom_so_files_open_clean() {
        let (_dir, path) = temp_file("bom.mmd", b"\xEF\xBB\xBFgraph TD\n A-->B\n");
        let document = read_text_file(&path).expect("read");
        assert_eq!(document.content, "graph TD\n A-->B\n");
        assert!(!document.content.starts_with('\u{feff}'));
    }

    #[test]
    fn keeps_crlf_and_mixed_line_endings_verbatim() {
        let (_dir, path) = temp_file("crlf.mmd", b"graph TD\r\n  A-->B\n");
        let document = read_text_file(&path).expect("read");
        assert_eq!(document.content, "graph TD\r\n  A-->B\n");
        // Round-tripping the same text must not change the file.
        let target = path.clone();
        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(&target).unwrap());
        save_authorized(&access, target.clone(), document.content.clone(), None).expect("save");
        assert_eq!(fs::read(&target).unwrap(), b"graph TD\r\n  A-->B\n");
    }

    #[test]
    fn rejected_unauthenticated_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("outside.mmd");
        let error =
            save_authorized(&DocumentAccess::default(), path, "graph TD".into(), None).unwrap_err();
        assert_eq!(error.code, "forbidden");
    }

    #[test]
    fn recreates_a_deleted_authorised_document() {
        let (dir, path) = temp_file("deleted.mmd", b"graph TD\n");
        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(&path).unwrap());
        fs::remove_file(&path).unwrap();

        let saved = save_authorized(&access, path.clone(), "graph LR\n A-->B\n".into(), None)
            .expect("save after deletion");
        assert_eq!(fs::read_to_string(&path).unwrap(), "graph LR\n A-->B\n");
        assert_eq!(saved.name, "deleted.mmd");
        assert!(dir.path().join("deleted.mmd").exists());
    }

    #[test]
    fn refuses_to_save_oversized_content() {
        let (dir, path) = temp_file("small.mmd", b"graph TD\n");
        let access = DocumentAccess::default();
        access.authorize(&canonical_existing(&path).unwrap());
        let huge = "x".repeat((MAX_DOCUMENT_BYTES + 1) as usize);
        let error = save_authorized(&access, path.clone(), huge, None).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert_eq!(fs::read_to_string(&path).unwrap(), "graph TD\n");
        drop(dir);
    }

    #[test]
    fn canonical_target_requires_existing_parent() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("absent").join("file.mmd");
        assert!(canonical_target(&missing).is_err());
    }
}
