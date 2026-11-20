import { svgSize } from "./render";

/**
 * Export helpers. SVG export writes the sanitized markup produced by the
 * preview; PNG export rasterises it locally in the webview, so no network or
 * hosted rendering service is involved.
 */

export interface ExportOptions {
  scale?: number;
  background?: string;
  maxDimension?: number;
}

const DEFAULT_SCALE = 2;
const DEFAULT_MAX_DIMENSION = 8192;
const EXPORT_PADDING = 16;

/**
 * Clone the live preview SVG with a viewBox that hugs the drawn artwork plus a
 * small padding, and matching width/height.
 *
 * Mermaid's viewBox includes asymmetric padding, so exported files sat slightly
 * off-centre and could clip the top edge. Measuring the live element gives the
 * real ink bounds. The clone keeps the original `id`, so the scoped styles in
 * its <style> element still apply.
 */
export function tightenSvgForExport(element: SVGSVGElement, padding = EXPORT_PADDING): string {
  const clone = element.cloneNode(true) as SVGSVGElement;
  const box = element.getBBox();
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0) {
    return new XMLSerializer().serializeToString(clone);
  }

  const x = box.x - padding;
  const y = box.y - padding;
  const width = box.width + padding * 2;
  const height = box.height + padding * 2;

  clone.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("data-render-id");
  return new XMLSerializer().serializeToString(clone);
}

/** Add an explicit background rectangle behind the diagram. */
export function withBackground(svg: string, background: string): string {
  if (!background) return svg;
  // The rect must use the viewBox origin, not (0,0): a tightened export can
  // start at a negative or offset coordinate, and a rect at 0,0 would leave a
  // transparent strip along the top/left edges.
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const viewBox = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const [x, y, width, height] =
    viewBox.length === 4 && viewBox.every((value) => Number.isFinite(value))
      ? viewBox
      : [0, 0, ...sizeFromAttributes(root)];

  const rect = `<rect data-export-background="true" x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}" />`;
  if (/<svg[^>]*>/i.test(svg)) {
    return svg.replace(/(<svg[^>]*>)/i, `$1${rect}`);
  }
  return svg;
}

function sizeFromAttributes(root: Element): [number, number] {
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return [
    Number.isFinite(width) && width > 0 ? width : 800,
    Number.isFinite(height) && height > 0 ? height : 600,
  ];
}

/**
 * Convert SVG markup into a base64 PNG payload using a canvas in the webview.
 */
export async function svgToPngBase64(
  svg: string,
  options: ExportOptions = {},
): Promise<string> {
  const background = options.background ?? "#ffffff";
  const prepared = withBackground(svg, background);
  const size = svgSize(prepared);

  const requestedScale = options.scale ?? DEFAULT_SCALE;
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const scale = Math.min(
    requestedScale,
    maxDimension / Math.max(size.width, 1),
    maxDimension / Math.max(size.height, 1),
  );

  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));

  const image = await loadSvgImage(prepared);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This system cannot create a 2D canvas for PNG export.");
  }
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",", 2)[1];
  if (!base64) {
    throw new Error("PNG encoding failed.");
  }
  return base64;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The diagram could not be rasterised for PNG export."));
    };
    image.src = url;
  });
}

/** Count rough download size for a base64 payload (used for status text). */
export function base64ByteLength(base64: string): number {
  const length = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build a stable export file name, e.g. `architecture.png`. */
export function exportFileName(baseName: string, extension: "svg" | "png"): string {
  const trimmed = baseName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  const safe = trimmed.replace(/\.(mmd|mermaid|md|txt)$/i, "") || "diagram";
  return `${safe}.${extension}`;
}
