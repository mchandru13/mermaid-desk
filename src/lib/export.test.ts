import { describe, expect, it } from "vitest";
import {
  base64ByteLength,
  CLIPBOARD_MAX_PIXELS,
  exportFileName,
  formatBytes,
  pngPixelSize,
  pngSize,
  withBackground,
} from "./export";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" /></svg>';

/** 1×1 transparent PNG, used to exercise the browser clipboard backend. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("export helpers", () => {
  it("creates safe file names", () => {
    expect(exportFileName("architecture.mmd", "svg")).toBe("architecture.svg");
    expect(exportFileName("my:diagram?.mmd", "png")).toBe("my-diagram-.png");
    expect(exportFileName("   ", "png")).toBe("diagram.png");
    expect(exportFileName("no-extension", "png")).toBe("no-extension.png");
  });

  it("inserts a background rectangle behind the diagram", () => {
    const result = withBackground(SVG, "#ffffff");
    expect(result).toContain('fill="#ffffff"');
    const index = result.indexOf('fill="#ffffff"');
    expect(index).toBeGreaterThan(result.indexOf("<svg"));
    expect(index).toBeLessThan(result.indexOf("<rect width"));
  });

  it("aligns the background to a viewBox that does not start at zero", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -8 300 200"><rect width="10" height="10"/></svg>';
    const result = withBackground(svg, "#0d1117");
    expect(result).toContain('x="-12"');
    expect(result).toContain('y="-8"');
    expect(result).toContain('width="300"');
    expect(result).toContain('height="200"');
  });

  it("does not modify the SVG when no background is requested", () => {
    expect(withBackground(SVG, "")).toBe(SVG);
  });

  it("computes base64 byte length", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("QQ==")).toBe(1);
    expect(base64ByteLength("QUI=")).toBe(2);
    expect(base64ByteLength("QUJD")).toBe(3);
  });

  it("reads PNG dimensions for the browser clipboard backend", () => {
    expect(pngSize(PNG_1X1)).toEqual({ width: 1, height: 1 });
    expect(pngSize("")).toBeNull();
    expect(pngSize("aGVsbG8=")).toBeNull();
    expect(pngSize("not base64 at all")).toBeNull();
  });

  it("scales the clipboard raster inside Rust's limits", () => {
    // Mirrors MAX_IMAGE_PIXELS / MAX_IMAGE_DIMENSION in clipboard.rs. A huge
    // canvas diagram must be shrunk, not rejected after rasterising.
    const huge = pngPixelSize({ width: 16000, height: 12000 }, {
      maxPixels: CLIPBOARD_MAX_PIXELS,
    });
    expect(huge.width * huge.height).toBeLessThanOrEqual(CLIPBOARD_MAX_PIXELS);
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(8192);

    const tall = pngPixelSize({ width: 100, height: 40000 }, {
      maxPixels: CLIPBOARD_MAX_PIXELS,
    });
    expect(tall.height).toBeLessThanOrEqual(8192);
    expect(tall.width).toBeGreaterThanOrEqual(1);
  });

  it("keeps normal diagrams at the 2x export scale", () => {
    expect(pngPixelSize({ width: 400, height: 200 })).toEqual({ width: 800, height: 400 });
  });

  it("never returns a zero-sized raster", () => {
    expect(pngPixelSize({ width: 0, height: 0 }, { scale: 0 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(0)).toBe("0 B");
  });
});
