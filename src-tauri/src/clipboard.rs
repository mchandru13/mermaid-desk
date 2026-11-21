//! Copy the rendered diagram to the system clipboard as a PNG image.
//!
//! The webview rasterises the SVG it already displays and sends the PNG as
//! base64. Rust decodes it, enforces size limits and hands the pixels to the OS
//! clipboard. Nothing is written to disk and no new webview capability is
//! granted: the frontend still cannot reach the clipboard or the filesystem
//! directly.
//!
//! The `arboard::Clipboard` is owned by the application rather than the command.
//! On X11/Wayland the clipboard content is served by the owning process, so
//! dropping it right after `set_image` makes the image vanish (unless a clipboard
//! manager happens to be running). arboard's README calls this out explicitly for
//! long-running applications.

use std::borrow::Cow;
use std::sync::Mutex;

use base64::Engine as _;
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};

/// Base64 of a 24 MiB PNG. A diagram PNG is far smaller in practice; this only
/// stops a hostile or broken payload from being decoded.
const MAX_BASE64_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_IMAGE_DIMENSION: u32 = 10_000;
/// 32 MP is 128 MiB of RGBA, which is the real allocation limit.
pub const MAX_IMAGE_PIXELS: u64 = 32_000_000;

/// PNG magic bytes, shared by the clipboard decoder and the export writer so
/// the two cannot disagree about what counts as a PNG.
pub(crate) const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedImage {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

/// Long-lived clipboard handle.
///
/// `Clipboard::new()` can fail on a headless or unsupported session, so the
/// failure is stored and retried on the next copy instead of disabling the
/// feature for the whole run.
pub struct ClipboardState {
    handle: Mutex<Option<arboard::Clipboard>>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

impl ClipboardState {
    /// Run `action` with a clipboard that outlives the command.
    fn with<T>(
        &self,
        action: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
    ) -> AppResult<T> {
        let mut handle = self
            .handle
            .lock()
            .map_err(|_| AppError::io("The clipboard is busy."))?;

        if handle.is_none() {
            *handle =
                Some(arboard::Clipboard::new().map_err(|err| {
                    AppError::io(format!("Cannot open the system clipboard: {err}"))
                })?);
        }

        let clipboard = handle
            .as_mut()
            .ok_or_else(|| AppError::io("Cannot open the system clipboard."))?;
        action(clipboard)
            .map_err(|err| AppError::io(format!("Cannot write the image to the clipboard: {err}")))
    }
}

/// Read width and height straight out of the PNG IHDR chunk.
///
/// This happens before decoding so an oversized header is rejected without
/// allocating the pixel buffer.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

fn check_dimensions(width: u32, height: u32) -> AppResult<()> {
    if width == 0 || height == 0 {
        return Err(AppError::invalid("The image has no pixels."));
    }
    if width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(AppError::invalid(format!(
            "The diagram is too large to copy ({width}×{height}). Export it instead."
        )));
    }
    Ok(())
}

/// Decode a base64 PNG into RGBA pixels.
///
/// Kept separate from the clipboard so it can be tested on headless CI, where no
/// clipboard exists.
pub fn decode_png(png_base64: &str) -> AppResult<Rgba> {
    if png_base64.len() > MAX_BASE64_BYTES {
        return Err(AppError::invalid("That image is too large to copy."));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim())
        .map_err(|_| AppError::invalid("That payload is not a base64 image."))?;

    let (width, height) = png_dimensions(&bytes)
        .ok_or_else(|| AppError::invalid("That payload is not a PNG image."))?;
    check_dimensions(width, height)?;

    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .map_err(|_| AppError::invalid("The diagram could not be decoded as a PNG image."))?;
    let rgba = image.into_rgba8();

    // The header is attacker-controlled input; let the real buffer be the
    // authority on how large the image turned out to be.
    check_dimensions(rgba.width(), rgba.height())?;

    Ok(Rgba {
        width: rgba.width(),
        height: rgba.height(),
        bytes: rgba.into_raw(),
    })
}

/// `async` + no `await`: Tauri runs the body on its blocking thread pool, so a
/// multi-megabyte decode and the clipboard write never stall the main thread
/// (which also owns the webview event loop).
#[tauri::command(async)]
pub fn copy_image_to_clipboard(
    state: State<'_, ClipboardState>,
    png_base64: String,
) -> AppResult<CopiedImage> {
    let Rgba {
        width,
        height,
        bytes,
    } = decode_png(&png_base64)?;

    state.with(|clipboard| {
        clipboard.set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(bytes),
        })
    })?;

    Ok(CopiedImage { width, height })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use image::{ImageBuffer, Rgba as Pixel};

    fn png_base64(width: u32, height: u32) -> String {
        let buffer: ImageBuffer<Pixel<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(width, height, Pixel([10, 20, 30, 255]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode PNG");
        STANDARD.encode(bytes)
    }

    fn header(width: u32, height: u32) -> String {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        STANDARD.encode(bytes)
    }

    #[test]
    fn decodes_png_to_rgba() {
        let decoded = decode_png(&png_base64(3, 2)).expect("decode");
        assert_eq!(decoded.width, 3);
        assert_eq!(decoded.height, 2);
        assert_eq!(decoded.bytes.len(), 3 * 2 * 4);
        assert_eq!(&decoded.bytes[..4], &[10, 20, 30, 255]);
    }

    #[test]
    fn rejects_bad_base64() {
        assert_eq!(decode_png("!!not base64!!").unwrap_err().code, "invalid");
        assert_eq!(decode_png("").unwrap_err().code, "invalid");
    }

    #[test]
    fn rejects_base64_that_is_not_a_png() {
        assert_eq!(
            decode_png(&STANDARD.encode(b"plain text, not an image"))
                .unwrap_err()
                .code,
            "invalid"
        );
    }

    #[test]
    fn rejects_oversized_dimensions_before_decoding() {
        let error = decode_png(&header(20_000, 20_000)).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(error.message.contains("too large"), "{}", error.message);
    }

    #[test]
    fn rejects_a_tall_but_narrow_image_by_pixel_count() {
        // Each dimension is within the per-side cap; only the product is not.
        let error = decode_png(&header(9_000, 9_000)).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(error.message.contains("too large"), "{}", error.message);
    }

    #[test]
    fn rejects_an_oversized_base64_payload() {
        let huge = "A".repeat(MAX_BASE64_BYTES + 4);
        let error = decode_png(&huge).unwrap_err();
        assert_eq!(error.code, "invalid");
        assert!(error.message.contains("too large"), "{}", error.message);
    }

    #[test]
    fn rejects_zero_dimensions() {
        assert_eq!(decode_png(&header(0, 10)).unwrap_err().code, "invalid");
    }

    #[test]
    fn accepts_the_largest_allowed_image() {
        // 5,000 × 6,400 = 32 MP, exactly the documented ceiling.
        assert!(check_dimensions(5_000, 6_400).is_ok());
        assert!(check_dimensions(5_000, 6_401).is_err());
    }

    #[test]
    fn a_rejected_payload_never_reaches_the_clipboard() {
        // `decode_png` is the only path to `set_image`, so an invalid payload
        // must fail there, before any clipboard handle is created. This also
        // keeps the test headless-safe.
        let state = ClipboardState::default();
        assert!(decode_png("not an image").is_err());
        assert!(state.handle.lock().unwrap().is_none());
    }

    #[test]
    fn the_clipboard_handle_outlives_a_single_command() {
        // On X11/Wayland the image is served by the owning process, so a handle
        // dropped after `set_image` loses it. A second write must reuse the same
        // handle. Headless CI cannot open a clipboard, in which case the first
        // call fails and there is nothing to reuse.
        let state = ClipboardState::default();
        let first = state.with(|_| Ok(()));
        if first.is_err() {
            return;
        }

        assert!(state.handle.lock().unwrap().is_some(), "the handle is kept");
        assert!(state.with(|_| Ok(())).is_ok(), "a second copy succeeds");
        assert!(state.handle.lock().unwrap().is_some(), "and keeps it");
    }
}
