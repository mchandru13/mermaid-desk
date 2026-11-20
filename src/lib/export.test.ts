import { describe, expect, it } from "vitest";
import {
  base64ByteLength,
  exportFileName,
  formatBytes,
  withBackground,
} from "./export";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" /></svg>';

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

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(0)).toBe("0 B");
  });
});
